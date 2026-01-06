import mongoose from 'mongoose';
import { buildApp, type AppContext } from './app';
import { env } from './config/env';
import { closeWorkers } from './queues';
import { closeBrowser } from './lib/playwright';
import { redis } from './config/redis';
import { logger } from './lib/logger';

let context: AppContext | null = null;
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`[Server] Received ${signal}, starting graceful shutdown...`);

  if (context) {
    try {
      logger.info('[Server] Closing HTTP server...');
      await context.app.close();

      logger.info('[Server] Closing workers...');
      await closeWorkers(context.workers);

      logger.info('[Server] Closing browser...');
      await closeBrowser();

      logger.info('[Server] Closing Redis...');
      await redis.quit();

      logger.info('[Server] Closing MongoDB...');
      await mongoose.disconnect();

      logger.info('[Server] Graceful shutdown completed');
    } catch (error) {
      logger.error('[Server] Error during shutdown:', error);
    }
  }

  process.exit(0);
}

async function main() {
  context = await buildApp();

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  await context.app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`[Server] Listening on port ${env.PORT}`);
}

main().catch((error) => {
  logger.error('[Server] Startup error:', error);
  process.exit(1);
});
