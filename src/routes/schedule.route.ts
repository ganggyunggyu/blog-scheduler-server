import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { createScheduleSchema, executeScheduleSchema, scheduleQuerySchema } from '../schemas/dto.js';
import { appendScheduledBlogUtmRows } from '../services/google-sheets.service.js';
import {
  buildLinkUpdateUtmAccount,
  prepareLinkUpdatePairs,
} from '../services/link-update.service.js';
import {
  buildScheduleTimingOptions,
  calculateSchedule,
  createSchedule,
  formatKst,
  parseKeywordWithCategory,
  resolveScheduleMode,
  toScheduleQueueJob,
  type ScheduleItem,
  type ScheduleQueueJob,
} from '../services/schedule.service.js';
import { getGenerateQueue, removeJobFromQueue } from '../queues/queue-manager.js';
import { getPostList, getPostsByRange } from '../services/naver-blog.service.js';
import { getValidCookies } from '../services/naver-auth.service.js';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema.js';
import { findAccountById } from '../services/account-directory.service.js';
import {
  isDabutAuthEnabled,
  listDabutBlogAccounts,
  resolveDabutBlogCredential,
} from '../services/dabut-app.service.js';
import { getRequestOwnerId } from './auth.route.js';
import {
  isVisibleSchedule,
  resolveOwnedAccountScope,
  resolveQueryAccountIds,
  toAccountIdMatchers,
} from '../services/schedule-ownership.service.js';
import { findContentPipeline } from '../services/content-pipeline.service.js';
import { resolvePublishCategory } from '../services/publish-category.service.js';
import {
  buildAdhocGenerateIdentity,
  buildScheduleGenerateJobId,
} from '../services/schedule-idempotency.service.js';
import type { MultiImageData } from '../lib/naver-editor/image.js';

const imageSourceSchema = z.enum(['ai', 'google', 'keyword', 'product', 'local']).default('ai');
const manuscriptTypeSchema = z.enum(['default', 'update-restaurant', 'restaurant', 'restaurant/v1', 'restaurant/v2', 'pet', 'grok', 'keigo', 'hanryeodamwon', 'nyangnyang', 'kimdongpal', 'alibaba']).default('default');

const scheduleModeSchema = z.enum(['1', '2', '3', '2121']).default('2');
const scheduleItemSchema = z.object({
  keyword: z.string(),
  category: z.string().optional(),
  businessName: z.string().optional(),
  manuscriptType: manuscriptTypeSchema.optional(),
  scheduledAt: z.string(),
  slot: z.number().int().min(1),
});
/** keywords 와 같은 길이로 주는 항목별 override. 시각 계산은 서버 로직을 그대로 씀. */
const scheduleItemOptionSchema = z.object({
  businessName: z.string().optional(),
  manuscriptType: manuscriptTypeSchema.optional(),
  /** 다붓 Project id. manuscriptType 보다 우선함. */
  projectId: z.string().min(1).optional(),
});
const providedManuscriptSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});
const multiImageDataSchema = z.object({
  individual: z.array(z.string().min(1)).optional(),
  slide: z.array(z.string().min(1)).optional(),
  collage: z.array(z.string().min(1)).optional(),
});

const pythonCompatSchema = z.object({
  queues: z.array(
    z.object({
      account: z.object({ id: z.string().optional(), password: z.string().optional(), blogId: z.string().optional(), dabutAccountId: z.string().optional() }),
      keywords: z.array(z.string()),
      manuscripts: z.array(providedManuscriptSchema).optional(),
      multi_images: z.array(multiImageDataSchema).optional(),
      items: z.array(scheduleItemSchema).optional(),
      item_options: z.array(scheduleItemOptionSchema).optional(),
      blog_name: z.string().optional(),
    })
  ),
  schedule_date: z.string().optional(),
  schedule_mode: scheduleModeSchema,
  service: z.string().default('default'),
  ref: z.string().default(''),
  generate_images: z.boolean().default(true),
  image_count: z.number().default(5),
  image_source: imageSourceSchema,
  manuscript_type: manuscriptTypeSchema,
  /** 다붓 Project id 기본값. item_options 의 projectId 가 있으면 그쪽이 이김. */
  project_id: z.string().min(1).optional(),
  delay_between_posts: z.number().default(10),
  keyword_category: z.string().optional(),
  /**
   * 직접 정한 발행 타이밍. 안 보내면 지금까지처럼 서버가 랜덤으로 잡는다.
   * posts_per_day 를 보내면 schedule_mode 로 계산한 하루 발행 수를 덮어쓴다.
   */
  start_hour: z.number().int().min(0).max(23).optional(),
  interval_minutes: z.number().int().min(10).max(720).optional(),
  posts_per_day: z.number().int().min(1).max(10).optional(),
});

const maskAccountId = (accountId: string): string => {
  const [user, domain] = accountId.split('@');
  if (domain) {
    return `${user.slice(0, 3)}***@${domain}`;
  }
  return `${accountId.slice(0, 3)}***`;
};

