import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { registerRoutes } from './routes';
import { connectMongo } from './config/mongo';
import { initQueues, type Workers } from './queues';
import { generateQueue, publishQueue } from './queues/queues';

export interface AppContext {
  app: ReturnType<typeof Fastify>;
  workers: Workers;
}

export async function buildApp(): Promise<AppContext> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullMQAdapter(generateQueue), new BullMQAdapter(publishQueue)],
    serverAdapter,
  });

  await app.register(serverAdapter.registerPlugin(), { prefix: '/admin/queues' });

  await connectMongo();
  const workers = await initQueues();

  await registerRoutes(app);

  return { app, workers };
}
