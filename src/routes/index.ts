import type { FastifyInstance } from 'fastify';
import { scheduleRoutes } from './schedule.route.js';
import { queueRoutes } from './queue.route.js';
import { authRoutes } from './auth.route.js';
import { blogAccountRoutes } from './blog-account.route.js';
import { contentPipelineRoutes } from './content-pipeline.route.js';
import { captchaRoutes } from './captcha.route.js';

export const registerRoutes = async (app: FastifyInstance) => {
  // register 로 감싸면 인증 훅이 자식 스코프에만 걸려서, 최상위 인스턴스에 직접 붙인다.
  await authRoutes(app);

  await app.register(blogAccountRoutes);
  await app.register(contentPipelineRoutes);
  await app.register(scheduleRoutes);
  await app.register(queueRoutes);
  await app.register(captchaRoutes);

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
}
