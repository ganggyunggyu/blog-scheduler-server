import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { registerRoutes } from './routes/index.js';
import { connectMongo } from './config/mongo.js';
import { getAllQueues, initializeExistingQueues } from './queues/queue-manager.js';
import { logger } from './lib/logging/logger.js';
import { redactJobData } from './lib/queue/redact-job-data.js';

const log = logger.child({ scope: 'App' });

/**
 * 잡 페이로드에는 네이버 비밀번호가 평문으로 들어가는데 /admin/queues 는
 * 인증 없이 열린다. 화면에 나가는 사본에서만 가린다.
 */
const toRedactedAdapter = (queue: ConstructorParameters<typeof BullMQAdapter>[0]): BullMQAdapter => {
  const adapter = new BullMQAdapter(queue);
  adapter.setFormatter('data', redactJobData);
  return adapter;
};

export interface AppContext {
  app: ReturnType<typeof Fastify>;
  refreshBullBoard: () => void;
}

let bullBoardInstance: ReturnType<typeof createBullBoard> | null = null;

export const refreshBullBoard = (): void => {
  if (!bullBoardInstance) return;
  bullBoardInstance.replaceQueues(getAllQueues().map(toRedactedAdapter));
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

  if (process.env.SCHEDULER_DISABLE_QUEUE_RESTORE === 'true') {
    log.warn('queues.restore.skipped', { reason: 'SCHEDULER_DISABLE_QUEUE_RESTORE' });
  } else {
    await initializeExistingQueues();
  }

  await registerRoutes(app);

  return { app, refreshBullBoard };
}
