import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { getGenerateQueue, getPublishQueue, closeAllQueues } from '../src/queues/queue-manager.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const main = async (): Promise<void> => {
  await mongoose.connect(env.MONGO_URI);
  try {
    getGenerateQueue('n7c3w8z2');
    getPublishQueue('n7c3w8z2');

    const db = mongoose.connection.db;
    if (!db) throw new Error('db missing');
    const schedule = await db.collection('schedules').findOne({
      scheduleDate: '2026-06-28',
      accountId: 'n7c3w8z2',
      service: 'pet-sheet-sunday-20260628',
    });
    if (!schedule) throw new Error('schedule missing');

    for (let tick = 0; tick < 90; tick += 1) {
      const jobs = await db.collection('schedulejobs').find(
        { scheduleId: schedule._id },
        {
          projection: {
            keyword: 1,
            status: 1,
            postUrl: 1,
            error: 1,
            updatedAt: 1,
            publishJobId: 1,
          },
        },
      ).toArray();

      console.log(JSON.stringify({
        tick,
        jobs: jobs.map((job) => ({
          keyword: job.keyword,
          status: job.status,
          postUrl: job.postUrl,
          error: job.error,
          updatedAt: job.updatedAt,
          publishJobId: job.publishJobId,
        })),
      }));

      const target = jobs.find((job) => job.keyword === '스핑크스고양이');
      if (target && ['published', 'failed', 'cancelled'].includes(target.status)) {
        return;
      }
      await sleep(10_000);
    }
  } finally {
    await closeAllQueues().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
