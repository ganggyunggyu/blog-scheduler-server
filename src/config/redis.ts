import { Redis as IORedis } from 'ioredis';
import { env } from './env.js';

export const redis = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  db: env.REDIS_DB,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});
