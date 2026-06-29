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
const FINAL_STATES = new Set(['published', 'cancelled']);
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
  postUrl?: string;
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

const shouldSkip = (target: Target): boolean =>
  NON_RETRYABLE_PATTERNS.some((pattern) => target.error.includes(pattern));

const getJobData = async <T>(
  queue: Queue<T>,
  jobId?: string,
): Promise<T | null> => {
  if (!jobId) return null;
  const job = await queue.getJob(jobId);
  return job?.data ?? null;
};

const loadAllTargets = async (): Promise<Target[]> => {
  const schedules = await mongoose.connection.db.collection('schedules').find({
    scheduleDate: DATE,
    status: { $ne: 'cancelled' },
  }, {
    projection: { _id: 1, accountId: 1, service: 1 },
  }).toArray();
  const scheduleById = new Map(schedules.map((schedule) => [String(schedule._id), schedule]));

  const jobs = await mongoose.connection.db.collection('schedulejobs').find({
    scheduleId: { $in: schedules.map((schedule) => schedule._id) },
    scheduledAt: { $regex: `^${DATE}` },
  }).sort({ scheduledAt: 1 }).toArray();

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
        postUrl: job.postUrl,
      };
    })
    .filter((target): target is Target => Boolean(target));
};

const loadTargets = async (ids: string[]): Promise<{ targets: Target[]; allTargets: Target[] }> => {
  const allTargets = await loadAllTargets();
  const targets = ids.length > 0
    ? allTargets.filter((target) => ids.includes(target.scheduleJobId))
    : allTargets.filter((target) => !FINAL_STATES.has(target.status));
  return { targets, allTargets };
};

const findGeneratePayload = async (
  connection: IORedis,
  target: Target,
  allTargets: Target[],
): Promise<GenerateJobData | null> => {
  const queue = new Queue<GenerateJobData>(queueName('generate', target.accountId), { connection });
  try {
    const sameAccount = allTargets.filter((candidate) => candidate.accountId === target.accountId);
    const candidateIds = [
      target.generateJobId,
      ...sameAccount.map((candidate) => candidate.generateJobId),
    ].filter((jobId): jobId is string => Boolean(jobId));

    for (const jobId of candidateIds) {
      const data = await getJobData(queue, jobId);
      if (data?.account?.password) return data;
    }
    return null;
  } finally {
    await queue.close().catch(() => undefined);
  }
};

const findPublishPayload = async (
  connection: IORedis,
  target: Target,
): Promise<PublishJobData | null> => {
  const queue = new Queue<PublishJobData>(queueName('publish', target.accountId), { connection });
  try {
    return await getJobData(queue, target.publishJobId);
  } finally {
    await queue.close().catch(() => undefined);
  }
};

const waitForPublishJobId = async (scheduleJobId: string): Promise<string> => {
  for (let index = 0; index < 90; index += 1) {
    const job = await ScheduleJobModel.findById(scheduleJobId).lean();
    if (job?.publishJobId) return job.publishJobId;
    await sleep(1000);
  }
  throw new Error(`publishJobId not created: ${scheduleJobId}`);
};

const refreshTarget = async (scheduleJobId: string): Promise<Target | null> => {
  const job = await mongoose.connection.db.collection('schedulejobs').findOne({ _id: scheduleJobId });
  if (!job) return null;
  const schedule = await mongoose.connection.db.collection('schedules').findOne({ _id: job.scheduleId });
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
    postUrl: job.postUrl,
  };
};

const runPublish = async (
  connection: IORedis,
  target: Target,
  publishData: PublishJobData,
): Promise<Target | null> => {
  const publishJobId = `${target.publishJobId ?? `publish_${target.scheduleJobId}`}_direct_${Date.now()}`;
  await ScheduleJobModel.findByIdAndUpdate(target.scheduleJobId, {
    $set: { status: 'generated', publishJobId },
    $unset: { error: 1, completedAt: 1, postUrl: 1 },
  });
  await processPublish(makePublishJob(publishJobId, {
    ...publishData,
    scheduleId: target.scheduleId,
    scheduleJobId: target.scheduleJobId,
    service: target.service,
    keyword: target.keyword,
    scheduledAt: target.scheduledAt,
  }));
  return await refreshTarget(target.scheduleJobId);
};

const runGenerateThenPublish = async (
  connection: IORedis,
  target: Target,
  allTargets: Target[],
): Promise<Target | null> => {
  const generateData = await findGeneratePayload(connection, target, allTargets);
  if (!generateData) {
    throw new Error('generate-payload-missing');
  }

  const generateJobId = `${target.generateJobId ?? `generate_${target.scheduleJobId}`}_direct_${Date.now()}`;
  await ScheduleJobModel.findByIdAndUpdate(target.scheduleJobId, {
    $set: { status: 'pending', generateJobId },
    $unset: { error: 1, completedAt: 1, postUrl: 1, publishJobId: 1 },
  });
  await processGenerate(makeGenerateJob(generateJobId, {
    ...generateData,
    scheduleId: target.scheduleId,
    scheduleJobId: target.scheduleJobId,
    service: target.service,
    keyword: target.keyword,
    scheduledAt: target.scheduledAt,
  }));

  const refreshed = await refreshTarget(target.scheduleJobId);
  if (refreshed?.status === 'published') return refreshed;

  const publishJobId = await waitForPublishJobId(target.scheduleJobId);
  const publishTarget = {
    ...target,
    publishJobId,
  };
  const publishData = await findPublishPayload(connection, publishTarget);
  if (!publishData) {
    throw new Error('publish-payload-missing');
  }
  return await runPublish(connection, publishTarget, publishData);
};

const parseArgs = (): string[] => process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

const main = async (): Promise<void> => {
  const ids = parseArgs();
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  const connection = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });

  try {
    const { targets, allTargets } = await loadTargets(ids);
    for (const target of targets) {
      const prefix = `${target.accountId} ${target.scheduledAt.slice(11, 16)} ${target.keyword}`;
      if (FINAL_STATES.has(target.status)) {
        console.log(`[skip-final] ${prefix} status=${target.status}`);
        continue;
      }
      if (shouldSkip(target)) {
        console.log(`[skip-blocked] ${prefix} status=${target.status} error=${target.error.slice(0, 80)}`);
        continue;
      }

      try {
        const publishData = ['generated', 'publishing'].includes(target.status)
          ? await findPublishPayload(connection, target)
          : null;
        const result = publishData
          ? await runPublish(connection, target, publishData)
          : await runGenerateThenPublish(connection, target, allTargets);
        console.log(`[done] ${prefix} status=${result?.status ?? 'missing'} postUrl=${result?.postUrl ?? ''}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[failed] ${prefix} error=${message.slice(0, 180)}`);
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
