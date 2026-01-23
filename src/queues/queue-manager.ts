import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { redis } from '../config/redis';
import { defaultJobOptions } from './constants';
import { processGenerate } from './generate.worker';
import { processPublish } from './publish.worker';
import { logger } from '../lib/logger';
import { refreshBullBoard } from '../app';

const connection = redis as unknown as ConnectionOptions;
const log = logger.child({ scope: 'QueueManager' });

const generateQueues = new Map<string, Queue>();
const publishQueues = new Map<string, Queue>();
const generateWorkers = new Map<string, Worker>();
const publishWorkers = new Map<string, Worker>();

const getQueueName = (type: 'generate' | 'publish', accountId: string): string => {
  const safeAccountId = accountId.replace(/[^a-zA-Z0-9]/g, '_');
  return `${type}_${safeAccountId}`;
};

const extractAccountIdFromQueueName = (queueName: string): string | null => {
  const match = queueName.match(/^(generate|publish)_(.+)$/);
  if (!match) return null;
  return match[2].replace(/_/g, '@').replace(/@gmail@com$/, '@gmail.com').replace(/@naver@com$/, '@naver.com');
};

export const initializeExistingQueues = async (): Promise<void> => {
  try {
    const keys = await redis.keys('bull:*:meta');
    const queueNames = new Set<string>();

    for (const key of keys) {
      const match = key.match(/^bull:([^:]+):meta$/);
      if (match) {
        const queueName = match[1];
        if (queueName.startsWith('generate_') || queueName.startsWith('publish_')) {
          queueNames.add(queueName);
        }
      }
    }

    const accountIds = new Set<string>();
    for (const queueName of queueNames) {
      const type = queueName.startsWith('generate_') ? 'generate' : 'publish';
      const safeName = queueName.replace(`${type}_`, '');
      accountIds.add(safeName);
    }

    for (const safeAccountId of accountIds) {
      const accountId = safeAccountId;
      getGenerateQueue(accountId);
      getPublishQueue(accountId);
    }

    log.info('queues.restored', { count: accountIds.size, accounts: [...accountIds].map(id => id.slice(0, 6) + '***') });
  } catch (error) {
    log.error('queues.restore.failed', { error: error instanceof Error ? error.message : String(error) });
  }
};

export const getGenerateQueue = (accountId: string): Queue => {
  const existing = generateQueues.get(accountId);
  if (existing) return existing;

  const queueName = getQueueName('generate', accountId);
  const queue = new Queue(queueName, { connection, defaultJobOptions });

  generateQueues.set(accountId, queue);
  log.info('queue.created', { type: 'generate', accountId: accountId.slice(0, 6) + '***' });
  ensureGenerateWorker(accountId);
  refreshBullBoard();

  return queue;
};

export const getPublishQueue = (accountId: string): Queue => {
  const existing = publishQueues.get(accountId);
  if (existing) return existing;

  const queueName = getQueueName('publish', accountId);
  const queue = new Queue(queueName, { connection, defaultJobOptions });

  publishQueues.set(accountId, queue);
  log.info('queue.created', { type: 'publish', accountId: accountId.slice(0, 6) + '***' });
  ensurePublishWorker(accountId);
  refreshBullBoard();

  return queue;
};

const ensureGenerateWorker = (accountId: string): Worker => {
  const existing = generateWorkers.get(accountId);
  if (existing) return existing;

  const queueName = getQueueName('generate', accountId);
  const worker = new Worker(queueName, processGenerate, {
    connection,
    concurrency: 1,
  });

  worker.on('completed', (job) => {
    log.info('generate.completed', {
      jobId: job.id,
      accountId: accountId.slice(0, 6) + '***',
    });
  });

  worker.on('failed', (job, err) => {
    log.error('generate.failed', {
      jobId: job?.id,
      accountId: accountId.slice(0, 6) + '***',
      message: err.message,
    });
  });

  generateWorkers.set(accountId, worker);
  log.info('worker.created', { type: 'generate', accountId: accountId.slice(0, 6) + '***' });

  return worker;
};

const ensurePublishWorker = (accountId: string): Worker => {
  const existing = publishWorkers.get(accountId);
  if (existing) return existing;

  const queueName = getQueueName('publish', accountId);
  const worker = new Worker(queueName, processPublish, {
    connection,
    concurrency: 1,
  });

  worker.on('completed', (job) => {
    log.info('publish.completed', {
      jobId: job.id,
      accountId: accountId.slice(0, 6) + '***',
    });
  });

  worker.on('failed', (job, err) => {
    log.error('publish.failed', {
      jobId: job?.id,
      accountId: accountId.slice(0, 6) + '***',
      message: err.message,
    });
  });

  publishWorkers.set(accountId, worker);
  log.info('worker.created', { type: 'publish', accountId: accountId.slice(0, 6) + '***' });

  return worker;
};

export const closeAllQueues = async (): Promise<void> => {
  log.info('close.start', {
    generateWorkers: generateWorkers.size,
    publishWorkers: publishWorkers.size,
  });

  const closePromises: Promise<void>[] = [];

  for (const [accountId, worker] of generateWorkers) {
    closePromises.push(
      worker.close().then(() => {
        log.info('worker.closed', { type: 'generate', accountId: accountId.slice(0, 6) + '***' });
      })
    );
  }

  for (const [accountId, worker] of publishWorkers) {
    closePromises.push(
      worker.close().then(() => {
        log.info('worker.closed', { type: 'publish', accountId: accountId.slice(0, 6) + '***' });
      })
    );
  }

  await Promise.all(closePromises);

  const queueClosePromises: Promise<void>[] = [];

  for (const [, queue] of generateQueues) {
    queueClosePromises.push(queue.close());
  }

  for (const [, queue] of publishQueues) {
    queueClosePromises.push(queue.close());
  }

  await Promise.all(queueClosePromises);

  generateQueues.clear();
  publishQueues.clear();
  generateWorkers.clear();
  publishWorkers.clear();

  log.info('close.done');
};

