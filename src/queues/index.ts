import { Worker, type ConnectionOptions } from 'bullmq';
import { redis } from '../config/redis';
import { QUEUES } from './constants';
import { processGenerate } from './generate.worker';
import { processPublish } from './publish.worker';
import { logger } from '../lib/logger';

const connection = redis as unknown as ConnectionOptions;

export interface Workers {
  generateWorker: Worker;
  publishWorker: Worker;
}

export async function initQueues(): Promise<Workers> {
  const generateWorker = new Worker(QUEUES.GENERATE, processGenerate, {
    connection,
    concurrency: 2,
  });

  const publishWorker = new Worker(QUEUES.PUBLISH, processPublish, {
    connection,
    concurrency: 1,
  });

  generateWorker.on('completed', (job) => {
    logger.info(`[Worker] Generate job ${job.id} completed`);
  });

  generateWorker.on('failed', (job, err) => {
    logger.error(`[Worker] Generate job ${job?.id} failed: ${err.message}`);
  });

  publishWorker.on('completed', (job) => {
    logger.info(`[Worker] Publish job ${job.id} completed`);
  });

  publishWorker.on('failed', (job, err) => {
    logger.error(`[Worker] Publish job ${job?.id} failed: ${err.message}`);
  });

  logger.info('[Worker] Workers initialized');

  return { generateWorker, publishWorker };
}

export async function closeWorkers(workers: Workers): Promise<void> {
  logger.info('[Worker] Closing workers...');
  await Promise.all([
    workers.generateWorker.close(),
    workers.publishWorker.close(),
  ]);
  logger.info('[Worker] Workers closed');
}
