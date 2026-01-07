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

const log = logger.child({ scope: 'Worker' });

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
    log.info('generate.completed', { jobId: job.id });
  });

  generateWorker.on('failed', (job, err) => {
    log.error('generate.failed', { jobId: job?.id, message: err.message });
  });

  publishWorker.on('completed', (job) => {
    log.info('publish.completed', { jobId: job.id });
  });

  publishWorker.on('failed', (job, err) => {
    log.error('publish.failed', { jobId: job?.id, message: err.message });
  });

  log.info('init');

  return { generateWorker, publishWorker };
}

export async function closeWorkers(workers: Workers): Promise<void> {
  log.info('close.start');
  await Promise.all([
    workers.generateWorker.close(),
    workers.publishWorker.close(),
  ]);
  log.info('close.done');
}
