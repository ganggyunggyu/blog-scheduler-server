import 'dotenv/config';
import mongoose from 'mongoose';
import { format } from 'date-fns';
import path from 'path';
import { readdir } from 'fs/promises';
import type { Queue } from 'bullmq';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';
import { formatKst } from '../src/services/schedule.service.js';
import { buildScheduleGenerateJobId } from '../src/services/schedule-idempotency.service.js';
import { getGenerateQueue, getPublishQueue, closeAllQueues } from '../src/queues/queue-manager.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const SERVICE = process.env.PET_MODIFY_SERVICE ?? 'pet-modify-nas-recent2';
const NAS_DATE_CODE = process.env.PET_NAS_DATE_CODE ?? '0616';
const REF = process.env.PET_MODIFY_REF ?? `2026-${NAS_DATE_CODE.slice(0, 2)}-${NAS_DATE_CODE.slice(2)}-nas-recent2`;
const CATEGORY = '애견';
const KEYWORD_CATEGORY = '애견';
const MANUSCRIPT_TYPE = 'pet';
const IMAGE_SOURCE = 'product';
const IMAGE_COUNT = 5;
const DELAY_BETWEEN_POSTS_SECONDS = 10;
const RECENT_POST_COUNT = 2;
const MONITOR_INTERVAL_MS = 30_000;
const MONITOR_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const ACTIVE_JOB_RECOVERY_MS = 60_000;
const DRY_RUN = process.env.PET_DRY_RUN === '1';
const DEFAULT_NAS_BASE_DIR = '/Volumes/21lab_데이터관리/0_자동발행/0_애견자동발행';
const NAS_OUTPUT_DIR = process.env.PET_NAS_OUTPUT_DIR
  ? path.resolve(process.env.PET_NAS_OUTPUT_DIR)
  : path.join(DEFAULT_NAS_BASE_DIR, `애견_${NAS_DATE_CODE}_출력`);
const TARGET_ACCOUNT_IDS = [
  'k7d9x2m4',
  'fail5644',
  'compare14310',
  'ghostrush7',
  'respawnking9',
  'ahffkdlek12',
  'ahsxkfldk12',
  'ahfflwl123',
];

const ACCOUNT_FILTER = new Set(
  (process.env.PET_ACCOUNTS ?? '')
    .split(',')
    .map((accountId) => accountId.trim())
    .filter(Boolean),
);

let requestedKeywords = new Map<string, string[]>();

const targetAccountIds = (): string[] => {
  const entries = [...TARGET_ACCOUNT_IDS];
  if (ACCOUNT_FILTER.size === 0) {
    return entries;
  }

  return entries.filter((accountId) => ACCOUNT_FILTER.has(accountId));
};

interface AccountDoc {
  accountId: string;
  password: string;
  blogId?: string;
  nickname?: string;
  category?: string;
  isActive?: boolean;
}

interface PostItem {
  logNo: string;
  title: string;
}

interface PostTitleRaw {
  logNo?: string | number;
  title?: string;
}

interface ExistingSchedule {
  _id: string;
  accountId: string;
  status: string;
  totalJobs: number;
}

interface ExistingScheduleJob {
  _id: string;
  scheduleId: string;
  keyword: string;
  slot: number;
  status: string;
  generateJobId?: string;
  publishJobId?: string;
  postUrl?: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const decodeTitle = (raw: string): string => {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    decoded = raw;
  }

  return decoded
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
};

const normalizeBlogName = (value: string): string =>
  value
    .normalize('NFC')
    .replace(/\([^)]*\)/g, '')
    .replace(/[0-9]+개/g, '')
    .replace(/[0-9]+/g, '')
    .replace(/\s+/g, '')
    .trim();

const loadNasKeywords = async (accounts: AccountDoc[]): Promise<Map<string, string[]>> => {
  const blogFolders = await readdir(NAS_OUTPUT_DIR, { withFileTypes: true });
  const byBlogName = new Map(
    blogFolders
      .filter((entry) => entry.isDirectory())
      .map((entry) => [normalizeBlogName(entry.name), entry.name]),
  );

  const loaded = new Map<string, string[]>();
  for (const account of accounts) {
    const candidates = [
      account.nickname,
      account.blogId,
      account.accountId,
    ].filter((value): value is string => Boolean(value));

    const blogFolder = candidates
      .map((candidate) => byBlogName.get(normalizeBlogName(candidate)))
      .find((candidate): candidate is string => Boolean(candidate));

    if (!blogFolder) {
      throw new Error(`NAS 출력 폴더 매칭 실패: ${account.accountId} (${account.nickname ?? '-'})`);
    }

    const keywordFolders = await readdir(path.join(NAS_OUTPUT_DIR, blogFolder), { withFileTypes: true });
    const keywords = keywordFolders
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_used_'))
      .map((entry) => entry.name.normalize('NFC'))
      .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))
      .slice(0, RECENT_POST_COUNT);

    if (keywords.length < RECENT_POST_COUNT) {
      throw new Error(`NAS 키워드 부족: ${account.accountId} ${keywords.length}/${RECENT_POST_COUNT}`);
    }

    loaded.set(account.accountId, keywords);
    console.log(`[nas] ${account.nickname || account.accountId} -> ${keywords.join(', ')}`);
  }

  return loaded;
};

