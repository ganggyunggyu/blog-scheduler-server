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

const SERVICE = 'pet-repair-k7d-four';
const REF = '2026-05-26-27-pet-repair';
const ACCOUNT_ID = 'k7d9x2m4';
const CATEGORY = '애견';
const KEYWORD_CATEGORY = '애견';
const MANUSCRIPT_TYPE = 'pet';
const IMAGE_SOURCE = 'product';
const IMAGE_COUNT = 5;
const DELAY_BETWEEN_POSTS_SECONDS = 10;
const MONITOR_INTERVAL_MS = 15_000;
const MONITOR_TIMEOUT_MS = 90 * 60 * 1000;

interface Entry {
  keyword: string;
  logNo: string;
  scheduledAt: string;
}

const ENTRIES: Entry[] = [
  { keyword: '그레이하운드', logNo: '224298259911', scheduledAt: '2026-05-27T21:50:19+09:00' },
  { keyword: '노르웨이숲고양이', logNo: '224298256737', scheduledAt: '2026-05-27T20:50:19+09:00' },
  { keyword: '고양이품종', logNo: '224298263133', scheduledAt: '2026-05-27T20:03:00+09:00' },
  { keyword: '고양이입양', logNo: '224297081657', scheduledAt: '2026-05-26T18:59:11+09:00' },
];

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

  const schedule = await ScheduleModel.create({
    accountId: account.accountId,
    service: SERVICE,
    ref: `${REF}-${Date.now()}`,
    scheduleDate: format(new Date(), 'yyyy-MM-dd'),
    generateImages: true,
    imageCount: IMAGE_COUNT,
    delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
    totalJobs: ENTRIES.length,
    status: 'pending',
  });

  const queue: Queue = getGenerateQueue(account.accountId);
  const scheduleJobIds: string[] = [];

  for (let index = 0; index < ENTRIES.length; index += 1) {
    const entry = ENTRIES[index];
    const scheduleJob = await ScheduleJobModel.create({
      scheduleId: schedule._id,
      keyword: entry.keyword,
      category: CATEGORY,
      scheduledAt: formatKst(new Date()),
      slot: index + 1,
      status: 'pending',
    });

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
      scheduledAt: entry.scheduledAt,
      mode: 'update',
      logNo: entry.logNo,
      keywordCategory: KEYWORD_CATEGORY,
      blogName: account.nickname || account.accountId,
    }, {
      jobId: buildScheduleGenerateJobId(String(scheduleJob._id)),
    });

    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, {
      generateJobId: String(generateJob.id),
      status: 'pending',
    });
    scheduleJobIds.push(String(scheduleJob._id));
    console.log(`[queued] ${index + 1}/${ENTRIES.length} keyword=${entry.keyword} logNo=${entry.logNo}`);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < MONITOR_TIMEOUT_MS) {
    const jobs = await ScheduleJobModel.find({ _id: { $in: scheduleJobIds } }, { keyword: 1, status: 1, error: 1, postUrl: 1 }).lean();
    const summary = jobs.reduce<Record<string, number>>((acc, job) => {
      acc[job.status] = (acc[job.status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`[monitor] ${JSON.stringify(summary)} ${jobs.map((job) => `${job.keyword}:${job.status}`).join(' | ')}`);
    if (jobs.length === ENTRIES.length && jobs.every((job) => job.status === 'published' || job.status === 'failed')) {
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
