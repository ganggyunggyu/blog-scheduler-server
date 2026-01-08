import type { FastifyInstance } from 'fastify';
import { scheduleRoutes } from './schedule.route';
import { queueRoutes } from './queue.route';

export const registerRoutes = async (app: FastifyInstance) => {
  await app.register(scheduleRoutes);
  await app.register(queueRoutes);

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
}