interface QueueAccount {
  id: string;
  password: string;
  blogId?: string;
}

/**
 * keywords 와 같은 순서로 들어온 항목별 override 를 계산된 스케쥴 항목에 얹음.
 * 시각 계산(랜덤 시작 시각/간격)은 서버 로직을 그대로 두고 업체명/원고 타입만 덮어씀.
 */
const applyItemOptions = (
  items: ScheduleItem[],
  itemOptions?: Array<{ businessName?: string; manuscriptType?: string; projectId?: string }>,
): ScheduleItem[] => {
  if (!itemOptions?.length) {
    return items;
  }

  return items.map((item, index) => ({
    ...item,
    businessName: itemOptions[index]?.businessName ?? item.businessName,
    manuscriptType: itemOptions[index]?.manuscriptType ?? item.manuscriptType,
    projectId: itemOptions[index]?.projectId ?? item.projectId,
  }));
};

/**
 * 큐에 넣을 계정 크리덴셜을 확정한다.
 * dabutAccountId 가 오면 로그인한 계정이 dabut 에 등록해둔 네이버 계정에서 꺼내 쓰고,
 * 아니면 기존처럼 요청 payload 나 계정 디렉토리에서 찾는다.
 */
const resolveQueueAccount = async (
  account: { id?: string; password?: string; blogId?: string; dabutAccountId?: string },
  ownerId?: string,
): Promise<{ account: QueueAccount; blogName?: string }> => {
  if (account.dabutAccountId) {
    if (!ownerId) {
      throw new Error('dabutAccountId 를 쓰려면 로그인이 필요합니다.');
    }

    const credential = await resolveDabutBlogCredential({
      ownerId,
      accountId: account.dabutAccountId,
    });
    if (!credential) {
      throw new Error(`dabut 계정을 찾을 수 없거나 비밀번호 복호화에 실패했습니다: ${account.dabutAccountId}`);
    }

    const blogAccounts = await listDabutBlogAccounts(ownerId);
    const matched = blogAccounts.find((item) => item.id === account.dabutAccountId);

    return {
      account: {
        id: credential.loginId,
        password: credential.password,
        blogId: credential.blogId || account.blogId,
      },
      blogName: matched?.name,
    };
  }

  if (!account.id) {
    throw new Error('account.id 또는 account.dabutAccountId 가 필요합니다.');
  }

  const matchedAccount = await findAccountById(account.id);
  const password = account.password ?? matchedAccount?.password;

  if (!password) {
    throw new Error(`Account credentials not provided: ${account.id}`);
  }

  return {
    account: {
      id: account.id,
      password,
      blogId: account.blogId ?? matchedAccount?.blogId,
    },
    blogName: matchedAccount?.name,
  };
};

interface EnqueueScheduleGenerateJobInput {
  accountGenerateQueue: Queue;
  scheduleId: string;
  jobItem: ScheduleQueueJob;
  account: QueueAccount;
  service: string;
  ref: string;
  generateImages: boolean;
  imageCount: number;
  imageSource?: 'ai' | 'google' | 'keyword' | 'product' | 'local';
  manuscriptType?: string;
  /** 다붓 Project id. 항목별 override 가 없을 때 쓰는 기본값. */
  projectId?: string;
  /** 프로젝트를 소유한 다붓 계정 id. 없으면 프로젝트 원고 요청이 401 로 떨어짐. */
  ownerId?: string;
  /** 계정별로 만든 본문 블록 순서. 없으면 워커가 내장 파이프라인을 씀. */
  contentBlocks?: string[];
  delayBetweenPostsSeconds: number;
  keywordCategory?: string;
  blogName?: string;
  providedManuscript?: { title: string; content: string };
  providedMultiImages?: MultiImageData;
}

const enqueueScheduleGenerateJob = async ({
  accountGenerateQueue,
  scheduleId,
  jobItem,
  account,
  service,
  ref,
  generateImages,
  imageCount,
  imageSource,
  manuscriptType,
  projectId,
  ownerId,
  contentBlocks,
  delayBetweenPostsSeconds,
  keywordCategory,
  blogName,
  providedManuscript,
  providedMultiImages,
}: EnqueueScheduleGenerateJobInput): Promise<void> => {
  if (jobItem.status !== 'pending') {
    return;
  }

  const generateJob = await accountGenerateQueue.add('generate', {
    scheduleId,
    scheduleJobId: jobItem._id,
    keyword: jobItem.keyword,
    category: resolvePublishCategory({
      jobCategory: jobItem.category,
      keywordCategory,
    }),
    keywordCategory,
    account,
    service,
    ref,
    generateImages,
    imageCount,
    imageSource,
    manuscriptType: jobItem.manuscriptType ?? manuscriptType,
    projectId: jobItem.projectId ?? projectId,
    ownerId,
    contentBlocks,
    delayBetweenPostsSeconds,
    scheduledAt: jobItem.scheduledAt,
    blogName,
    businessName: jobItem.businessName,
    providedManuscript,
    providedMultiImages,
  }, {
    jobId: buildScheduleGenerateJobId(String(jobItem._id)),
  });

  await ScheduleJobModel.findByIdAndUpdate(jobItem._id, {
    generateJobId: String(generateJob.id),
  });
};