const extractJsonArray = (text: string): unknown[] => {
  const listStart = text.indexOf('"postList":[');
  if (listStart < 0) {
    return [];
  }

  const bracketStart = text.indexOf('[', listStart);
  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;

  for (let index = bracketStart; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }

  if (end < 0) {
    return [];
  }

  const parsed = JSON.parse(text.slice(bracketStart, end)) as unknown;
  return Array.isArray(parsed) ? parsed : [];
};

const isPostTitleRaw = (value: unknown): value is PostTitleRaw => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<PostTitleRaw>;
  return record.logNo !== undefined;
};

const fetchLatestPosts = async (blogId: string): Promise<PostItem[]> => {
  const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&viewdate=&currentPage=1&categoryNo=0&parentCategoryNo=&countPerPage=30`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      Referer: `https://blog.naver.com/${blogId}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`최근 글 조회 실패: ${blogId} status=${response.status}`);
  }

  const rawItems = extractJsonArray(await response.text()).filter(isPostTitleRaw);

  return rawItems
    .map((item) => ({
      logNo: String(item.logNo ?? ''),
      title: decodeTitle(item.title ?? ''),
    }))
    .filter((item) => item.logNo && item.title)
    .slice(0, RECENT_POST_COUNT);
};

const resolveAccounts = async (): Promise<AccountDoc[]> => {
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const ids = targetAccountIds();
  if (ids.length === 0) {
    throw new Error(`처리할 계정 없음: ${[...ACCOUNT_FILTER].join(', ')}`);
  }

  const accounts = await cafeDb.collection<AccountDoc>('accounts')
    .find(
      {
        accountId: { $in: ids },
        isActive: { $ne: false },
      },
      {
        projection: {
          accountId: 1,
          password: 1,
          blogId: 1,
          nickname: 1,
          category: 1,
          isActive: 1,
        },
      },
    )
    .toArray();

  const byId = new Map(accounts.map((account) => [account.accountId, account]));
  const missing = ids.filter((id) => !byId.get(id)?.password);
  if (missing.length > 0) {
    throw new Error(`계정 또는 비밀번호 없음: ${missing.join(', ')}`);
  }

  return ids.map((id) => byId.get(id)!);
};

const addGenerateJob = async (
  queue: Queue,
  account: AccountDoc,
  scheduleId: string,
  scheduleJobId: string,
  post: PostItem,
  keyword: string,
  scheduledAt: string,
  jobId: string,
): Promise<void> => {
  const accountId = account.accountId;
  const blogId = account.blogId || accountId;

  const generateJob = await queue.add('generate', {
    scheduleId,
    scheduleJobId,
    keyword,
    category: CATEGORY,
    account: {
      id: accountId,
      password: account.password,
      blogId,
    },
    service: SERVICE,
    ref: REF,
    generateImages: true,
    imageCount: IMAGE_COUNT,
    imageSource: IMAGE_SOURCE,
    manuscriptType: MANUSCRIPT_TYPE,
    delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
    scheduledAt,
    mode: 'update',
    logNo: post.logNo,
    keywordCategory: KEYWORD_CATEGORY,
    blogName: account.nickname || accountId,
    imageDateCode: NAS_DATE_CODE,
  }, {
    jobId,
  });

  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
    generateJobId: String(generateJob.id),
    status: 'pending',
    $unset: { error: 1, completedAt: 1 },
  });
};

const isStaleActiveState = async (job: { getState: () => Promise<string>; processedOn?: number; timestamp: number }): Promise<boolean> => {
  const state = await job.getState();
  if (state !== 'active') {
    return false;
  }

  const startedAt = job.processedOn ?? job.timestamp;
  return Date.now() - startedAt > ACTIVE_JOB_RECOVERY_MS;
};