export const getActiveAccounts = (): string[] => Array.from(generateQueues.keys());

export const getAllQueues = (): Queue[] => [
  ...Array.from(generateQueues.values()),
  ...Array.from(publishQueues.values()),
];

export const drainAccountQueues = async (
  accountId: string
): Promise<{ generate: number; publish: number }> => {
  const maskedAccount = accountId.slice(0, 3) + '***';
  const result = { generate: 0, publish: 0 };

  const generateQueue = generateQueues.get(accountId);
  if (generateQueue) {
    const counts = await generateQueue.getJobCounts('waiting', 'delayed', 'paused');
    result.generate = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.paused ?? 0);
    await generateQueue.drain(true);
  }

  const publishQueue = publishQueues.get(accountId);
  if (publishQueue) {
    const counts = await publishQueue.getJobCounts('waiting', 'delayed', 'paused');
    result.publish = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.paused ?? 0);
    await publishQueue.drain(true);
  }

  log.warn('queue.drained', { accountId: maskedAccount, ...result });
  return result;
};

export const drainAllQueues = async (): Promise<{
  totalAccounts: number;
  totalDrained: { generate: number; publish: number };
  accounts: Array<{ accountId: string; generate: number; publish: number }>;
}> => {
  const accountIds = [...generateQueues.keys()];
  const results: Array<{ accountId: string; generate: number; publish: number }> = [];
  const totals = { generate: 0, publish: 0 };

  for (const accountId of accountIds) {
    const result = await drainAccountQueues(accountId);
    results.push({
      accountId: accountId.slice(0, 3) + '***',
      ...result,
    });
    totals.generate += result.generate;
    totals.publish += result.publish;
  }

  log.warn('queues.all.drained', {
    accounts: accountIds.length,
    ...totals,
  });

  return {
    totalAccounts: accountIds.length,
    totalDrained: totals,
    accounts: results,
  };
};

export const removeJobFromQueue = async (
  accountId: string,
  jobId: string,
  type: 'generate' | 'publish'
): Promise<boolean> => {
  const queue = type === 'generate'
    ? generateQueues.get(accountId)
    : publishQueues.get(accountId);

  if (!queue) return false;

  try {
    await queue.remove(jobId);
    return true;
  } catch {
    return false;
  }
};

export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface AccountQueueStatus {
  accountId: string;
  maskedAccountId: string;
  generate: QueueCounts;
  publish: QueueCounts;
}

export interface QueueJob {
  id: string;
  name: string;
  data: Record<string, unknown>;
  status: string;
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  progress: number | object | string | boolean;
}

const getQueueCounts = async (queue: Queue | undefined): Promise<QueueCounts> => {
  if (!queue) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 };
  }
  const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
    paused: counts.paused ?? 0,
  };
};

export const getQueuesDashboard = async (): Promise<{
  accounts: AccountQueueStatus[];
  totals: { generate: QueueCounts; publish: QueueCounts };
}> => {
  const accounts: AccountQueueStatus[] = [];
  const totals = {
    generate: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
    publish: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
  };

  const accountIds = new Set([...generateQueues.keys(), ...publishQueues.keys()]);

  for (const accountId of accountIds) {
    const generateCounts = await getQueueCounts(generateQueues.get(accountId));
    const publishCounts = await getQueueCounts(publishQueues.get(accountId));

    accounts.push({
      accountId,
      maskedAccountId: accountId.slice(0, 3) + '***',
      generate: generateCounts,
      publish: publishCounts,
    });

    totals.generate.waiting += generateCounts.waiting;
    totals.generate.active += generateCounts.active;
    totals.generate.completed += generateCounts.completed;
    totals.generate.failed += generateCounts.failed;
    totals.generate.delayed += generateCounts.delayed;
    totals.generate.paused += generateCounts.paused;

    totals.publish.waiting += publishCounts.waiting;
    totals.publish.active += publishCounts.active;
    totals.publish.completed += publishCounts.completed;
    totals.publish.failed += publishCounts.failed;
    totals.publish.delayed += publishCounts.delayed;
    totals.publish.paused += publishCounts.paused;
  }

  return { accounts, totals };
};

export const getAccountQueueJobs = async (
  accountId: string,
  type: 'generate' | 'publish',
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' = 'waiting',
  limit: number = 20
): Promise<QueueJob[]> => {
  const queue = type === 'generate'
    ? generateQueues.get(accountId)
    : publishQueues.get(accountId);

  if (!queue) return [];

  const jobs = await queue.getJobs([status], 0, limit - 1);

  return jobs.map((job) => ({
    id: job.id ?? '',
    name: job.name,
    data: job.data as Record<string, unknown>,
    status,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    failedReason: job.failedReason,
    progress: job.progress,
  }));
};

export const retryFailedJob = async (
  accountId: string,
  jobId: string,
  type: 'generate' | 'publish'
): Promise<boolean> => {
  const queue = type === 'generate'
    ? generateQueues.get(accountId)
    : publishQueues.get(accountId);

  if (!queue) return false;

  try {
    const job = await queue.getJob(jobId);
    if (job) {
      await job.retry();
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

export const cleanCompletedJobs = async (
  accountId: string,
  type: 'generate' | 'publish',
  grace: number = 0
): Promise<number> => {
  const queue = type === 'generate'
    ? generateQueues.get(accountId)
    : publishQueues.get(accountId);

  if (!queue) return 0;

  const removed = await queue.clean(grace, 1000, 'completed');
  return removed.length;
};