const resolveExecutableJobStatus = async (
  accountGenerateQueue: Queue,
  jobItem: {
    _id: unknown;
    status: string;
    generateJobId?: string;
  },
): Promise<'pending' | null> => {
  if (jobItem.status === 'pending') {
    return 'pending';
  }

  if (jobItem.status !== 'generating') {
    return null;
  }

  const generateJob = jobItem.generateJobId
    ? await accountGenerateQueue.getJob(jobItem.generateJobId)
    : null;

  if (!generateJob) {
    await ScheduleJobModel.findByIdAndUpdate(jobItem._id, {
      $set: { status: 'pending' },
      $unset: { completedAt: 1 },
    });
    return 'pending';
  }

  const state = await generateJob.getState();
  if (state === 'failed') {
    await ScheduleJobModel.findByIdAndUpdate(jobItem._id, {
      $set: { status: 'pending' },
      $unset: { completedAt: 1 },
    });
    return 'pending';
  }

  return null;
};

/**
 * 요청자가 다룰 수 있는 네이버 로그인 아이디 목록.
 * null 이면 스코프를 걸지 않는다(dabut 인증이 꺼져 있어 테넌트 구분이 없는 경우).
 */
const resolveScheduleAccountScope = async (req: FastifyRequest): Promise<string[] | null> =>
  resolveOwnedAccountScope({
    authEnabled: isDabutAuthEnabled(),
    ownerId: getRequestOwnerId(req),
    listAccounts: listDabutBlogAccounts,
  });

