import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { redis } from '../config/redis.js';
import { defaultJobOptions } from './constants.js';
import { processGenerate, type GenerateJobData } from './generate.worker.js';
import { processPublish, type PublishJobData } from './publish.worker.js';
import { logger } from '../lib/logging/logger.js';
import { refreshBullBoard } from '../app.js';
import { runBrowserCleaner } from '../services/browser-cleaner.service.js';
import { createAccountExecutionCoordinator } from './account-execution.js';

const connection = redis as unknown as ConnectionOptions;
const log = logger.child({ scope: 'QueueManager' });
const areQueueWorkersDisabled = (): boolean => process.env.SCHEDULER_DISABLE_QUEUE_WORKERS === 'true';

const generateQueues = new Map<string, Queue>();
const publishQueues = new Map<string, Queue>();
const generateWorkers = new Map<string, Worker<GenerateJobData>>();
const publishWorkers = new Map<string, Worker<PublishJobData>>();

interface RunnableQueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  paused: number;
}

const maskAccountId = (accountId: string): string => `${accountId.slice(0, 6)}***`;

const getRunnableQueueCounts = async (queue: Queue | undefined): Promise<RunnableQueueCounts> => {
  if (!queue) {
    return { waiting: 0, active: 0, delayed: 0, paused: 0 };
  }

  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'paused');
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    paused: counts.paused ?? 0,
  };
};

const hasRunnableJobs = (counts: RunnableQueueCounts): boolean => (
  counts.waiting + counts.active + counts.delayed + counts.paused > 0
);

const isAccountQueueIdle = async (accountId: string): Promise<boolean> => {
  const [generateCounts, publishCounts] = await Promise.all([
    getRunnableQueueCounts(generateQueues.get(accountId)),
    getRunnableQueueCounts(publishQueues.get(accountId)),
  ]);

  return !hasRunnableJobs(generateCounts) && !hasRunnableJobs(publishCounts);
};

const accountExecution = createAccountExecutionCoordinator({
  isAccountIdle: isAccountQueueIdle,
  runCleaner: async (accountId) => {
    await runBrowserCleaner(accountId);
  },
  onCleanerError: (accountId, error) => {
    log.error('account.cleaner.failed', {
      accountId: maskAccountId(accountId),
      message: error instanceof Error ? error.message : String(error),
    });
  },
});

/*
  턴 확보는 잡 데이터의 원본 account.id 로, 반납은 워커 생성 시 이름으로 하고 있었다.
  `e4f-l` 로 잡고 `e4f_l` 로 반납을 시도하면 턴이 영원히 안 풀려서 다음 잡이 무한 대기한다.
  양쪽 다 같은 키로 정규화한다.
*/
const processGenerateWithAccountTurn = async (job: Job<GenerateJobData>): Promise<unknown> => {
  await accountExecution.waitForAccountTurn(normalizeAccountKey(job.data.account.id));
  return processGenerate(job);
};

const processPublishWithAccountTurn = async (job: Job<PublishJobData>): Promise<unknown> => {
  await accountExecution.waitForAccountTurn(normalizeAccountKey(job.data.account.id));
  return processPublish(job);
};

const releaseAccountTurnAfterSettledJob = async (
  type: 'generate' | 'publish',
  accountId: string,
  jobId?: string
): Promise<void> => {
  const released = await accountExecution.releaseAccountTurnIfIdle(normalizeAccountKey(accountId));
  if (!released) {
    return;
  }

  log.info('account.turn.released', {
    type,
    jobId,
    accountId: maskAccountId(accountId),
  });
};

