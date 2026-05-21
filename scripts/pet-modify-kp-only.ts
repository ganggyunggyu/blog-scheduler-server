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

const SERVICE = 'pet-modify-kp-only';
const REF = `2026-05-21-kp-${Date.now()}`;
const CATEGORY = '애견';
const KEYWORD_CATEGORY = '애견';
const MANUSCRIPT_TYPE = 'default';
const IMAGE_SOURCE = 'product';
const IMAGE_COUNT = 5;

interface AccountDoc {
  accountId: string;
  password: string;
  blogId?: string;
  nickname?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const account = await cafeDb.collection<AccountDoc>('accounts')
    .findOne({ accountId: 'k7d9x2m4' }, { projection: { accountId: 1, password: 1, blogId: 1, nickname: 1 } });
  if (!account) throw new Error('계정 없음');

  const queue: Queue = getGenerateQueue(account.accountId);

  const entry = { keyword: '강아지품종', logNo: '224291821391' };
  const scheduleDate = format(new Date(), 'yyyy-MM-dd');
  const scheduledAt = formatKst(new Date());

  const schedule = await ScheduleModel.create({
    accountId: account.accountId,
    service: SERVICE,
    ref: REF,
    scheduleDate,
    generateImages: true,
    imageCount: IMAGE_COUNT,
    delayBetweenPostsSeconds: 10,
    totalJobs: 1,
    status: 'pending',
  });

  const scheduleJob = await ScheduleJobModel.create({
    scheduleId: schedule._id,
    keyword: entry.keyword,
    category: CATEGORY,
    scheduledAt,
    slot: 1,
    status: 'pending',
  });

  const jobId = buildScheduleGenerateJobId(String(scheduleJob._id));
  const generateJob = await queue.add('generate', {
    scheduleId: schedule._id,
    scheduleJobId: String(scheduleJob._id),
    keyword: entry.keyword,
    category: CATEGORY,
    account: {
      id: account.accountId,
      password: account.password,
      blogId: account.blogId || account.accountId,
    },
    service: SERVICE,
    ref: REF,
    generateImages: true,
    imageCount: IMAGE_COUNT,
    imageSource: IMAGE_SOURCE,
    manuscriptType: MANUSCRIPT_TYPE,
    delayBetweenPostsSeconds: 10,
    scheduledAt,
    mode: 'update',
    logNo: entry.logNo,
    keywordCategory: KEYWORD_CATEGORY,
    blogName: account.nickname || account.accountId,
  }, { jobId });

  await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, {
    generateJobId: String(generateJob.id),
    status: 'pending',
  });
  console.log(`[queued] ${account.nickname} kw=${entry.keyword} logNo=${entry.logNo} schedule=${schedule._id}`);

  const TIMEOUT_MS = 60 * 60 * 1000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const j = await ScheduleJobModel.findById(scheduleJob._id, { status: 1, postUrl: 1, error: 1 }).lean();
    if (!j) break;
    const status = (j as any).status;
    if (status === 'published' || status === 'failed') {
      console.log(`[done] status=${status} postUrl=${(j as any).postUrl ?? '-'} error=${(j as any).error ?? '-'}`);
      break;
    }
    await sleep(30_000);
  }
};

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllQueues().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  });
