import 'dotenv/config';
import mongoose from 'mongoose';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';
import { buildScheduleGenerateJobId } from '../src/services/schedule-idempotency.service.js';
import { formatKst } from '../src/services/schedule.service.js';
import { getGenerateQueue, getPublishQueue, closeAllQueues } from '../src/queues/queue-manager.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const SERVICE = 'alibaba-makeup-20260607';
const REF = 'keyword-plan-missing-20260607';
const CATEGORY = '기타';
const IMAGE_COUNT = 5;
const DELAY_BETWEEN_POSTS_SECONDS = 180;
const MIN_START_AT = '2026-06-07T16:20:00+09:00';
const IMAGE_DATE_CODE = '0607';
const GAP_MINUTES = 35;
const ACCOUNT_STAGGER_MINUTES = 5;
const MONITOR_INTERVAL_MS = 30_000;
const MONITOR_TIMEOUT_MS = 6 * 60 * 60 * 1000;

interface AccountDoc {
  accountId: string;
  password: string;
  blogId?: string;
  nickname?: string;
  isActive?: boolean;
}

interface TargetAccount {
  accountId: string;
  keywords: string[];
}

const targets: TargetAccount[] = [
  {
    accountId: 'crvfwy7062',
    keywords: ['중국도매', '중국수입', '광저우사입'],
  },
  {
    accountId: 'heavymouse448',
    keywords: ['중국도매', '중국수입', '광저우사입'],
  },
  {
    accountId: 'rqr1io45',
    keywords: ['중국도매', '중국수입', '광저우사입'],
  },
  {
    accountId: 'mad1651',
    keywords: ['해외통관번호조회', '해외직구 배송조회', '사입'],
  },
  {
    accountId: 'weed3122',
    keywords: ['해외통관번호조회', '해외직구 배송조회', '사입'],
  },
  {
    accountId: 'individual14144',
    keywords: ['해외통관번호조회', '해외직구 배송조회', '사입'],
  },
];

const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * 60_000);

const buildStartDate = (): Date => {
  const minimum = Date.parse(MIN_START_AT);
  const rolling = Date.now() + 30 * 60_000;
  return new Date(Math.max(minimum, rolling));
};

const buildTargetKeys = (): Set<string> => {
  const keys = new Set<string>();
  for (const target of targets) {
    for (const keyword of target.keywords) {
      keys.add(`${target.accountId}\u0000${keyword}`);
    }
  }
  return keys;
};

const findPublishedKeys = async (): Promise<Set<string>> => {
  const accountIds = targets.map((target) => target.accountId);
  const schedules = await ScheduleModel.find(
    { accountId: { $in: accountIds } },
    { _id: 1, accountId: 1 },
  ).lean();
  const scheduleAccount = new Map(schedules.map((schedule) => [String(schedule._id), schedule.accountId]));
  const jobs = await ScheduleJobModel.find(
    {
      scheduleId: { $in: schedules.map((schedule) => schedule._id) },
      status: 'published',
    },
    { scheduleId: 1, keyword: 1 },
  ).lean();
  const keys = new Set<string>();
  for (const job of jobs) {
    const accountId = scheduleAccount.get(String(job.scheduleId));
    if (accountId) {
      keys.add(`${accountId}\u0000${job.keyword}`);
    }
  }
  return keys;
};

const findExistingMakeupKeys = async (): Promise<Set<string>> => {
  const schedules = await ScheduleModel.find(
    { service: SERVICE, ref: REF, status: { $ne: 'cancelled' } },
    { _id: 1, accountId: 1 },
  ).lean();
  const scheduleAccount = new Map(schedules.map((schedule) => [String(schedule._id), schedule.accountId]));
  const jobs = await ScheduleJobModel.find(
    {
      scheduleId: { $in: schedules.map((schedule) => schedule._id) },
      status: { $ne: 'cancelled' },
    },
    { scheduleId: 1, keyword: 1 },
  ).lean();
  const keys = new Set<string>();
  for (const job of jobs) {
    const accountId = scheduleAccount.get(String(job.scheduleId));
    if (accountId) {
      keys.add(`${accountId}\u0000${job.keyword}`);
    }
  }
  return keys;
};