const scheduleAccountTurnReleaseCheck = (
  type: 'generate' | 'publish',
  accountId: string,
  jobId?: string
): void => {
  void releaseAccountTurnAfterSettledJob(type, accountId, jobId).catch((error: unknown) => {
    log.error('account.turn.release.failed', {
      type,
      jobId,
      accountId: maskAccountId(accountId),
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

/*
  Redis 큐 이름은 영숫자만 남기므로 `e4f-l` 과 `e4f_l` 이 같은 큐가 된다.
  맵 키를 원본 accountId 로 두면 같은 큐에 Queue/Worker 가 두 벌 생겨 lock 을 두고 경합하고,
  잡이 active 에 물린 채 아무도 처리하지 않는 상태가 된다. 그래서 맵 키도 같은 규칙으로 정규화한다.
*/
const normalizeAccountKey = (accountId: string): string => accountId.replace(/[^a-zA-Z0-9]/g, '_');

const getQueueName = (type: 'generate' | 'publish', accountId: string): string =>
  `${type}_${normalizeAccountKey(accountId)}`;

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

    log.info('queues.restored', { count: accountIds.size, accounts: [...accountIds].map(maskAccountId) });
  } catch (error) {
    log.error('queues.restore.failed', { error: error instanceof Error ? error.message : String(error) });
  }
};

export const getGenerateQueue = (accountId: string): Queue => {
  const key = normalizeAccountKey(accountId);
  const existing = generateQueues.get(key);
  if (existing) return existing;

  const queueName = getQueueName('generate', accountId);
  const queue = new Queue(queueName, { connection, defaultJobOptions });

  generateQueues.set(key, queue);
  log.info('queue.created', { type: 'generate', accountId: maskAccountId(accountId) });
  if (areQueueWorkersDisabled()) {
    log.warn('worker.skipped', { type: 'generate', accountId: maskAccountId(accountId) });
  } else {
    ensureGenerateWorker(accountId);
  }
  refreshBullBoard();

  return queue;
};

export const getPublishQueue = (accountId: string): Queue => {
  const key = normalizeAccountKey(accountId);
  const existing = publishQueues.get(key);
  if (existing) return existing;

  const queueName = getQueueName('publish', accountId);
  const queue = new Queue(queueName, { connection, defaultJobOptions });

  publishQueues.set(key, queue);
  log.info('queue.created', { type: 'publish', accountId: maskAccountId(accountId) });
  if (areQueueWorkersDisabled()) {
    log.warn('worker.skipped', { type: 'publish', accountId: maskAccountId(accountId) });
  } else {
    ensurePublishWorker(accountId);
  }
  refreshBullBoard();

  return queue;
};

const ensureGenerateWorker = (accountId: string): Worker<GenerateJobData> => {
  const workerKey = normalizeAccountKey(accountId);
  const existing = generateWorkers.get(workerKey);
  if (existing) return existing;

  const queueName = getQueueName('generate', accountId);
  const worker = new Worker<GenerateJobData>(queueName, processGenerateWithAccountTurn, {
    connection,
    concurrency: 1,
    lockDuration: 600000,
    stalledInterval: 300000,
    maxStalledCount: 3,
  });

  worker.on('completed', (job) => {
    log.info('generate.completed', {
      jobId: job.id,
      accountId: maskAccountId(accountId),
    });
    scheduleAccountTurnReleaseCheck('generate', accountId, job.id);
  });

  worker.on('failed', (job, err) => {
    log.error('generate.failed', {
      jobId: job?.id,
      accountId: maskAccountId(accountId),
      message: err.message,
    });
    scheduleAccountTurnReleaseCheck('generate', accountId, job?.id);
  });

  generateWorkers.set(workerKey, worker);
  log.info('worker.created', { type: 'generate', accountId: maskAccountId(accountId) });

  return worker;
};

const ensurePublishWorker = (accountId: string): Worker<PublishJobData> => {
  const workerKey = normalizeAccountKey(accountId);
  const existing = publishWorkers.get(workerKey);
  if (existing) return existing;

  const queueName = getQueueName('publish', accountId);
  const worker = new Worker<PublishJobData>(queueName, processPublishWithAccountTurn, {
    connection,
    concurrency: 1,
    lockDuration: 600000,
    stalledInterval: 300000,
    maxStalledCount: 3,
  });

  worker.on('completed', (job) => {
    log.info('publish.completed', {
      jobId: job.id,
      accountId: maskAccountId(accountId),
    });
    scheduleAccountTurnReleaseCheck('publish', accountId, job.id);
  });

  worker.on('failed', (job, err) => {
    log.error('publish.failed', {
      jobId: job?.id,
      accountId: maskAccountId(accountId),
      message: err.message,
    });
    scheduleAccountTurnReleaseCheck('publish', accountId, job?.id);
  });

  publishWorkers.set(workerKey, worker);
  log.info('worker.created', { type: 'publish', accountId: maskAccountId(accountId) });

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

/** 큐에서 지워도 되는 종료 상태. active/waiting 은 실행 중이거나 실행 예정이라 제외한다. */
export type CleanableJobStatus = 'completed' | 'failed';

/**
 * 끝난 잡을 큐에서 걷어낸다.
 *
 * failed 를 지우는 건 재시도가 아니라 폐기다. BullMQ 의 failed 집합은 그냥 쌓여만 있고
 * 저절로 다시 돌지는 않지만, 남겨두면 대시보드 숫자가 계속 오염되고 나중에 사람이
 * 실수로 retry 를 눌러 이미 발행된 키워드가 중복 발행될 수 있다.
 */
export const cleanJobs = async (
  accountId: string,
  type: 'generate' | 'publish',
  status: CleanableJobStatus = 'completed',
  grace: number = 0
): Promise<number> => {
  const queue = type === 'generate'
    ? generateQueues.get(accountId)
    : publishQueues.get(accountId);

  if (!queue) return 0;

  const removed = await queue.clean(grace, 1000, status);
  log.info('queue.cleaned', {
    accountId: accountId.slice(0, 3) + '***',
    type,
    status,
    removed: removed.length,
  });
  return removed.length;
};

/** 기존 호출부 호환용. 새 코드는 cleanJobs 를 직접 쓴다. */
export const cleanCompletedJobs = async (
  accountId: string,
  type: 'generate' | 'publish',
  grace: number = 0
): Promise<number> => cleanJobs(accountId, type, 'completed', grace);
