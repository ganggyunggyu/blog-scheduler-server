import 'dotenv/config';
import { Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { closeAllQueues } from '../src/queues/queue-manager.js';
import { processGenerate, type GenerateJobData } from '../src/queues/generate.worker.js';
import { processPublish, type PublishJobData } from '../src/queues/publish.worker.js';
import { ScheduleJobModel } from '../src/schemas/schedule.schema.js';

process.env.SCHEDULER_DISABLE_QUEUE_WORKERS = 'true';

const DATE = '2026-06-28';
const FINAL_STATES = new Set(['published', 'failed', 'cancelled']);
const NON_RETRYABLE_PATTERNS = [
  '아이디를 보호하고 있습니다',
  '계정 잠금',
  '비밀번호 오류',
  '존재하지 않는 계정',
  '보호조치',
  'n7c3w8z2 보안문자/로그인 blocker',
];

interface Target {
  scheduleJobId: string;
  scheduleId: string;
  accountId: string;
  service: string;
  status: string;
  keyword: string;
  scheduledAt: string;
  error: string;
  generateJobId?: string;
  publishJobId?: string;
}

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const queueName = (type: 'generate' | 'publish', accountId: string): string =>
  `${type}_${accountId.replace(/[^a-zA-Z0-9]/g, '_')}`;

const makeGenerateJob = (
  id: string,
  data: GenerateJobData,
): Job<GenerateJobData> => ({
  id,
  data,
  opts: { attempts: 1 },
  attemptsMade: 0,
} as unknown as Job<GenerateJobData>);

const makePublishJob = (
  id: string,
  data: PublishJobData,
): Job<PublishJobData> => ({
  id,
  data,
  opts: { attempts: 1 },
  attemptsMade: 0,
} as unknown as Job<PublishJobData>);

const getBullJobSnapshot = async <T>(
  queue: Queue<T>,
  jobId: string,
): Promise<{ data: T; state: string } | null> => {
  const job = await queue.getJob(jobId);
  if (!job) return null;
  const state = await job.getState();
  const data = job.data;
  if (state !== 'active') {
    await job.remove().catch(() => undefined);
  }
  return { data, state };
};

const shouldSkip = (target: Target): boolean =>
  NON_RETRYABLE_PATTERNS.some((pattern) => target.error.includes(pattern));

const waitForPublishJobId = async (scheduleJobId: string): Promise<string> => {
  for (let index = 0; index < 60; index += 1) {
    const job = await ScheduleJobModel.findById(scheduleJobId).lean();
    if (job?.publishJobId) return job.publishJobId;
    await sleep(1000);
  }
  throw new Error(`publishJobId not created: ${scheduleJobId}`);
};

const refreshStatus = async (scheduleJobId: string): Promise<string> => {
  const job = await ScheduleJobModel.findById(scheduleJobId).lean();
  return job?.status ?? 'missing';
};

const runPublish = async (
  connection: IORedis,
  target: Target,
  publishJobId: string,
): Promise<string> => {
  const queue = new Queue<PublishJobData>(queueName('publish', target.accountId), { connection });
  try {
    const snapshot = await getBullJobSnapshot(queue, publishJobId);
    if (!snapshot) return 'publish-payload-missing';

    await ScheduleJobModel.findByIdAndUpdate(target.scheduleJobId, {
      $set: { status: 'generated' },
      $unset: { error: 1, completedAt: 1 },
    });

    await processPublish(makePublishJob(publishJobId, snapshot.data));
    return await refreshStatus(target.scheduleJobId);
  } finally {
    await queue.close().catch(() => undefined);
  }
};

const runGenerateThenPublish = async (
  connection: IORedis,
  target: Target,
): Promise<string> => {
  if (!target.generateJobId) return 'generate-job-id-missing';

  const generateQueue = new Queue<GenerateJobData>(queueName('generate', target.accountId), { connection });
  try {
    const snapshot = await getBullJobSnapshot(generateQueue, target.generateJobId);
    if (!snapshot) return 'generate-payload-missing';

    await ScheduleJobModel.findByIdAndUpdate(target.scheduleJobId, {
      $set: { status: 'pending', generateJobId: target.generateJobId },
      $unset: { error: 1, completedAt: 1, postUrl: 1, publishJobId: 1 },
    });

    await processGenerate(makeGenerateJob(target.generateJobId, snapshot.data));
  } finally {
    await generateQueue.close().catch(() => undefined);
  }

  const publishJobId = await waitForPublishJobId(target.scheduleJobId);
  return runPublish(connection, target, publishJobId);
};

const loadTargets = async (ids: string[]): Promise<Target[]> => {
  const schedules = await mongoose.connection.db.collection('schedules').find({
    scheduleDate: DATE,
    status: { $ne: 'cancelled' },
  }, {
    projection: { _id: 1, accountId: 1, service: 1 },
  }).toArray();
  const scheduleById = new Map(schedules.map((schedule) => [String(schedule._id), schedule]));

  const filter = ids.length > 0
    ? { _id: { $in: ids } }
    : {
      scheduleId: { $in: schedules.map((schedule) => schedule._id) },
      scheduledAt: { $regex: `^${DATE}` },
      status: { $nin: ['published', 'cancelled'] },
    };

  const jobs = await mongoose.connection.db.collection('schedulejobs').find(filter).sort({ scheduledAt: 1 }).toArray();

  return jobs
    .map((job): Target | null => {
      const schedule = scheduleById.get(String(job.scheduleId));
      if (!schedule) return null;
      return {
        scheduleJobId: String(job._id),
        scheduleId: String(job.scheduleId),
        accountId: schedule.accountId,
        service: schedule.service,
        status: job.status,
        keyword: job.keyword,
        scheduledAt: job.scheduledAt,
        error: String(job.error ?? ''),
        generateJobId: job.generateJobId,
        publishJobId: job.publishJobId,
      };
    })
    .filter((target): target is Target => Boolean(target))
    .filter((target) => !FINAL_STATES.has(target.status) || target.status === 'failed');
};

const parseArgs = (): { ids: string[]; max: number } => {
  const ids: string[] = [];
  let max = Number.POSITIVE_INFINITY;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === '--max') {
      max = Number(process.argv[index + 1] ?? '0');
      index += 1;
    } else {
      ids.push(arg);
    }
  }
  return { ids, max };
};

const main = async (): Promise<void> => {
  const { ids, max } = parseArgs();
  await mongoose.connect(env.MONGO_URI);
  const connection = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });

  try {
    const targets = (await loadTargets(ids)).filter((target) => !shouldSkip(target)).slice(0, max);
    for (const target of targets) {
      const prefix = `${target.accountId} ${target.scheduledAt.slice(11, 16)} ${target.keyword}`;
      try {
        const status = target.publishJobId && ['generated', 'publishing', 'failed'].includes(target.status)
          ? await runPublish(connection, target, target.publishJobId)
          : await runGenerateThenPublish(connection, target);

        if (status === 'publish-payload-missing' || status === 'generate-payload-missing') {
          const fallback = await runGenerateThenPublish(connection, target);
          console.log(`[recover] ${prefix} fallback=${fallback}`);
        } else {
          console.log(`[recover] ${prefix} status=${status}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[recover-failed] ${prefix} error=${message.slice(0, 180)}`);
      } finally {
        await closeAllQueues().catch(() => undefined);
        await closeBrowser().catch(() => undefined);
      }
    }
  } finally {
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
