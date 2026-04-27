import 'dotenv/config';
import mongoose from 'mongoose';
import { format } from 'date-fns';
import type { Queue } from 'bullmq';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';
import { formatKst } from '../src/services/schedule.service.js';
import { buildScheduleGenerateJobId } from '../src/services/schedule-idempotency.service.js';
import { getGenerateQueue, closeAllQueues } from '../src/queues/queue-manager.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const SERVICE = 'alibaba-modify-recent6';
const REF = '2026-04-27';
const CATEGORY = '기타';
const IMAGE_COUNT = 5;
const DELAY_BETWEEN_POSTS_SECONDS = 10;
const RECENT_POST_COUNT = 6;
const MONITOR_INTERVAL_MS = 30_000;
const MONITOR_TIMEOUT_MS = 4 * 60 * 60 * 1000;

const REQUESTED_KEYWORDS = new Map<string, string[]>([
  ['weed3122', ['글로벌소싱순위', '중국구매대행추천', '중국수입절차', '도매거래절차', '도매거래하는법', '도매구매대행']],
  ['mad1651', ['글로벌소싱업체', '글로벌소싱추천', '글로벌소싱후기', '도매거래방법', '알리바바닷컴도매방법', '중국직구사이트']],
  ['chemical12568', ['중국수입후기', '통관하는법', '해외ODM', '중국배송비', '중국수입', '해외ODM소싱']],
  ['copy11525', ['1688배대지수수료', '관세비용', '해외구매대행', '1688결제방법', '1688직구방법', '알리바바닷컴사입하는법']],
  ['individual14144', ['물류플랫폼', '수출플랫폼', '중국구매대행사이트', '수출컨설팅', '알리바바닷컴판매', '해외진출컨설팅']],
]);

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
  const ids = [...REQUESTED_KEYWORDS.keys()];
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
    imageSource: 'product',
    manuscriptType: 'alibaba',
    delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
    scheduledAt,
    mode: 'update',
    logNo: post.logNo,
    keywordCategory: CATEGORY,
    blogName: account.nickname || accountId,
  }, {
    jobId,
  });

  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
    generateJobId: String(generateJob.id),
    status: 'pending',
    $unset: { error: 1, completedAt: 1 },
  });
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

  return state;
};

const createOrRecoverAccountSchedule = async (
  account: AccountDoc,
  posts: PostItem[],
): Promise<string | null> => {
  const accountId = account.accountId;
  const keywords = REQUESTED_KEYWORDS.get(accountId) ?? [];
  const scheduleDate = format(new Date(), 'yyyy-MM-dd');
  const queue = getGenerateQueue(accountId);

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

      const state = await ensureExistingGenerateJob(
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

  for (const account of accounts) {
    const blogId = account.blogId || account.accountId;
    const posts = await fetchLatestPosts(blogId);
    if (posts.length !== RECENT_POST_COUNT) {
      console.log(`[warn] ${account.accountId} latest posts=${posts.length}`);
    }

    const scheduleId = await createOrRecoverAccountSchedule(account, posts);
    if (!scheduleId) {
      continue;
    }

    await waitForCompletion([scheduleId]);
    await closeAllQueues();
  }
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