export const scheduleRoutes = async (app: FastifyInstance) => {
  app.post('/bot/login-test', async (req) => {
    const body = z.object({
      accounts: z.array(z.object({ id: z.string(), password: z.string() })),
    }).parse(req.body);

    const results = [];
    for (const account of body.accounts) {
      try {
        const auth = await getValidCookies(account.id, account.password);
        results.push({ account: account.id, success: true, fromCache: auth.fromCache });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ account: account.id, success: false, error: message });
      }
    }
    return { results };
  });

  app.post('/schedules', async (req) => {
    const ownerId = getRequestOwnerId(req);
    const body = createScheduleSchema.parse(req.body);

    const results: Array<{
      scheduleId: string;
      account: string;
      reused: boolean;
      totalJobs: number;
      jobs: Array<{ id: string; keyword: string; scheduledAt: string; slot: number }>;
    }> = [];

    let totalJobs = 0;

    for (const queue of body.queues) {
      const { schedule, jobs, reused } = await createSchedule({
        accountId: queue.account.id,
        service: body.service,
        ref: body.ref,
        scheduleDate: body.scheduleDate,
        scheduleMode: body.scheduleMode,
        generateImages: body.generateImages,
        imageCount: body.imageCount,
        imageSource: body.imageSource,
        manuscriptType: body.manuscriptType,
        delayBetweenPostsSeconds: body.delayBetweenPostsSeconds,
        keywordCategory: body.keywordCategory,
        keywords: queue.keywords,
        startHour: body.startHour,
        intervalMinutes: body.intervalMinutes,
        postsPerDay: body.postsPerDay,
      });

      totalJobs += jobs.length;

      const accountGenerateQueue = getGenerateQueue(queue.account.id);

      for (const jobItem of jobs) {
        await enqueueScheduleGenerateJob({
          accountGenerateQueue,
          scheduleId: String(schedule._id),
          jobItem: toScheduleQueueJob(jobItem, jobItem.status),
          account: queue.account,
          service: body.service,
          ref: body.ref,
          generateImages: body.generateImages,
          imageCount: body.imageCount,
          imageSource: body.imageSource,
          manuscriptType: body.manuscriptType,
          ownerId,
          delayBetweenPostsSeconds: body.delayBetweenPostsSeconds,
          keywordCategory: body.keywordCategory,
        });
      }

      results.push({
        scheduleId: String(schedule._id),
        account: maskAccountId(queue.account.id),
        reused,
        totalJobs: jobs.length,
        jobs: jobs.map((jobItem) => ({
          id: String(jobItem._id),
          keyword: jobItem.keyword,
          scheduledAt: jobItem.scheduledAt,
          slot: jobItem.slot,
        })),
      });
    }

    return { success: true, totalJobs, schedules: results };
  });

  app.get('/schedules', async (req) => {
    const query = scheduleQuerySchema.parse(req.query);
    const ownedAccountIds = await resolveScheduleAccountScope(req);
    const filter: Record<string, unknown> = {};

    if (query.status) filter.status = query.status;

    if (ownedAccountIds) {
      const targetAccountIds = resolveQueryAccountIds(ownedAccountIds, query.accountId);
      if (!targetAccountIds.length) {
        return { schedules: [] };
      }
      filter.accountId = { $in: toAccountIdMatchers(targetAccountIds) };
    } else if (query.accountId) {
      filter.accountId = query.accountId;
    }

    const schedules = await ScheduleModel.find(filter).sort({ createdAt: -1 }).limit(50);
    return { schedules };
  });

  app.get('/schedules/:id', async (req, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const ownedAccountIds = await resolveScheduleAccountScope(req);

    const schedule = await ScheduleModel.findById(id);
    // 남의 스케쥴은 존재 여부까지 감춘다. 403 을 주면 id 가 살아 있다는 사실이 새어나간다.
    if (!schedule || !isVisibleSchedule(ownedAccountIds, schedule.accountId)) {
      return reply.status(404).send({ message: 'Schedule not found' });
    }

    const jobs = await ScheduleJobModel.find({ scheduleId: id }).sort({ day: 1, slot: 1 });
    return { schedule, jobs };
  });

  app.delete('/schedules/:id', async (req, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const ownedAccountIds = await resolveScheduleAccountScope(req);

    const schedule = await ScheduleModel.findById(id);
    if (!schedule || !isVisibleSchedule(ownedAccountIds, schedule.accountId)) {
      return reply.status(404).send({ message: 'Schedule not found' });
    }

    const jobs = await ScheduleJobModel.find({ scheduleId: id });

    // 계정별 큐에서 작업 제거
    for (const jobItem of jobs) {
      if (jobItem.generateJobId) {
        await removeJobFromQueue(schedule.accountId, jobItem.generateJobId, 'generate');
      }
      if (jobItem.publishJobId) {
        await removeJobFromQueue(schedule.accountId, jobItem.publishJobId, 'publish');
      }
    }

    await ScheduleJobModel.updateMany(
      { scheduleId: id },
      { status: 'cancelled', error: 'cancelled' }
    );

    await ScheduleModel.findByIdAndUpdate(id, { status: 'cancelled' });

    return { success: true, id };
  });

  app.post('/schedules/:id/execute', async (req, reply: FastifyReply) => {
    const ownerId = getRequestOwnerId(req);
    const { id } = req.params as { id: string };
    const body = executeScheduleSchema.parse(req.body ?? {});

    const schedule = await ScheduleModel.findById(id);
    if (!schedule) {
      return reply.status(404).send({ message: 'Schedule not found' });
    }

    if (body.account.id !== schedule.accountId) {
      return reply.status(400).send({ message: 'Account mismatch' });
    }

    const matchedAccount = await findAccountById(body.account.id);

    const password = body.account.password ?? matchedAccount?.password;

    if (!password) {
      return reply.status(400).send({ message: 'Account credentials not found' });
    }

    const account = {
      id: body.account.id,
      password,
      blogId: body.account.blogId ?? matchedAccount?.blogId,
    };

    const accountGenerateQueue = getGenerateQueue(account.id);
    const jobs = await ScheduleJobModel.find({
      scheduleId: id,
      status: { $in: ['pending', 'generating'] },
    });

    for (const jobItem of jobs) {
      const executableStatus = await resolveExecutableJobStatus(accountGenerateQueue, {
        _id: jobItem._id,
        status: jobItem.status,
        generateJobId: jobItem.generateJobId ?? undefined,
      });

      if (executableStatus !== 'pending') {
        continue;
      }

      await enqueueScheduleGenerateJob({
        accountGenerateQueue,
        scheduleId: String(schedule._id),
        jobItem: toScheduleQueueJob(jobItem, executableStatus),
        account,
        service: schedule.service,
        ref: schedule.ref,
        generateImages: schedule.generateImages,
        imageCount: schedule.imageCount,
        ownerId,
        delayBetweenPostsSeconds: schedule.delayBetweenPostsSeconds,
      });
    }

    return { success: true, enqueued: jobs.length };
  });

  // Python 호환 라우트 (/bot/auto-schedule)
  app.post('/bot/auto-schedule', async (req) => {
    const ownerId = getRequestOwnerId(req);
    const body = pythonCompatSchema.parse(req.body);
    const effectiveMode = resolveScheduleMode(body.schedule_mode, body.manuscript_type);
    const timingOptions = buildScheduleTimingOptions({
      manuscriptType: body.manuscript_type,
      startHour: body.start_hour,
      intervalMinutes: body.interval_minutes,
      postsPerDay: body.posts_per_day,
    });

    // 로그인한 계정이 이 카테고리용 블록 순서를 직접 만들어 뒀으면 그걸 그대로 실어 보낸다.
    // 문서가 없으면 undefined 로 남겨서 워커가 기존 내장 파이프라인을 쓰게 한다.
    const customPipeline = ownerId && body.keyword_category
      ? await findContentPipeline(ownerId, body.keyword_category)
      : null;
    const contentBlocks = customPipeline?.isActive ? customPipeline.blocks : undefined;

    const results: Array<{
      scheduleId: string;
      account: string;
      reused: boolean;
      totalJobs: number;
      jobs: Array<{ id: string; keyword: string; scheduledAt: string; slot: number }>;
    }> = [];

    const preparedQueuesResult = await Promise.all(body.queues.map(async (queue) => {
      if (queue.manuscripts && queue.manuscripts.length !== queue.keywords.length) {
        throw new Error(`account=${queue.account.id} manuscripts(${queue.manuscripts.length})와 keywords(${queue.keywords.length}) 개수가 일치하지 않음`);
      }
      if (queue.multi_images && queue.multi_images.length !== queue.keywords.length) {
        throw new Error(`account=${queue.account.id} multi_images(${queue.multi_images.length})와 keywords(${queue.keywords.length}) 개수가 일치하지 않음`);
      }
      if (queue.item_options && queue.item_options.length !== queue.keywords.length) {
        throw new Error(`account=${queue.account.id} item_options(${queue.item_options.length})와 keywords(${queue.keywords.length}) 개수가 일치하지 않음`);
      }

      const resolved = await resolveQueueAccount(queue.account, ownerId);
      const baseItems = queue.items?.map((item) => ({
        keyword: item.keyword,
        category: item.category,
        businessName: item.businessName,
        manuscriptType: item.manuscriptType,
        scheduledAt: new Date(item.scheduledAt),
        slot: item.slot,
      })) ?? calculateSchedule(
        queue.keywords,
        body.schedule_date,
        effectiveMode,
        timingOptions,
      );
      const items = applyItemOptions(baseItems, queue.item_options);

      return {
        queue,
        account: resolved.account,
        blogName: queue.blog_name || resolved.blogName,
        items,
      };
    })).then(
      (queues) => ({ ok: true as const, queues }),
      (error: unknown) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }),
    );

    if (!preparedQueuesResult.ok) {
      return { success: false, message: preparedQueuesResult.message };
    }

    const preparedQueues = preparedQueuesResult.queues;

    let totalJobs = 0;

    for (const { queue, account, blogName, items } of preparedQueues) {
      const { schedule, jobs, reused } = await createSchedule({
        accountId: account.id,
        service: body.service,
        ref: body.ref,
        scheduleDate: body.schedule_date,
        scheduleMode: effectiveMode,
        items,
        generateImages: body.generate_images,
        imageCount: body.image_count,
        imageSource: body.image_source,
        manuscriptType: body.manuscript_type,
        delayBetweenPostsSeconds: body.delay_between_posts,
        keywordCategory: body.keyword_category,
        keywords: queue.keywords,
        manuscripts: queue.manuscripts,
        providedMultiImages: queue.multi_images,
        startHour: body.start_hour,
        intervalMinutes: body.interval_minutes,
        postsPerDay: body.posts_per_day,
      });

      if (body.manuscript_type === 'hanryeodamwon' && blogName && !reused) {
        await appendScheduledBlogUtmRows([{
          name: blogName,
          items,
        }]);
      }

      totalJobs += jobs.length;

      const accountGenerateQueue = getGenerateQueue(account.id);

      for (let index = 0; index < jobs.length; index += 1) {
        const jobItem = jobs[index];
        await enqueueScheduleGenerateJob({
          accountGenerateQueue,
          scheduleId: String(schedule._id),
          jobItem: toScheduleQueueJob(jobItem, jobItem.status),
          account,
          service: body.service,
          ref: body.ref,
          generateImages: body.generate_images,
          imageCount: body.image_count,
          imageSource: body.image_source,
          manuscriptType: body.manuscript_type,
          projectId: body.project_id,
          ownerId,
          contentBlocks,
          delayBetweenPostsSeconds: body.delay_between_posts,
          keywordCategory: body.keyword_category,
          blogName,
          providedManuscript: queue.manuscripts?.[index],
          providedMultiImages: queue.multi_images?.[index],
        });
      }

      results.push({
        scheduleId: String(schedule._id),
        account: maskAccountId(account.id),
        reused,
        totalJobs: jobs.length,
        jobs: jobs.map((jobItem: { _id: unknown; keyword: string; scheduledAt: string; slot: number }) => ({
          id: String(jobItem._id),
          keyword: jobItem.keyword,
          scheduledAt: jobItem.scheduledAt,
          slot: jobItem.slot,
        })),
      });
    }

    return { success: true, totalJobs, schedules: results };
  });

