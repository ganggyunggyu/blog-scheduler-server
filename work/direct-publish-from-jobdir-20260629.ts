import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { closeAllQueues } from '../src/queues/queue-manager.js';
import { processPublish, type PublishJobData } from '../src/queues/publish.worker.js';
import { ScheduleJobModel } from '../src/schemas/schedule.schema.js';

process.env.SCHEDULER_DISABLE_QUEUE_WORKERS = 'true';

const JOB_DIRS = new Map<string, string>([
  ['job_5b0649a9-06bd-4b74-b0f1-0f9c34a0b6ad', 'data/jobs/20260628_114819_라섹'],
  ['job_f7454afd-1e3d-41f4-9ac3-aee1fbfa45c5', 'data/jobs/20260628_114818_녹내장초기증상'],
  ['job_7dfc24b3-2bde-43ff-849b-caa767e18b21', 'data/jobs/20260628_114819_라식수술비용'],
  ['job_0e2a2a16-03cb-400b-aa99-3676b951c690', 'data/jobs/20260628_114817_스마일프로가격'],
]);

type BlogAccountRecord = {
  accountId?: string;
  blogId?: string;
  password?: string;
};

type ScheduleRecord = {
  _id: string;
  accountId: string;
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
};

const makePublishJob = (
  id: string,
  data: PublishJobData,
) => ({
  id,
  data,
  opts: { attempts: 1 },
  attemptsMade: 0,
}) as Parameters<typeof processPublish>[0];

const listFiles = async (dir: string): Promise<string[]> => {
  try {
    const names = await fs.readdir(dir);
    return names
      .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
      .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
};

const readManuscript = async (jobDir: string): Promise<{ title: string; content: string }> => {
  const raw = await fs.readFile(path.join(jobDir, 'manuscript.txt'), 'utf8');
  const [title = '', ...contentLines] = raw.split(/\r?\n/);
  return {
    title: title.trim(),
    content: contentLines.join('\n').trim(),
  };
};

const loadRuntimeAccountFromRedis = async (
  accountId: string,
): Promise<{ password?: string; blogId?: string }> => {
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

const main = async (): Promise<void> => {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    throw new Error('usage: tsx work/direct-publish-from-jobdir-20260629.ts <scheduleJobId...>');
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
      .find({ accountId: { $in: accountIds } }, { projection: { _id: 0, accountId: 1, blogId: 1, password: 1 } })
      .toArray();
    const accountById = new Map(accounts.map((account) => [String(account.accountId), account]));

    for (const job of jobs.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))) {
      const schedule = scheduleById.get(String(job.scheduleId));
      const jobDir = JOB_DIRS.get(String(job._id));
      if (!schedule || !jobDir) {
        console.log(`[jobdir-skip] ${job._id} missing_schedule_or_jobdir`);
        continue;
      }

      const account = accountById.get(schedule.accountId);
      const runtimeAccount = await loadRuntimeAccountFromRedis(schedule.accountId);
      const password = account?.password ?? runtimeAccount.password ?? '';
      const blogId = account?.blogId ?? runtimeAccount.blogId;

      if (!password) {
        console.log(`[jobdir-skip] ${schedule.accountId} ${job.keyword} missing_runtime_password`);
        continue;
      }

      const manuscript = await readManuscript(jobDir);
      const images = await listFiles(path.join(jobDir, 'images'));
      const publishJobId = `publish_jobdir_${job._id}_${Date.now()}`;

      await ScheduleJobModel.findByIdAndUpdate(job._id, {
        $set: { status: 'generated', publishJobId },
        $unset: { error: 1, completedAt: 1 },
      });

      try {
        await processPublish(makePublishJob(publishJobId, {
          scheduleId: String(job.scheduleId),
          scheduleJobId: String(job._id),
          account: {
            id: schedule.accountId,
            password,
            blogId,
          },
          jobDir,
          manuscript: {
            title: manuscript.title,
            content: manuscript.content,
            images,
          },
          category: '안과',
          keywordCategory: '안과',
          manuscriptType: 'default',
          throttleSeconds: schedule.delayBetweenPostsSeconds ?? 0,
          scheduledAt: job.scheduledAt,
        }));

        const refreshed = await ScheduleJobModel.findById(job._id).lean();
        console.log(`[jobdir-publish] ${schedule.accountId} ${job.keyword} status=${refreshed?.status ?? 'missing'} postUrl=${refreshed?.postUrl ?? ''}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[jobdir-failed] ${schedule.accountId} ${job.keyword} error=${message.slice(0, 180)}`);
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
