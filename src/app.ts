import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes';
import { connectMongo } from './config/mongo';
import { logger } from './lib/logger';

const log = logger.child({ scope: 'App' });

export interface AppContext {
  app: ReturnType<typeof Fastify>;
}

export const buildApp = async (): Promise<AppContext> => {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  await connectMongo();

  log.info('queues.dynamic');

  await registerRoutes(app);

  return { app };
}