const updateCompatSchema = z.object({
  queues: z.array(
    z.object({
      account: z.object({ id: z.string().optional(), password: z.string().optional(), blogId: z.string().optional(), dabutAccountId: z.string().optional() }),
      keywords: z.array(z.string()),
      manuscripts: z.array(z.object({
        title: z.string().min(1),
        content: z.string().min(1),
      })).optional(),
      /** keywords 와 같은 길이로 주는 항목별 override. auto-schedule 과 같은 형식. */
      item_options: z.array(scheduleItemOptionSchema).optional(),
      blog_name: z.string().optional(),
      update_count: z.number().min(1).optional(),
      start_index: z.number().min(0).optional(),
      end_index: z.number().min(0).optional(),
      /** 정확한 대상 글을 찍어서 고칠 때 씀. keywords 와 같은 길이여야 함. */
      log_nos: z.array(z.string().min(1)).optional(),
    })
  ),
    service: z.string().default('default'),
    ref: z.string().default(''),
    generate_images: z.boolean().default(true),
    image_count: z.number().default(5),
    image_source: imageSourceSchema,
    manuscript_type: manuscriptTypeSchema,
    /** 다붓 Project id 기본값. item_options 의 projectId 가 우선함. */
    project_id: z.string().min(1).optional(),
    delay_between_posts: z.number().default(10),
    keyword_category: z.string().optional(),
  });

  app.post('/bot/auto-update', async (req) => {
    const ownerId = getRequestOwnerId(req);
    const body = updateCompatSchema.parse(req.body);

    const results: Array<{
      account: string;
      totalJobs: number;
      posts: Array<{ logNo: string; title: string; keyword: string; index: number }>;
    }> = [];

    let totalJobs = 0;

    for (const queue of body.queues) {
      if (queue.manuscripts && queue.manuscripts.length !== queue.keywords.length) {
        return {
          success: false,
          message: `account=${queue.account.id} manuscripts(${queue.manuscripts.length})와 keywords(${queue.keywords.length}) 개수가 일치하지 않음`,
        };
      }

      const resolved = await resolveQueueAccount(queue.account, ownerId);
      const auth = await getValidCookies(resolved.account.id, resolved.account.password);

      let posts: Array<{ logNo: string; title: string; index: number }>;
      let blogId: string;

      if (queue.log_nos !== undefined) {
        if (queue.log_nos.length !== queue.keywords.length) {
          throw new Error(
            `account=${queue.account.id} log_nos(${queue.log_nos.length})와 keywords(${queue.keywords.length}) 개수가 일치하지 않음`,
          );
        }
        const result = await getPostList(auth.cookies, 1);
        blogId = result.blogId;
        posts = queue.log_nos.map((logNo, index) => ({ logNo, title: '', index }));
      } else if (queue.start_index !== undefined && queue.end_index !== undefined) {
        const result = await getPostsByRange(auth.cookies, queue.start_index, queue.end_index);
        posts = result.posts;
        blogId = result.blogId;
      } else {
        const count = queue.update_count ?? queue.keywords.length;
        const result = await getPostList(auth.cookies, count);
        posts = result.posts;
        blogId = result.blogId;
      }

      if (posts.length === 0) {
        results.push({
          account: maskAccountId(resolved.account.id),
          totalJobs: 0,
          posts: [],
        });
        continue;
      }

      if (queue.item_options && queue.item_options.length !== queue.keywords.length) {
        throw new Error(
          `account=${queue.account.id} item_options(${queue.item_options.length})와 keywords(${queue.keywords.length}) 개수가 일치하지 않음`,
        );
      }

      const keywordsToUse = queue.keywords.slice(0, posts.length);
      const jobsToCreate: Array<{ logNo: string; title: string; keyword: string; index: number }> = [];

      const accountGenerateQueue = getGenerateQueue(resolved.account.id);

      for (let i = 0; i < posts.length && i < keywordsToUse.length; i++) {
        const post = posts[i];
        const parsedKeyword = parseKeywordWithCategory(keywordsToUse[i]);
        const keyword = parsedKeyword.keyword;
        // 맛집처럼 업체명을 고정해야 하는 도메인은 항목별 override 를 그대로 워커로 넘긴다.
        const itemOption = queue.item_options?.[i];
        const manuscriptType = itemOption?.manuscriptType ?? body.manuscript_type;
        const identity = buildAdhocGenerateIdentity({
          mode: 'update',
          accountId: resolved.account.id,
          blogId,
          logNo: post.logNo,
          keyword,
          category: parsedKeyword.category,
          service: body.service,
          ref: body.ref,
          imageSource: body.image_source,
          manuscriptType,
          keywordCategory: body.keyword_category,
          providedManuscript: queue.manuscripts?.[i],
        });

        await accountGenerateQueue.add('generate', {
          scheduleId: identity.scheduleId,
          scheduleJobId: identity.scheduleJobId,
          keyword,
          category: parsedKeyword.category,
          account: { ...resolved.account, blogId },
          service: body.service,
          ref: body.ref,
          generateImages: body.generate_images,
          imageCount: body.image_count,
          imageSource: body.image_source,
          manuscriptType,
          projectId: itemOption?.projectId ?? body.project_id,
          businessName: itemOption?.businessName,
          blogName: queue.blog_name ?? resolved.blogName,
          delayBetweenPostsSeconds: body.delay_between_posts,
          scheduledAt: new Date().toISOString(),
          mode: 'update' as const,
          logNo: post.logNo,
          keywordCategory: body.keyword_category,
          providedManuscript: queue.manuscripts?.[i],
        }, {
          jobId: identity.jobId,
        });

        jobsToCreate.push({ logNo: post.logNo, title: post.title, keyword, index: post.index });
        totalJobs++;
      }

      results.push({
        account: maskAccountId(resolved.account.id),
        totalJobs: jobsToCreate.length,
        posts: jobsToCreate,
      });
    }

    return { success: true, totalJobs, updates: results };
  });

  const parseBlogUrl = (url: string): { blogId: string; logNo: string } => {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return { blogId: parts[0], logNo: parts[1] };
  };