const resolveAccounts = async (): Promise<Map<string, AccountDoc>> => {
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const accountIds = targets.map((target) => target.accountId);
  const accounts = await cafeDb.collection<AccountDoc>('accounts')
    .find(
      {
        accountId: { $in: accountIds },
        isActive: { $ne: false },
      },
      {
        projection: {
          accountId: 1,
          password: 1,
          blogId: 1,
          nickname: 1,
          isActive: 1,
        },
      },
    )
    .toArray();
  const byId = new Map(accounts.map((account) => [account.accountId, account]));
  const missing = accountIds.filter((accountId) => !byId.get(accountId)?.password);
  if (missing.length > 0) {
    throw new Error(`계정 또는 비밀번호 없음: ${missing.join(', ')}`);
  }
  return byId;
};

const enqueueAccount = async (
  account: AccountDoc,
  keywords: string[],
  accountIndex: number,
  startDate: Date,
): Promise<string> => {
  const accountId = account.accountId;
  const queue = getGenerateQueue(accountId);
  getPublishQueue(accountId);
  const start = addMinutes(startDate, accountIndex * ACCOUNT_STAGGER_MINUTES);
  const schedule = await ScheduleModel.create({
    accountId,
    service: SERVICE,
    ref: REF,
    scheduleDate: '2026-06-07',
    generateImages: true,
    imageCount: IMAGE_COUNT,
    delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
    totalJobs: keywords.length,
    status: 'pending',
  });

  for (let index = 0; index < keywords.length; index += 1) {
    const keyword = keywords[index];
    const scheduledAt = formatKst(addMinutes(start, index * GAP_MINUTES));
    const scheduleJob = await ScheduleJobModel.create({
      scheduleId: schedule._id,
      keyword,
      category: CATEGORY,
      scheduledAt,
      slot: index + 1,
      status: 'pending',
    });
    const generateJob = await queue.add('generate', {
      scheduleId: String(schedule._id),
      scheduleJobId: String(scheduleJob._id),
      keyword,
      category: CATEGORY,
      keywordCategory: CATEGORY,
      account: {
        id: accountId,
        password: account.password,
        blogId: account.blogId || accountId,
      },
      service: SERVICE,
      ref: REF,
      generateImages: true,
      imageCount: IMAGE_COUNT,
      imageSource: 'product',
      imageDateCode: IMAGE_DATE_CODE,
      manuscriptType: 'alibaba',
      delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
      scheduledAt,
      blogName: account.nickname || accountId,
    }, {
      jobId: buildScheduleGenerateJobId(String(scheduleJob._id)),
    });
    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, {
      generateJobId: String(generateJob.id),
    });
    console.log(`[queued] ${account.nickname || accountId} ${index + 1}/${keywords.length} ${scheduledAt} ${keyword}`);
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
  const pending = counts.get('pending') ?? 0;
  const generating = counts.get('generating') ?? 0;
  const generated = counts.get('generated') ?? 0;
  const publishing = counts.get('publishing') ?? 0;
  const done = total > 0 && published + failed >= total;

  return {
    done,
    text: `total=${total} published=${published} failed=${failed} pending=${pending} generating=${generating} generated=${generated} publishing=${publishing}`,
  };
};

const waitForCompletion = async (scheduleIds: string[]): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MONITOR_TIMEOUT_MS) {
    const summary = await summarize(scheduleIds);
    console.log(`[monitor] ${summary.text}`);
    if (summary.done) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, MONITOR_INTERVAL_MS);
    });
  }
  throw new Error('monitor timeout');
};

const main = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URI!);
  const targetKeys = buildTargetKeys();
  const publishedKeys = await findPublishedKeys();
  const existingMakeupKeys = await findExistingMakeupKeys();
  const accounts = await resolveAccounts();
  const startDate = buildStartDate();
  const scheduleIds: string[] = [];

  for (let accountIndex = 0; accountIndex < targets.length; accountIndex += 1) {
    const target = targets[accountIndex];
    const keywords = target.keywords.filter((keyword) => {
      const key = `${target.accountId}\u0000${keyword}`;
      return targetKeys.has(key) && !publishedKeys.has(key) && !existingMakeupKeys.has(key);
    });
    if (keywords.length === 0) {
      console.log(`[skip] ${target.accountId} missing=0`);
      continue;
    }
    const account = accounts.get(target.accountId);
    if (!account) {
      throw new Error(`계정 없음: ${target.accountId}`);
    }
    scheduleIds.push(await enqueueAccount(account, keywords, accountIndex, startDate));
  }

  if (scheduleIds.length === 0) {
    console.log('[done] no missing targets to enqueue');
    return;
  }

  await waitForCompletion(scheduleIds);
};

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllQueues().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  });