const recoverPublishJob = async (
  queue: Queue,
  generateQueue: Queue,
  account: AccountDoc,
  scheduleId: string,
  scheduleJob: ExistingScheduleJob,
  post: PostItem,
  keyword: string,
  scheduledAt: string,
): Promise<string | null> => {
  if (!['generated', 'publishing'].includes(scheduleJob.status)) {
    return null;
  }

  if (!scheduleJob.publishJobId) {
    const retryJobId = `${buildScheduleGenerateJobId(scheduleJob._id)}_resume_${Date.now()}`;
    await addGenerateJob(generateQueue, account, scheduleId, scheduleJob._id, post, keyword, scheduledAt, retryJobId);
    return 'publish-missing-regenerate';
  }

  const publishJob = await queue.getJob(scheduleJob.publishJobId);
  if (!publishJob) {
    const retryJobId = `${buildScheduleGenerateJobId(scheduleJob._id)}_resume_${Date.now()}`;
    await addGenerateJob(generateQueue, account, scheduleId, scheduleJob._id, post, keyword, scheduledAt, retryJobId);
    return 'publish-missing-regenerate';
  }

  const state = await publishJob.getState();
  if (state === 'failed') {
    await publishJob.retry('failed');
    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, {
      status: 'generated',
      $unset: { error: 1, completedAt: 1 },
    });
    return 'publish-retried';
  }

  if (await isStaleActiveState(publishJob)) {
    const retryJobId = `${scheduleJob.publishJobId}_resume_${Date.now()}`;
    await queue.add(publishJob.name, publishJob.data, { jobId: retryJobId });
    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, {
      publishJobId: retryJobId,
      status: 'generated',
      $unset: { error: 1, completedAt: 1 },
    });
    return 'publish-requeued-active';
  }

  return `publish-${state}`;
};

const ensureExistingGenerateJob = async (
  queue: Queue,
  account: AccountDoc,
  scheduleId: string,
  scheduleJob: ExistingScheduleJob,
  post: PostItem,
  keyword: string,
  scheduledAt: string,
): Promise<string> => {
  if (scheduleJob.status === 'published' && scheduleJob.postUrl) {
    return 'published';
  }

  const existingJobId = scheduleJob.generateJobId || buildScheduleGenerateJobId(scheduleJob._id);
  const existingBullJob = await queue.getJob(existingJobId);

  if (!existingBullJob) {
    const retryJobId = `${buildScheduleGenerateJobId(scheduleJob._id)}_resume_${Date.now()}`;
    await addGenerateJob(queue, account, scheduleId, scheduleJob._id, post, keyword, scheduledAt, retryJobId);
    return 'requeued';
  }

  const state = await existingBullJob.getState();

  if (state === 'failed') {
    await existingBullJob.retry('failed');
    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, {
      status: 'pending',
      $unset: { error: 1, completedAt: 1 },
    });
    return 'retried';
  }

  if (await isStaleActiveState(existingBullJob)) {
    const retryJobId = `${buildScheduleGenerateJobId(scheduleJob._id)}_resume_${Date.now()}`;
    await addGenerateJob(queue, account, scheduleId, scheduleJob._id, post, keyword, scheduledAt, retryJobId);
    return 'requeued-active';
  }

  return state;
};

