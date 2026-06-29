import 'dotenv/config';
import { type Job } from 'bullmq';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { closeAllQueues, getPublishQueue } from '../src/queues/queue-manager.js';
import { processGenerate, type GenerateJobData } from '../src/queues/generate.worker.js';
import { processPublish, type PublishJobData } from '../src/queues/publish.worker.js';
import { ScheduleJobModel } from '../src/schemas/schedule.schema.js';

process.env.SCHEDULER_DISABLE_QUEUE_WORKERS = 'true';

type BlogAccountRecord = {
  accountId?: string;
  blogId?: string;
  nickname?: string;
  password?: string;
};

type ScheduleRecord = {
  _id: string;
  accountId: string;
  service: string;
  ref?: string;
  generateImages?: boolean;
  imageCount?: number;
  delayBetweenPostsSeconds?: number;
};

type ScheduleJobRecord = {
  _id: string;
  scheduleId: string;
  keyword: string;
  scheduledAt: string;
};

type RedisJobPayload = {
  account?: {
    id?: string;
    password?: string;
    blogId?: string;
  };
  blogName?: string;
};

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

const loadRuntimeAccountFromRedis = async (
  accountId: string,
): Promise<{ password?: string; blogId?: string; blogName?: string }> => {
  const prefixes = [`bull:generate_${accountId}:*`, `bull:publish_${accountId}:*`];

  for (const pattern of prefixes) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = nextCursor;

      for (const key of keys) {
        const type = await redis.type(key);
        if (type !== 'hash') continue;

        const raw = await redis.hget(key, 'data');
        if (!raw) continue;

        try {
          const data = JSON.parse(raw) as RedisJobPayload;
          if (data.account?.password) {
            return {
              password: data.account.password,
              blogId: data.account.blogId,
              blogName: data.blogName,
            };
          }
        } catch {
          // Ignore malformed stale queue entries.
        }
      }
    } while (cursor !== '0');
  }

  return {};
};

const imageDateCode = (scheduledAt: string): string =>
  `${scheduledAt.slice(5, 7)}${scheduledAt.slice(8, 10)}`;

const buildGenerateData = (
  schedule: ScheduleRecord,
  job: ScheduleJobRecord,
  account: BlogAccountRecord | undefined,
  runtime: { password?: string; blogId?: string; blogName?: string },
): GenerateJobData | null => {
  const password = account?.password ?? runtime.password;
  if (!password) return null;

  const isAlibaba = schedule.service === 'alibaba';
  const category = isAlibaba ? '기타' : '안과';

  return {
    scheduleId: String(job.scheduleId),
    scheduleJobId: String(job._id),
    keyword: job.keyword,
    category,
    account: {
      id: schedule.accountId,
      password,
      blogId: account?.blogId ?? runtime.blogId ?? schedule.accountId,
    },
    service: schedule.service,
    ref: schedule.ref ?? `${schedule.service}-direct-db-recover`,
    generateImages: schedule.generateImages ?? true,
    imageCount: schedule.imageCount ?? 5,
    imageSource: 'product',
    manuscriptType: isAlibaba ? 'alibaba' : 'default',
    delayBetweenPostsSeconds: schedule.delayBetweenPostsSeconds ?? 10,
    scheduledAt: job.scheduledAt,
    keywordCategory: category,
    blogName: account?.nickname ?? runtime.blogName ?? schedule.accountId,
    imageDateCode: imageDateCode(job.scheduledAt),
  };
};

const main = async (): Promise<void> => {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    throw new Error('usage: tsx work/direct-generate-from-db-20260629.ts <scheduleJobId...>');
  }

  await mongoose.connect(env.MONGO_URI);
  try {
    const jobs = await mongoose.connection.db.collection<ScheduleJobRecord>('schedulejobs')
      .find({ _id: { $in: ids } })
      .toArray();
    const schedules = await mongoose.connection.db.collection<ScheduleRecord>('schedules')
      .find({ _id: { $in: jobs.map((job) => job.scheduleId) } })
      .toArray();
    const scheduleById = new Map(schedules.map((schedule) => [String(schedule._id), schedule]));

    const accountIds = [...new Set(schedules.map((schedule) => schedule.accountId))];
    const accounts = await mongoose.connection.db.collection<BlogAccountRecord>('blogaccounts')
      .find({ accountId: { $in: accountIds } }, { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, password: 1 } })
      .toArray();
    const accountById = new Map(accounts.map((account) => [String(account.accountId), account]));

    for (const job of jobs.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))) {
      const schedule = scheduleById.get(String(job.scheduleId));
      if (!schedule) {
        console.log(`[directdb-skip] ${job._id} missing_schedule`);
        continue;
      }

      const runtime = await loadRuntimeAccountFromRedis(schedule.accountId);
      const data = buildGenerateData(schedule, job, accountById.get(schedule.accountId), runtime);
      if (!data) {
        console.log(`[directdb-skip] ${schedule.accountId} ${job.keyword} missing_runtime_password`);
        continue;
      }

      const generateJobId = `generate_directdb_${job._id}_${Date.now()}`;
      await ScheduleJobModel.findByIdAndUpdate(job._id, {
        $set: { status: 'pending', generateJobId },
        $unset: { error: 1, completedAt: 1, postUrl: 1, publishJobId: 1 },
      });

      try {
        const generateResult = await processGenerate(makeGenerateJob(generateJobId, data));
        const publishJobId = String(generateResult.publishJobId);
        const publishQueue = getPublishQueue(schedule.accountId);
        const publishJob = await publishQueue.getJob(publishJobId);
        if (!publishJob) throw new Error(`publish payload missing after generate: ${publishJobId}`);

        await processPublish(makePublishJob(publishJobId, publishJob.data));
        const refreshed = await ScheduleJobModel.findById(job._id).lean();
        console.log(`[directdb-publish] ${schedule.accountId} ${job.keyword} status=${refreshed?.status ?? 'missing'} postUrl=${refreshed?.postUrl ?? ''}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[directdb-failed] ${schedule.accountId} ${job.keyword} error=${message.slice(0, 180)}`);
      } finally {
        await closeAllQueues().catch(() => undefined);
        await closeBrowser().catch(() => undefined);
      }
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
