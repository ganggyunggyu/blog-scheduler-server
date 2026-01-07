import mongoose from 'mongoose';
import { buildApp, type AppContext } from './app';
import { env } from './config/env';
import { closeWorkers } from './queues';
import { closeBrowser } from './lib/playwright';
import { redis } from './config/redis';
import { logger } from './lib/logger';

let context: AppContext | null = null;
let isShuttingDown = false;

const log = logger.child({ scope: 'Server' });

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info('shutdown.start', { signal });

  if (context) {
    try {
      log.info('shutdown.http.close');
      await context.app.close();

      log.info('shutdown.workers.close');
      await closeWorkers(context.workers);

      log.info('shutdown.browser.close');
      await closeBrowser();

      log.info('shutdown.redis.close');
      await redis.quit();

      log.info('shutdown.mongo.close');
      await mongoose.disconnect();

      log.info('shutdown.complete');
    } catch (error) {
      log.error('shutdown.error', { error });
    }
  }

  process.exit(0);
}

async function main() {
  context = await buildApp();

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  await context.app.listen({ port: env.PORT, host: '0.0.0.0' });
  log.info('listen', { port: env.PORT });
}

main().catch((error) => {
  log.error('startup.error', { error });
  process.exit(1);
});
