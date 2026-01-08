import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes';
import { connectMongo } from './config/mongo';
import { logger } from './lib/logger';

const log = logger.child({ scope: 'App' });

export interface AppContext {
  app: ReturnType<typeof Fastify>;
}

export async function buildApp(): Promise<AppContext> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  await connectMongo();

  // 계정별 동적 큐/워커는 요청 시 자동 생성됨
  log.info('queues.dynamic', { message: '계정별 큐/워커는 요청 시 자동 생성됩니다' });

  await registerRoutes(app);

  return { app };
}