const createOrRecoverAccountSchedule = async (
  account: AccountDoc,
  posts: PostItem[],
): Promise<string | null> => {
  const accountId = account.accountId;
  const keywords = requestedKeywords.get(accountId) ?? [];
  const scheduleDate = format(new Date(), 'yyyy-MM-dd');
  const queue = getGenerateQueue(accountId);
  const publishQueue = getPublishQueue(accountId);

  const existing = await ScheduleModel.findOne({ accountId, service: SERVICE, ref: REF })
    .lean<ExistingSchedule>();

  if (existing) {
    const existingJobs = await ScheduleJobModel.find({ scheduleId: existing._id })
      .sort({ slot: 1 })
      .lean<ExistingScheduleJob[]>();
    const bySlot = new Map(existingJobs.map((job) => [job.slot, job]));

    await ScheduleModel.findByIdAndUpdate(existing._id, {
      totalJobs: posts.length,
      status: 'processing',
      failedJobs: 0,
    });

    for (let index = 0; index < posts.length; index += 1) {
      const post = posts[index];
      const keyword = keywords[index];
      if (!keyword) {
        continue;
      }

      const slot = index + 1;
      const scheduledAt = formatKst(new Date(Date.now() + index * 60_000));
      const existingJob = bySlot.get(slot);

      if (!existingJob) {
        const scheduleJob = await ScheduleJobModel.create({
          scheduleId: existing._id,
          keyword,
          category: CATEGORY,
          scheduledAt,
          slot,
          status: 'pending',
        });
        await addGenerateJob(
          queue,
          account,
          existing._id,
          String(scheduleJob._id),
          post,
          keyword,
          scheduledAt,
          buildScheduleGenerateJobId(String(scheduleJob._id)),
        );
        console.log(`[added] ${account.nickname || accountId} ${slot}/${posts.length} logNo=${post.logNo} kw=${keyword} old="${post.title.slice(0, 48)}"`);
        continue;
      }

      const state = await recoverPublishJob(
        publishQueue,
        queue,
        account,
        existing._id,
        existingJob,
        post,
        keyword,
        scheduledAt,
      ) ?? await ensureExistingGenerateJob(
          queue,
          account,
          existing._id,
          existingJob,
          post,
          keyword,
          scheduledAt,
        );
      console.log(`[resume] ${account.nickname || accountId} ${slot}/${posts.length} job=${state} logNo=${post.logNo} kw=${keyword}`);
    }

    return existing._id;
  }

  const schedule = await ScheduleModel.create({
    accountId,
    service: SERVICE,
    ref: REF,
    scheduleDate,
    generateImages: true,
    imageCount: IMAGE_COUNT,
    delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
    totalJobs: posts.length,
    status: 'pending',
  });

  for (let index = 0; index < posts.length; index += 1) {
    const post = posts[index];
    const keyword = keywords[index];
    if (!keyword) {
      continue;
    }

    const scheduledAt = formatKst(new Date(Date.now() + index * 60_000));
    const scheduleJob = await ScheduleJobModel.create({
      scheduleId: schedule._id,
      keyword,
      category: CATEGORY,
      scheduledAt,
      slot: index + 1,
      status: 'pending',
    });

    await addGenerateJob(
      queue,
      account,
      String(schedule._id),
      String(scheduleJob._id),
      post,
      keyword,
      scheduledAt,
      buildScheduleGenerateJobId(String(scheduleJob._id)),
    );

    console.log(`[queued] ${account.nickname || accountId} ${index + 1}/${posts.length} logNo=${post.logNo} kw=${keyword} old="${post.title.slice(0, 48)}"`);
  }

  return String(schedule._id);
};

const summarize = async (scheduleIds: string[]): Promise<{ done: boolean; text: string }> => {
  const jobs = await ScheduleJobModel.find(
    { scheduleId: { $in: scheduleIds } },
    { status: 1 },
  );

  const counts = new Map<string, number>();
  for (const job of jobs) {
    counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  }

  const total = jobs.length;
  const published = counts.get('published') ?? 0;
  const failed = counts.get('failed') ?? 0;
  const generating = counts.get('generating') ?? 0;
  const generated = counts.get('generated') ?? 0;
  const publishing = counts.get('publishing') ?? 0;
  const pending = counts.get('pending') ?? 0;
  const done = total > 0 && published + failed >= total;
  const text = `total=${total} published=${published} failed=${failed} pending=${pending} generating=${generating} generated=${generated} publishing=${publishing}`;

  return { done, text };
};

const waitForCompletion = async (scheduleIds: string[]): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MONITOR_TIMEOUT_MS) {
    const summary = await summarize(scheduleIds);
    console.log(`[monitor] ${summary.text}`);
    if (summary.done) {
      return;
    }
    await sleep(MONITOR_INTERVAL_MS);
  }

  throw new Error('수정 작업 모니터링 타임아웃');
};

const main = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URI!);

  const accounts = await resolveAccounts();
  requestedKeywords = await loadNasKeywords(accounts);
  const scheduleIds: string[] = [];

  for (const account of accounts) {
    const blogId = account.blogId || account.accountId;
    const posts = await fetchLatestPosts(blogId);
    if (posts.length !== RECENT_POST_COUNT) {
      console.log(`[warn] ${account.accountId} latest posts=${posts.length}`);
    }

    if (DRY_RUN) {
      const keywords = requestedKeywords.get(account.accountId) ?? [];
      posts.forEach((post, index) => {
        console.log(`[dry] ${account.nickname || account.accountId} ${index + 1}/${posts.length} logNo=${post.logNo} old="${post.title.slice(0, 48)}" -> kw=${keywords[index] ?? '-'}`);
      });
      continue;
    }

    const scheduleId = await createOrRecoverAccountSchedule(account, posts);
    if (scheduleId) {
      scheduleIds.push(scheduleId);
    }
  }

  if (DRY_RUN) {
    return;
  }

  await waitForCompletion(scheduleIds);
};

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[fatal] ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllQueues().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  });
