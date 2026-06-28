import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { getGenerateQueue, getPublishQueue, closeAllQueues } from '../src/queues/queue-manager.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const DATE = '2026-06-28';
const FINAL = new Set(['published', 'failed', 'cancelled']);
const SKIP_PATTERNS = [
  '아이디를 보호하고 있습니다',
  '보호조치',
  '비밀번호 오류',
  '계정 잠금',
  '존재하지 않는 계정',
  'n7c3w8z2 보안문자/로그인 blocker',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeAccount = (accountId) => accountId.replace(/[^a-zA-Z0-9]/g, '_');
const qName = (type, accountId) => `${type}_${safeAccount(accountId)}`;

const parseArgs = () => {
  const ids = [];
  let maxAccounts = Number.POSITIVE_INFINITY;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === '--max-accounts') {
      maxAccounts = Number(process.argv[index + 1] ?? '0');
      index += 1;
    } else {
      ids.push(arg);
    }
  }
  return { ids, maxAccounts };
};

const shouldSkip = (job) => SKIP_PATTERNS.some((pattern) => String(job.error ?? '').includes(pattern));

const loadTargets = async (ids) => {
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
    .map((job) => {
      const schedule = scheduleById.get(String(job.scheduleId));
      if (!schedule) return null;
      return {
        id: String(job._id),
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
    .filter(Boolean)
    .filter((job) => !shouldSkip(job));
};

const findGeneratePayload = async (connection, accountId, target, group) => {
  const queue = new Queue(qName('generate', accountId), { connection });
  try {
    const candidateIds = [
      target.generateJobId,
      ...group.map((job) => job.generateJobId),
    ].filter(Boolean);
    for (const id of candidateIds) {
      const bullJob = await queue.getJob(id);
      if (bullJob?.data?.account?.password) {
        return bullJob.data;
      }
    }
    return null;
  } finally {
    await queue.close().catch(() => undefined);
  }
};

const prepareGenerate = async (connection, accountId, target, group) => {
  const queue = getGenerateQueue(accountId);
  const existing = target.generateJobId ? await queue.getJob(target.generateJobId) : null;
  const state = existing ? await existing.getState() : 'missing';

  if (existing && state === 'failed') {
    await mongoose.connection.db.collection('schedulejobs').updateOne(
      { _id: target.id },
      {
        $set: { status: 'pending' },
        $unset: { error: 1, completedAt: 1, postUrl: 1, publishJobId: 1 },
      },
    );
    await existing.retry('failed');
    return `generate-retry:${state}`;
  }

  if (existing && ['waiting', 'delayed', 'paused'].includes(state)) {
    await mongoose.connection.db.collection('schedulejobs').updateOne(
      { _id: target.id },
      {
        $set: { status: 'pending' },
        $unset: { error: 1, completedAt: 1, postUrl: 1, publishJobId: 1 },
      },
    );
    if (state === 'delayed') await existing.promote().catch(() => undefined);
    return `generate-existing:${state}`;
  }

  const payload = await findGeneratePayload(connection, accountId, target, group);
  if (!payload) return `generate-payload-missing:${state}`;

  const retryJobId = `${target.generateJobId ?? `generate_${target.id}`}_recover_${Date.now()}`;
  await queue.add('generate', {
    ...payload,
    scheduleId: target.scheduleId,
    scheduleJobId: target.id,
    keyword: target.keyword,
    service: target.service,
    scheduledAt: target.scheduledAt,
  }, {
    jobId: retryJobId,
  });

  await mongoose.connection.db.collection('schedulejobs').updateOne(
    { _id: target.id },
    {
      $set: { status: 'pending', generateJobId: retryJobId },
      $unset: { error: 1, completedAt: 1, postUrl: 1, publishJobId: 1 },
    },
  );
  return `generate-requeued:${state}`;
};

const preparePublish = async (accountId, target) => {
  if (!target.publishJobId) return null;
  const queue = getPublishQueue(accountId);
  const existing = await queue.getJob(target.publishJobId);
  if (!existing) return 'publish-missing';
  const state = await existing.getState();
  await mongoose.connection.db.collection('schedulejobs').updateOne(
    { _id: target.id },
    {
      $set: { status: 'generated' },
      $unset: { error: 1, completedAt: 1, postUrl: 1 },
    },
  );
  if (state === 'failed') {
    await existing.retry('failed');
    return `publish-retry:${state}`;
  }
  if (state === 'delayed') {
    await existing.promote().catch(() => undefined);
  }
  return `publish-existing:${state}`;
};

const loadStatuses = async (ids) => {
  const jobs = await mongoose.connection.db.collection('schedulejobs').find(
    { _id: { $in: ids } },
    { projection: { _id: 1, status: 1, keyword: 1, error: 1, postUrl: 1 } },
  ).toArray();
  return jobs.map((job) => ({
    id: String(job._id),
    keyword: job.keyword,
    status: job.status,
    error: String(job.error ?? '').slice(0, 100),
    postUrl: job.postUrl ?? '',
  }));
};

const recoverAccount = async (connection, accountId, group) => {
  console.log(`[account] start ${accountId} jobs=${group.length}`);
  getGenerateQueue(accountId);
  getPublishQueue(accountId);

  for (const target of group) {
    const prepared = target.publishJobId && ['generated', 'publishing'].includes(target.status)
      ? await preparePublish(accountId, target)
      : await prepareGenerate(connection, accountId, target, group);
    console.log(`[prepare] ${accountId} ${target.scheduledAt.slice(11, 16)} ${target.keyword} ${prepared}`);
  }

  const ids = group.map((target) => target.id);
  for (let tick = 0; tick < 90; tick += 1) {
    const statuses = await loadStatuses(ids);
    const open = statuses.filter((job) => !FINAL.has(job.status));
    console.log(`[status] ${accountId} tick=${tick} open=${open.length} ${statuses.map((job) => `${job.keyword}:${job.status}`).join(' | ')}`);
    if (open.length === 0) return statuses;
    await sleep(20_000);
  }
  return loadStatuses(ids);
};

const main = async () => {
  const { ids, maxAccounts } = parseArgs();
  await mongoose.connect(env.MONGO_URI);
  const connection = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });

  try {
    const targets = await loadTargets(ids);
    const byAccount = new Map();
    for (const target of targets) {
      const group = byAccount.get(target.accountId) ?? [];
      group.push(target);
      byAccount.set(target.accountId, group);
    }

    let processed = 0;
    for (const [accountId, group] of byAccount) {
      if (processed >= maxAccounts) break;
      try {
        const result = await recoverAccount(connection, accountId, group);
        console.log(`[account] done ${accountId} ${JSON.stringify(result)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[account] failed ${accountId} ${message.slice(0, 200)}`);
      } finally {
        await closeAllQueues().catch(() => undefined);
        await closeBrowser().catch(() => undefined);
      }
      processed += 1;
    }
  } finally {
    await connection.quit().catch(() => undefined);
    await closeAllQueues().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
