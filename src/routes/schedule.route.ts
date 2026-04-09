import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { createScheduleSchema, executeScheduleSchema, scheduleQuerySchema } from '../schemas/dto.js';
import { appendScheduledBlogUtmRows } from '../services/google-sheets.service.js';
import { calculateSchedule, createSchedule } from '../services/schedule.service.js';
import { getGenerateQueue, removeJobFromQueue } from '../queues/queue-manager.js';
import { getPostList, getPostsByRange } from '../services/naver-blog.service.js';
import { getValidCookies } from '../services/naver-auth.service.js';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema.js';
import { findAccountById } from '../services/account-directory.service.js';
import {
  buildAdhocGenerateIdentity,
  buildScheduleGenerateJobId,
} from '../services/schedule-idempotency.service.js';

const imageSourceSchema = z.enum(['ai', 'google', 'keyword', 'product']).default('ai');
const manuscriptTypeSchema = z.enum(['default', 'update-restaurant', 'restaurant', 'pet', 'grok', 'keigo', 'hanryeodamwon', 'nyangnyang', 'kimdongpal', 'alibaba']).default('default');

const scheduleModeSchema = z.enum(['1', '2', '3', '2121']).default('2');

const pythonCompatSchema = z.object({
  queues: z.array(
    z.object({
      account: z.object({ id: z.string(), password: z.string(), blogId: z.string().optional() }),
      keywords: z.array(z.string()),
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
  delay_between_posts: z.number().default(10),
  keyword_category: z.string().optional(),
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

interface ScheduleQueueJob {
  _id: unknown;
  keyword: string;
  category?: string;
  scheduledAt: string;
  slot: number;
  status: string;
}

interface EnqueueScheduleGenerateJobInput {
  accountGenerateQueue: Queue;
  scheduleId: string;
  jobItem: ScheduleQueueJob;
  account: QueueAccount;
  service: string;
  ref: string;
  generateImages: boolean;
  imageCount: number;
  imageSource?: 'ai' | 'google' | 'keyword' | 'product';
  manuscriptType?: string;
  delayBetweenPostsSeconds: number;
  keywordCategory?: string;
  blogName?: string;
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
  delayBetweenPostsSeconds,
  keywordCategory,
  blogName,
}: EnqueueScheduleGenerateJobInput): Promise<void> => {
  if (jobItem.status !== 'pending') {
    return;
  }

  const generateJob = await accountGenerateQueue.add('generate', {
    scheduleId,
    scheduleJobId: jobItem._id,
    keyword: jobItem.keyword,
    category: keywordCategory || jobItem.category,
    keywordCategory,
    account,
    service,
    ref,
    generateImages,
    imageCount,
    imageSource,
    manuscriptType,
    delayBetweenPostsSeconds,
    scheduledAt: jobItem.scheduledAt,
    blogName,
  }, {
    jobId: buildScheduleGenerateJobId(String(jobItem._id)),
  });

  await ScheduleJobModel.findByIdAndUpdate(jobItem._id, {
    generateJobId: String(generateJob.id),
  });
};

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
      });

      totalJobs += jobs.length;

      const accountGenerateQueue = getGenerateQueue(queue.account.id);

      for (const jobItem of jobs) {
        await enqueueScheduleGenerateJob({
          accountGenerateQueue,
          scheduleId: String(schedule._id),
          jobItem: {
            _id: jobItem._id,
            keyword: jobItem.keyword,
            category: jobItem.category ?? undefined,
            scheduledAt: jobItem.scheduledAt,
            slot: jobItem.slot,
            status: jobItem.status,
          },
          account: queue.account,
          service: body.service,
          ref: body.ref,
          generateImages: body.generateImages,
          imageCount: body.imageCount,
          imageSource: body.imageSource,
          manuscriptType: body.manuscriptType,
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
    const filter: Record<string, string> = {};

    if (query.accountId) filter.accountId = query.accountId;
    if (query.status) filter.status = query.status;

    const schedules = await ScheduleModel.find(filter).sort({ createdAt: -1 }).limit(50);
    return { schedules };
  });

  app.get('/schedules/:id', async (req, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const schedule = await ScheduleModel.findById(id);
    if (!schedule) {
      return reply.status(404).send({ message: 'Schedule not found' });
    }

    const jobs = await ScheduleJobModel.find({ scheduleId: id }).sort({ day: 1, slot: 1 });
    return { schedule, jobs };
  });

  app.delete('/schedules/:id', async (req, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const schedule = await ScheduleModel.findById(id);
    if (!schedule) {
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
    const { id } = req.params as { id: string };
    const body = executeScheduleSchema.parse(req.body ?? {});

    const schedule = await ScheduleModel.findById(id);
    if (!schedule) {
      return reply.status(404).send({ message: 'Schedule not found' });
    }

    if (body.account.id !== schedule.accountId) {
      return reply.status(400).send({ message: 'Account mismatch' });
    }

    const jobs = await ScheduleJobModel.find({ scheduleId: id, status: 'pending' });

    const accountGenerateQueue = getGenerateQueue(body.account.id);

    for (const jobItem of jobs) {
      await enqueueScheduleGenerateJob({
        accountGenerateQueue,
        scheduleId: String(schedule._id),
        jobItem: {
          _id: jobItem._id,
          keyword: jobItem.keyword,
          category: jobItem.category ?? undefined,
          scheduledAt: jobItem.scheduledAt,
          slot: jobItem.slot,
          status: jobItem.status,
        },
        account: body.account,
        service: schedule.service,
        ref: schedule.ref,
        generateImages: schedule.generateImages,
        imageCount: schedule.imageCount,
        delayBetweenPostsSeconds: schedule.delayBetweenPostsSeconds,
      });
    }

    return { success: true, enqueued: jobs.length };
  });

  // Python 호환 라우트 (/bot/auto-schedule)
  app.post('/bot/auto-schedule', async (req: { body: unknown }) => {
    const body = pythonCompatSchema.parse(req.body);

    const results: Array<{
      scheduleId: string;
      account: string;
      reused: boolean;
      totalJobs: number;
      jobs: Array<{ id: string; keyword: string; scheduledAt: string; slot: number }>;
    }> = [];

    const preparedQueues = await Promise.all(body.queues.map(async (queue) => {
      const matchedAccount = await findAccountById(queue.account.id);

      return {
        queue,
        blogName: queue.blog_name || matchedAccount?.name,
        items: calculateSchedule(queue.keywords, body.schedule_date, body.schedule_mode),
      };
    }));

    let totalJobs = 0;

    for (const { queue, blogName, items } of preparedQueues) {
      const { schedule, jobs, reused } = await createSchedule({
        accountId: queue.account.id,
        service: body.service,
        ref: body.ref,
        scheduleDate: body.schedule_date,
        scheduleMode: body.schedule_mode,
        items,
        generateImages: body.generate_images,
        imageCount: body.image_count,
        imageSource: body.image_source,
        manuscriptType: body.manuscript_type,
        delayBetweenPostsSeconds: body.delay_between_posts,
        keywordCategory: body.keyword_category,
        keywords: queue.keywords,
      });

      if (body.manuscript_type === 'hanryeodamwon' && blogName && !reused) {
        await appendScheduledBlogUtmRows([{
          name: blogName,
          items,
        }]);
      }

      totalJobs += jobs.length;

      const accountGenerateQueue = getGenerateQueue(queue.account.id);

      for (const jobItem of jobs) {
        await enqueueScheduleGenerateJob({
          accountGenerateQueue,
          scheduleId: String(schedule._id),
          jobItem: {
            _id: jobItem._id,
            keyword: jobItem.keyword,
            category: jobItem.category ?? undefined,
            scheduledAt: jobItem.scheduledAt,
            slot: jobItem.slot,
            status: jobItem.status,
          },
          account: queue.account,
          service: body.service,
          ref: body.ref,
          generateImages: body.generate_images,
          imageCount: body.image_count,
          imageSource: body.image_source,
          manuscriptType: body.manuscript_type,
          delayBetweenPostsSeconds: body.delay_between_posts,
          keywordCategory: body.keyword_category,
          blogName,
        });
      }

      results.push({
        scheduleId: String(schedule._id),
        account: maskAccountId(queue.account.id),
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
        account: z.object({ id: z.string(), password: z.string(), blogId: z.string().optional() }),
        keywords: z.array(z.string()),
        update_count: z.number().min(1).optional(),
        start_index: z.number().min(0).optional(),
        end_index: z.number().min(0).optional(),
      })
    ),
    service: z.string().default('default'),
    ref: z.string().default(''),
    generate_images: z.boolean().default(true),
    image_count: z.number().default(5),
    image_source: imageSourceSchema,
    manuscript_type: manuscriptTypeSchema,
    delay_between_posts: z.number().default(10),
    keyword_category: z.string().optional(),
  });

  app.post('/bot/auto-update', async (req: { body: unknown }) => {
    const body = updateCompatSchema.parse(req.body);

    const results: Array<{
      account: string;
      totalJobs: number;
      posts: Array<{ logNo: string; title: string; keyword: string; index: number }>;
    }> = [];

    let totalJobs = 0;

    for (const queue of body.queues) {
      const auth = await getValidCookies(queue.account.id, queue.account.password);

      let posts: Array<{ logNo: string; title: string; index: number }>;
      let blogId: string;

      if (queue.start_index !== undefined && queue.end_index !== undefined) {
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
          account: maskAccountId(queue.account.id),
          totalJobs: 0,
          posts: [],
        });
        continue;
      }

      const keywordsToUse = queue.keywords.slice(0, posts.length);
      const jobsToCreate: Array<{ logNo: string; title: string; keyword: string; index: number }> = [];

      const accountGenerateQueue = getGenerateQueue(queue.account.id);

      for (let i = 0; i < posts.length && i < keywordsToUse.length; i++) {
        const post = posts[i];
        const keyword = keywordsToUse[i];
        const identity = buildAdhocGenerateIdentity({
          mode: 'update',
          accountId: queue.account.id,
          blogId,
          logNo: post.logNo,
          keyword,
          service: body.service,
          ref: body.ref,
          imageSource: body.image_source,
          manuscriptType: body.manuscript_type,
          keywordCategory: body.keyword_category,
        });

        await accountGenerateQueue.add('generate', {
          scheduleId: identity.scheduleId,
          scheduleJobId: identity.scheduleJobId,
          keyword,
          account: { ...queue.account, blogId },
          service: body.service,
          ref: body.ref,
          generateImages: body.generate_images,
          imageCount: body.image_count,
          imageSource: body.image_source,
          manuscriptType: body.manuscript_type,
          delayBetweenPostsSeconds: body.delay_between_posts,
          scheduledAt: new Date().toISOString(),
          mode: 'update' as const,
          logNo: post.logNo,
          keywordCategory: body.keyword_category,
        }, {
          jobId: identity.jobId,
        });

        jobsToCreate.push({ logNo: post.logNo, title: post.title, keyword, index: post.index });
        totalJobs++;
      }

      results.push({
        account: maskAccountId(queue.account.id),
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
    const { keywords, links } = body;

    if (keywords.length !== links.length) {
      return reply.status(400).send({
        message: `keywords(${keywords.length})와 links(${links.length}) 개수가 일치하지 않음`,
      });
    }

    const pairs = await Promise.all(keywords.map(async (keyword, i) => {
      const { blogId, logNo } = parseBlogUrl(links[i]);
      const matchedAccount = await findAccountById(blogId);
      return { keyword, blogId, logNo, matchedAccount };
    }));

    const missingAccounts = [...new Set(
      pairs.filter((pair) => !pair.matchedAccount).map((pair) => pair.blogId)
    )];

    if (missingAccounts.length > 0) {
      return reply.status(400).send({
        message: `DB에 없는 계정: ${missingAccounts.join(', ')}`,
      });
    }

    const validPairs = pairs.filter((pair) => pair.matchedAccount);

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
      const account = { id: matchedAccount!.id, password: matchedAccount!.password, blogId };
      const accountGenerateQueue = getGenerateQueue(account.id);

      const jobsList: Array<{ keyword: string; logNo: string }> = [];

      for (let i = 0; i < accountPairs.length; i++) {
        const { keyword, logNo } = accountPairs[i];
        const identity = buildAdhocGenerateIdentity({
          mode: 'update',
          accountId: account.id,
          blogId,
          logNo,
          keyword,
          service: body.service,
          ref: body.ref,
          imageSource: body.image_source,
          manuscriptType: body.manuscript_type,
          keywordCategory: body.keyword_category,
        });

        await accountGenerateQueue.add('generate', {
          scheduleId: identity.scheduleId,
          scheduleJobId: identity.scheduleJobId,
          keyword,
          account,
          service: body.service,
          ref: body.ref,
          generateImages: body.generate_images,
          imageCount: body.image_count,
          imageSource: body.image_source,
          manuscriptType: body.manuscript_type,
          delayBetweenPostsSeconds: body.delay_between_posts,
          scheduledAt: new Date().toISOString(),
          mode: 'update' as const,
          logNo,
          keywordCategory: body.keyword_category,
        }, {
          jobId: identity.jobId,
        });

        jobsList.push({ keyword, logNo });
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

  app.post('/bot/image-replace', async (req: { body: unknown }, reply: FastifyReply) => {
    const body = imageReplaceSchema.parse(req.body);
    const { links } = body;

    const pairs = await Promise.all(links.map(async (link) => {
      const { blogId, logNo } = parseBlogUrl(link);
      const matchedAccount = await findAccountById(blogId);
      return { blogId, logNo, matchedAccount };
    }));

    const missingAccounts = [...new Set(
      pairs.filter((pair) => !pair.matchedAccount).map((pair) => pair.blogId)
    )];

    if (missingAccounts.length > 0) {
      return reply.status(400).send({
        message: `DB에 없는 계정: ${missingAccounts.join(', ')}`,
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
      const { matchedAccount } = accountPairs[0];
      const account = { id: matchedAccount!.id, password: matchedAccount!.password, blogId };
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
