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

const SERVICE = 'pet-repair-k7d-shih-tzu';
const REF = '2026-05-22-pet-repair';
const ACCOUNT_ID = 'k7d9x2m4';
const KEYWORD = '시추';
const CATEGORY = '애견';
const KEYWORD_CATEGORY = '애견';
const MANUSCRIPT_TYPE = 'pet';
const IMAGE_SOURCE = 'product';
const IMAGE_COUNT = 5;
const LOG_NO = '224293353716';
const SCHEDULED_AT = '2026-05-22T14:12:50+09:00';
const MONITOR_INTERVAL_MS = 15_000;
const MONITOR_TIMEOUT_MS = 60 * 60 * 1000;

interface AccountDoc {
  accountId: string;
  password: string;
  blogId?: string;
  nickname?: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const main = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const account = await cafeDb.collection<AccountDoc>('accounts')
    .findOne(
      { accountId: ACCOUNT_ID },
      { projection: { accountId: 1, password: 1, blogId: 1, nickname: 1 } },
    );
  if (!account?.password) {
    throw new Error(`${ACCOUNT_ID} 계정 또는 비밀번호 없음`);
  }

  const scheduleDate = format(new Date(), 'yyyy-MM-dd');
  const scheduledAt = formatKst(new Date());
  const schedule = await ScheduleModel.create({
    accountId: account.accountId,
    service: SERVICE,
    ref: `${REF}-${Date.now()}`,
    scheduleDate,
    generateImages: true,
    imageCount: IMAGE_COUNT,
    delayBetweenPostsSeconds: 10,
    totalJobs: 1,
    status: 'pending',
  });

  const scheduleJob = await ScheduleJobModel.create({
    scheduleId: schedule._id,
    keyword: KEYWORD,
    category: CATEGORY,
    scheduledAt,
    slot: 1,
    status: 'pending',
  });

  const queue: Queue = getGenerateQueue(account.accountId);
  const generateJob = await queue.add('generate', {
    scheduleId: schedule._id,
    scheduleJobId: String(scheduleJob._id),
    keyword: KEYWORD,
    category: CATEGORY,
    account: {
      id: account.accountId,
      password: account.password,
      blogId: account.blogId || account.accountId,
    },
    service: SERVICE,
    ref: schedule.ref,
    generateImages: true,
    imageCount: IMAGE_COUNT,
    imageSource: IMAGE_SOURCE,
    manuscriptType: MANUSCRIPT_TYPE,
    delayBetweenPostsSeconds: 10,
    scheduledAt: SCHEDULED_AT,
    mode: 'update',
    logNo: LOG_NO,
    keywordCategory: KEYWORD_CATEGORY,
    blogName: account.nickname || account.accountId,
  }, {
    jobId: buildScheduleGenerateJobId(String(scheduleJob._id)),
  });

  await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, {
    generateJobId: String(generateJob.id),
    status: 'pending',
  });

  console.log(`[queued] account=${account.accountId} keyword=${KEYWORD} logNo=${LOG_NO} schedule=${schedule._id}`);

  const startedAt = Date.now();
  while (Date.now() - startedAt < MONITOR_TIMEOUT_MS) {
    const current = await ScheduleJobModel.findById(scheduleJob._id, { status: 1, error: 1, postUrl: 1 }).lean();
    console.log(`[monitor] status=${current?.status ?? 'missing'} postUrl=${current?.postUrl ?? '-'} error=${current?.error ?? '-'}`);
    if (current?.status === 'published' || current?.status === 'failed') {
      break;
    }
    await sleep(MONITOR_INTERVAL_MS);
  }
};

main()
  .catch((error: unknown) => {
    console.error(`[fatal] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllQueues().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  });
