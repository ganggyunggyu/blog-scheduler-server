import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { redis } from '../config/redis';
import { defaultJobOptions } from './constants';
import { processGenerate } from './generate.worker';
import { processPublish } from './publish.worker';
import { logger } from '../lib/logger';

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

export const getGenerateQueue = (accountId: string): Queue => {
  const existing = generateQueues.get(accountId);
  if (existing) return existing;

  const queueName = getQueueName('generate', accountId);
  const queue = new Queue(queueName, { connection, defaultJobOptions });

  generateQueues.set(accountId, queue);
  log.info('queue.created', { type: 'generate', accountId: accountId.slice(0, 6) + '***' });
  ensureGenerateWorker(accountId);

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
