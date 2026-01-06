import { Queue, type ConnectionOptions } from 'bullmq';
import { redis } from '../config/redis';
import { QUEUES, defaultJobOptions } from './constants';

const connection = redis as unknown as ConnectionOptions;

export const generateQueue = new Queue(QUEUES.GENERATE, {
  connection,
  defaultJobOptions,
});

export const publishQueue = new Queue(QUEUES.PUBLISH, {
  connection,
  defaultJobOptions,
});
