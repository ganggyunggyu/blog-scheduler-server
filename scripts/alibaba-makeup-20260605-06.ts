import 'dotenv/config';
import mongoose from 'mongoose';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';
import { buildScheduleGenerateJobId } from '../src/services/schedule-idempotency.service.js';
import { formatKst } from '../src/services/schedule.service.js';
import { getGenerateQueue, getPublishQueue, closeAllQueues } from '../src/queues/queue-manager.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const SERVICE = 'alibaba-makeup-20260605-06';
const REF = 'makeup-20260605-20260606-long-gap';
const CATEGORY = '기타';
const IMAGE_COUNT = 5;
const DELAY_BETWEEN_POSTS_SECONDS = 180;
const START_AT = '2026-06-06T15:30:00+09:00';
const GAP_MINUTES = 35;
const ACCOUNT_STAGGER_MINUTES = 5;
const MONITOR_INTERVAL_MS = 30_000;
const MONITOR_TIMEOUT_MS = 5 * 60 * 60 * 1000;

interface AccountDoc {
  accountId: string;
  password: string;
  blogId?: string;
  nickname?: string;
  category?: string;
  isActive?: boolean;
}

interface TargetAccount {
  accountId: string;
  keywords: string[];
}

const targets: TargetAccount[] = [
  {
    accountId: 'crvfwy7062',
    keywords: ['중국공장', '중국쇼핑사이트', '중국수출', '중국무역', '상해박람회', '중국도매쇼핑몰'],
  },
  {
    accountId: 'heavymouse448',
    keywords: ['중국공장', '중국쇼핑사이트', '중국수출', '중국무역', '상해박람회', '중국도매쇼핑몰'],
  },
  {
    accountId: 'rqr1io45',
    keywords: ['중국공장', '중국쇼핑사이트', '중국수출', '중국무역', '상해박람회', '중국도매쇼핑몰'],
  },
  {
    accountId: 'mad1651',
    keywords: ['배대지', '구매대행', '해외구매대행', '직구배송조회', '직구사이트', '해외직구 사이트'],
  },
  {
    accountId: 'weed3122',
    keywords: ['배대지', '구매대행', '해외구매대행', '직구배송조회', '직구사이트', '해외직구 사이트'],
  },
  {
    accountId: 'individual14144',
    keywords: ['배대지', '구매대행', '해외구매대행', '직구배송조회', '직구사이트', '해외직구 사이트'],
  },
];

const parseKstDate = (value: string): Date => {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`invalid START_AT: ${value}`);
  }
  return new Date(timestamp);
};

const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * 60_000);

const resolveAccounts = async (): Promise<Map<string, AccountDoc>> => {
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const ids = targets.map((target) => target.accountId);
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

  return byId;
};

const enqueueAccount = async (
  account: AccountDoc,
  keywords: string[],
  accountIndex: number,
): Promise<string> => {
  const accountId = account.accountId;
  const start = addMinutes(parseKstDate(START_AT), accountIndex * ACCOUNT_STAGGER_MINUTES);
  const queue = getGenerateQueue(accountId);
  getPublishQueue(accountId);
  const existing = await ScheduleModel.findOne({
    accountId,
    service: SERVICE,
    ref: REF,
    status: { $in: ['pending', 'processing'] },
  }).sort({ createdAt: -1 });

  if (existing) {
    console.log(`[reuse] ${account.nickname || accountId} schedule=${existing._id}`);
    return String(existing._id);
  }

  const schedule = await ScheduleModel.create({
    accountId,
    service: SERVICE,
    ref: REF,
    scheduleDate: '2026-06-06',
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
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const accounts = await resolveAccounts();
  const scheduleIds: string[] = [];

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const account = accounts.get(target.accountId);
    if (!account) {
      throw new Error(`계정 없음: ${target.accountId}`);
    }
    scheduleIds.push(await enqueueAccount(account, target.keywords, index));
  }

  console.log(`[created] schedules=${scheduleIds.join(',')}`);
  await waitForCompletion(scheduleIds);
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser().catch(() => undefined);
    await closeAllQueues().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  });
