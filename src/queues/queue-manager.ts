import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { redis } from '../config/redis';
import { defaultJobOptions } from './constants';
import { processGenerate } from './generate.worker';
import { processPublish } from './publish.worker';
import { logger } from '../lib/logger';

const connection = redis as unknown as ConnectionOptions;
const log = logger.child({ scope: 'QueueManager' });

// 계정별 큐 저장소
const generateQueues = new Map<string, Queue>();
const publishQueues = new Map<string, Queue>();

// 계정별 워커 저장소
const generateWorkers = new Map<string, Worker>();
const publishWorkers = new Map<string, Worker>();

// 큐 이름 생성 (BullMQ는 콜론 사용 불가)
function getQueueName(type: 'generate' | 'publish', accountId: string): string {
  const safeAccountId = accountId.replace(/[^a-zA-Z0-9]/g, '_');
  return `${type}_${safeAccountId}`;
}

// Generate 큐 가져오기 (없으면 생성)
export function getGenerateQueue(accountId: string): Queue {
  const existing = generateQueues.get(accountId);
  if (existing) return existing;

  const queueName = getQueueName('generate', accountId);
  const queue = new Queue(queueName, { connection, defaultJobOptions });

  generateQueues.set(accountId, queue);
  log.info('queue.created', { type: 'generate', accountId: accountId.slice(0, 6) + '***' });

  // 워커도 함께 생성
  ensureGenerateWorker(accountId);

  return queue;
}

// Publish 큐 가져오기 (없으면 생성)
export function getPublishQueue(accountId: string): Queue {
  const existing = publishQueues.get(accountId);
  if (existing) return existing;

  const queueName = getQueueName('publish', accountId);
  const queue = new Queue(queueName, { connection, defaultJobOptions });

  publishQueues.set(accountId, queue);
  log.info('queue.created', { type: 'publish', accountId: accountId.slice(0, 6) + '***' });

  // 워커도 함께 생성
  ensurePublishWorker(accountId);

  return queue;
}

// Generate 워커 생성 (계정당 concurrency: 1)
function ensureGenerateWorker(accountId: string): Worker {
  const existing = generateWorkers.get(accountId);
  if (existing) return existing;

  const queueName = getQueueName('generate', accountId);
  const worker = new Worker(queueName, processGenerate, {
    connection,
    concurrency: 1, // 계정당 1개씩 순차 처리
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
}

// Publish 워커 생성 (계정당 concurrency: 1)
function ensurePublishWorker(accountId: string): Worker {
  const existing = publishWorkers.get(accountId);
  if (existing) return existing;

  const queueName = getQueueName('publish', accountId);
  const worker = new Worker(queueName, processPublish, {
    connection,
    concurrency: 1, // 계정당 1개씩 순차 처리
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
}

// 모든 워커/큐 종료
export async function closeAllQueues(): Promise<void> {
  log.info('close.start', {
    generateWorkers: generateWorkers.size,
    publishWorkers: publishWorkers.size,
  });

  const closePromises: Promise<void>[] = [];

  // 워커 먼저 종료
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

  // 큐 종료
  const queueClosePromises: Promise<void>[] = [];

  for (const [, queue] of generateQueues) {
    queueClosePromises.push(queue.close());
  }

  for (const [, queue] of publishQueues) {
    queueClosePromises.push(queue.close());
  }

  await Promise.all(queueClosePromises);

  // Map 초기화
  generateQueues.clear();
  publishQueues.clear();
  generateWorkers.clear();
  publishWorkers.clear();

  log.info('close.done');
}

// 활성 계정 목록 조회
export function getActiveAccounts(): string[] {
  return Array.from(generateQueues.keys());
}

// 특정 계정의 큐에서 작업 제거
export async function removeJobFromQueue(
  accountId: string,
  jobId: string,
  type: 'generate' | 'publish'
): Promise<boolean> {
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
}
