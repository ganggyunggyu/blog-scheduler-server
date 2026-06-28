import 'dotenv/config';
import { connectMongo } from '../src/config/mongo.js';
import { redis } from '../src/config/redis.js';
import { initializeExistingQueues, closeAllQueues } from '../src/queues/queue-manager.js';

const main = async (): Promise<void> => {
  await connectMongo();
  await initializeExistingQueues();
  console.log(JSON.stringify({
    started: true,
    pid: process.pid,
    role: 'queue-workers-only',
    at: new Date().toISOString(),
  }));
};

const shutdown = async (): Promise<void> => {
  await closeAllQueues().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  process.exit(0);
};

process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});

setInterval(() => undefined, 60_000);
