import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes';
import { connectMongo } from './config/mongo';
import { initQueues, type Workers } from './queues';

export interface AppContext {
  app: ReturnType<typeof Fastify>;
  workers: Workers;
}

export async function buildApp(): Promise<AppContext> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  await connectMongo();
  const workers = await initQueues();

  await registerRoutes(app);

  return { app, workers };
}
