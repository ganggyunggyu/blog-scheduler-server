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

const SERVICE = 'pet-modify-k7d-fix';
const REF_BASE = '2026-05-21-k7d-fix';
const CATEGORY = '애견';
const KEYWORD_CATEGORY = '애견';
const MANUSCRIPT_TYPE = 'default';
const IMAGE_SOURCE = 'product';
const IMAGE_COUNT = 5;
const DELAY_BETWEEN_POSTS_SECONDS = 10;
const MONITOR_INTERVAL_MS = 30_000;
const MONITOR_TIMEOUT_MS = 60 * 60 * 1000;

interface Entry {
  blogId: string;
  keyword: string;
  logNo: string;
}

const ENTRIES: Entry[] = [
  { blogId: 'k7d9x2m4', keyword: '닥스훈트', logNo: '224291818922' },
  { blogId: 'k7d9x2m4', keyword: '강아지품종', logNo: '224291821391' },
];

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
  if (!account) throw new Error('k7d9x2m4 계정 없음');

  const queue: Queue = getGenerateQueue(account.accountId);

  for (const entry of ENTRIES) {
    const scheduleDate = format(new Date(), 'yyyy-MM-dd');
    const scheduledAt = formatKst(new Date());

    const schedule = await ScheduleModel.create({
      accountId: account.accountId,
      service: SERVICE,
      ref: `${REF_BASE}-${entry.keyword}-${Date.now()}`,
      scheduleDate,
      generateImages: true,
      imageCount: IMAGE_COUNT,
      delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
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
      ref: schedule.ref,
      generateImages: true,
      imageCount: IMAGE_COUNT,
      imageSource: IMAGE_SOURCE,
      manuscriptType: MANUSCRIPT_TYPE,
      delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
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

    const startedAt = Date.now();
    while (Date.now() - startedAt < MONITOR_TIMEOUT_MS) {
      const jobs = await ScheduleJobModel.find({ scheduleId: schedule._id }, { status: 1 });
      const published = jobs.filter((j) => j.status === 'published').length;
      const failed = jobs.filter((j) => j.status === 'failed').length;
      if (published + failed >= jobs.length && jobs.length > 0) {
        console.log(`[done] kw=${entry.keyword} published=${published} failed=${failed}`);
        break;
      }
      await sleep(MONITOR_INTERVAL_MS);
    }
  }
};

main()
  .catch((err: unknown) => {
    console.error(`[fatal] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllQueues().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  });
