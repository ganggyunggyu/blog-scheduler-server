import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { ScheduleJobModel } from '../src/schemas/schedule.schema.js';
import { processGenerate } from '../src/queues/generate.worker.js';
import { processPublish } from '../src/queues/publish.worker.js';
import { closeAllQueues } from '../src/queues/queue-manager.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const ACCOUNT_ID = 'n7c3w8z2';
const HAIRLESS_JOB_ID = 'publish_job_80396cf0-1a27-4432-8132-9556e7047103';
const SPHYNX_GENERATE_JOB_ID = 'generate_job_4ff7b5c8-d6ad-4348-bc0d-b21873535906';

const main = async (): Promise<void> => {
  await mongoose.connect(env.MONGO_URI);
  const connection = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });

  const generateQueue = new Queue(`generate_${ACCOUNT_ID}`, { connection });
  const publishQueue = new Queue(`publish_${ACCOUNT_ID}`, { connection });

  try {
    const hairlessPublishJob = await publishQueue.getJob(HAIRLESS_JOB_ID);
    if (!hairlessPublishJob) {
      throw new Error(`missing publish job: ${HAIRLESS_JOB_ID}`);
    }

    await ScheduleJobModel.findByIdAndUpdate(hairlessPublishJob.data.scheduleJobId, {
      $set: { status: 'generated' },
      $unset: { postUrl: 1, error: 1, completedAt: 1 },
    });
    const hairlessResult = await processPublish(hairlessPublishJob);
    console.log(JSON.stringify({
      accountId: ACCOUNT_ID,
      keyword: '털없는고양이',
      result: hairlessResult,
    }));

    const sphynxGenerateJob = await generateQueue.getJob(SPHYNX_GENERATE_JOB_ID);
    if (!sphynxGenerateJob) {
      throw new Error(`missing generate job: ${SPHYNX_GENERATE_JOB_ID}`);
    }
    await sphynxGenerateJob.remove();
    const generateResult = await processGenerate(sphynxGenerateJob);
    console.log(JSON.stringify({
      accountId: ACCOUNT_ID,
      keyword: '스핑크스고양이',
      phase: 'generate',
      result: generateResult,
    }));

    const refreshed = await ScheduleJobModel.findById(sphynxGenerateJob.data.scheduleJobId).lean();
    const publishJobId = refreshed?.publishJobId;
    if (!publishJobId) {
      throw new Error('missing publish job id after generate');
    }
    const sphynxPublishJob = await publishQueue.getJob(publishJobId);
    if (!sphynxPublishJob) {
      throw new Error(`missing publish job after generate: ${publishJobId}`);
    }
    const sphynxResult = await processPublish(sphynxPublishJob);
    console.log(JSON.stringify({
      accountId: ACCOUNT_ID,
      keyword: '스핑크스고양이',
      phase: 'publish',
      result: sphynxResult,
    }));
  } finally {
    await generateQueue.close().catch(() => undefined);
    await publishQueue.close().catch(() => undefined);
    await connection.quit().catch(() => undefined);
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
