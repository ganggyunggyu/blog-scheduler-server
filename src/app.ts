import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { registerRoutes } from './routes/index.js';
import { connectMongo } from './config/mongo.js';
import { getAllQueues, initializeExistingQueues } from './queues/queue-manager.js';
import { logger } from './lib/logging/logger.js';

const log = logger.child({ scope: 'App' });

export interface AppContext {
  app: ReturnType<typeof Fastify>;
  refreshBullBoard: () => void;
}

let bullBoardInstance: ReturnType<typeof createBullBoard> | null = null;

export const refreshBullBoard = (): void => {
  if (!bullBoardInstance) return;
  const queues = getAllQueues().map((q) => new BullMQAdapter(q));
  bullBoardInstance.replaceQueues(queues);
};

export const buildApp = async (): Promise<AppContext> => {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  await connectMongo();

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/admin/queues');

  bullBoardInstance = createBullBoard({
    queues: [],
    serverAdapter,
  });

  await app.register(serverAdapter.registerPlugin(), {
    prefix: '/admin/queues',
  });

  log.info('bullboard.ready', { path: '/admin/queues' });

  await initializeExistingQueues();

  await registerRoutes(app);

  return { app, refreshBullBoard };
}