const linkUpdateSchema = z.object({
  keywords: z.array(z.string().min(1)),
  links: z.array(z.string().url()),
  manuscripts: z.array(z.object({
    title: z.string().min(1),
    content: z.string().min(1),
  })).optional(),
  service: z.string().default('default'),
  ref: z.string().default(''),
    generate_images: z.boolean().default(true),
    image_count: z.number().default(5),
    image_source: imageSourceSchema,
    manuscript_type: manuscriptTypeSchema,
    delay_between_posts: z.number().default(10),
    keyword_category: z.string().optional(),
  });

  app.post('/bot/link-update', async (req: { body: unknown }, reply: FastifyReply) => {
    const body = linkUpdateSchema.parse(req.body);
    const { keywords, links, manuscripts } = body;

    if (keywords.length !== links.length) {
      return reply.status(400).send({
        message: `keywords(${keywords.length})와 links(${links.length}) 개수가 일치하지 않음`,
      });
    }

    if (manuscripts && manuscripts.length !== keywords.length) {
      return reply.status(400).send({
        message: `manuscripts(${manuscripts.length})와 keywords(${keywords.length}) 개수가 일치하지 않음`,
      });
    }

    const pairs = await Promise.all(keywords.map(async (keyword, i) => {
      const { blogId, logNo } = parseBlogUrl(links[i]);
      const matchedAccount = await findAccountById(blogId);
      return { inputIndex: i, keyword, blogId, logNo, matchedAccount };
    }));

    const missingAccounts = [...new Set(
      pairs.filter((pair) => !pair.matchedAccount).map((pair) => pair.blogId)
    )];

    if (missingAccounts.length > 0) {
      return reply.status(400).send({
        message: `DB에 없는 계정: ${missingAccounts.join(', ')}`,
      });
    }

    const validPairs = pairs.filter((pair) => Boolean(pair.matchedAccount)).map((pair) => ({
      inputIndex: pair.inputIndex,
      keyword: pair.keyword,
      blogId: pair.blogId,
      logNo: pair.logNo,
      matchedAccount: pair.matchedAccount!,
    }));

    const grouped = new Map<string, typeof validPairs>();
    for (const pair of validPairs) {
      const existing = grouped.get(pair.blogId) ?? [];
      existing.push(pair);
      grouped.set(pair.blogId, existing);
    }

    const results: Array<{
      account: string;
      totalJobs: number;
      jobs: Array<{ keyword: string; logNo: string }>;
    }> = [];

    let totalJobs = 0;

    for (const [blogId, accountPairs] of grouped) {
      const { matchedAccount } = accountPairs[0];
      const blogName = matchedAccount.name;
      if (!matchedAccount.password) {
        return reply.status(400).send({
          message: `DB 계정에 실행 비밀번호가 없음: ${blogId}`,
        });
      }
      const account = { id: matchedAccount.id, password: matchedAccount.password, blogId };
      const accountGenerateQueue = getGenerateQueue(account.id);
      const scheduledAt = formatKst(new Date());
      const preparedPairs = prepareLinkUpdatePairs(accountPairs, scheduledAt);

      const jobsList: Array<{ keyword: string; logNo: string }> = [];

      if (body.manuscript_type === 'hanryeodamwon' && blogName) {
        await appendScheduledBlogUtmRows([
          buildLinkUpdateUtmAccount(blogName, preparedPairs),
        ]);
      }

      for (const preparedPair of preparedPairs) {
        const identity = buildAdhocGenerateIdentity({
          mode: 'update',
          accountId: account.id,
          blogId,
          logNo: preparedPair.logNo,
          keyword: preparedPair.keyword,
          category: preparedPair.category,
          service: body.service,
          ref: body.ref,
          imageSource: body.image_source,
          manuscriptType: body.manuscript_type,
          keywordCategory: body.keyword_category,
          providedManuscript: manuscripts?.[preparedPair.inputIndex],
        });

        await accountGenerateQueue.add('generate', {
          scheduleId: identity.scheduleId,
          scheduleJobId: identity.scheduleJobId,
          keyword: preparedPair.keyword,
          category: preparedPair.category,
          account,
          service: body.service,
          ref: body.ref,
          generateImages: body.generate_images,
          imageCount: body.image_count,
          imageSource: body.image_source,
          manuscriptType: body.manuscript_type,
          delayBetweenPostsSeconds: body.delay_between_posts,
          scheduledAt: preparedPair.scheduledAt,
          mode: 'update' as const,
          logNo: preparedPair.logNo,
          keywordCategory: body.keyword_category,
          providedManuscript: manuscripts?.[preparedPair.inputIndex],
          blogName,
        }, {
          jobId: identity.jobId,
        });

        jobsList.push({ keyword: preparedPair.keyword, logNo: preparedPair.logNo });
        totalJobs++;
      }

      results.push({
        account: maskAccountId(blogId),
        totalJobs: jobsList.length,
        jobs: jobsList,
      });
    }

    return { success: true, totalJobs, updates: results };
  });

  const imageReplaceSchema = z.object({
    links: z.array(z.string().url()),
    image_source: imageSourceSchema.default('product'),
    image_count: z.number().default(5),
    delay_between_posts: z.number().default(10),
    keyword_category: z.string().default('한려담원'),
  });

  /**
   * blogId 로 실행 계정을 찾는다. 레거시 account-directory 를 먼저 보고,
   * 거기 없거나 비밀번호가 없으면 로그인한 다붓 계정(ownerId) 소유의
   * naver_accounts 에서 같은 blogId 를 찾아 복호화해서 쓴다.
   */
  const resolveImageReplaceAccount = async (
    blogId: string,
    ownerId?: string,
  ): Promise<QueueAccount | null> => {
    const matchedAccount = await findAccountById(blogId);
    if (matchedAccount?.password) {
      return { id: matchedAccount.id, password: matchedAccount.password, blogId };
    }

    if (!ownerId) return null;

    const dabutAccounts = await listDabutBlogAccounts(ownerId);
    const matchedDabut = dabutAccounts.find((item) => item.blogId === blogId);
    if (!matchedDabut) return null;

    const credential = await resolveDabutBlogCredential({ ownerId, accountId: matchedDabut.id });
    if (!credential) return null;

    return { id: credential.loginId, password: credential.password, blogId: credential.blogId || blogId };
  };

  app.post('/bot/image-replace', async (req, reply: FastifyReply) => {
    const ownerId = getRequestOwnerId(req);
    const body = imageReplaceSchema.parse(req.body);
    const { links } = body;

    const pairs = await Promise.all(links.map(async (link) => {
      const { blogId, logNo } = parseBlogUrl(link);
      const account = await resolveImageReplaceAccount(blogId, ownerId);
      return { blogId, logNo, account };
    }));

    const missingAccounts = [...new Set(
      pairs.filter((pair) => !pair.account).map((pair) => pair.blogId)
    )];

    if (missingAccounts.length > 0) {
      return reply.status(400).send({
        message: `계정을 찾을 수 없거나 실행 비밀번호가 없음: ${missingAccounts.join(', ')}`,
      });
    }

    const grouped = new Map<string, typeof pairs>();
    for (const pair of pairs) {
      const existing = grouped.get(pair.blogId) ?? [];
      existing.push(pair);
      grouped.set(pair.blogId, existing);
    }

    const results: Array<{
      account: string;
      totalJobs: number;
      jobs: Array<{ logNo: string }>;
    }> = [];

    let totalJobs = 0;

    for (const [blogId, accountPairs] of grouped) {
      const account = accountPairs[0].account!;
      const accountGenerateQueue = getGenerateQueue(account.id);

      const jobsList: Array<{ logNo: string }> = [];

      for (let i = 0; i < accountPairs.length; i++) {
        const { logNo } = accountPairs[i];
        const identity = buildAdhocGenerateIdentity({
          mode: 'image-replace',
          accountId: account.id,
          blogId,
          logNo,
          keyword: body.keyword_category,
          service: 'default',
          ref: '',
          imageSource: body.image_source,
          keywordCategory: body.keyword_category,
        });

        await accountGenerateQueue.add('generate', {
          scheduleId: identity.scheduleId,
          scheduleJobId: identity.scheduleJobId,
          keyword: body.keyword_category,
          account,
          service: 'default',
          ref: '',
          generateImages: true,
          imageCount: body.image_count,
          imageSource: body.image_source,
          delayBetweenPostsSeconds: body.delay_between_posts,
          scheduledAt: new Date().toISOString(),
          mode: 'image-replace' as const,
          logNo,
          keywordCategory: body.keyword_category,
        }, {
          jobId: identity.jobId,
        });

        jobsList.push({ logNo });
        totalJobs++;
      }

      results.push({
        account: maskAccountId(blogId),
        totalJobs: jobsList.length,
        jobs: jobsList,
      });
    }

    return { success: true, totalJobs, updates: results };
  });
}
