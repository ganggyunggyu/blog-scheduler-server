import type { FastifyInstance } from 'fastify';
import { generateQueue, publishQueue } from '../queues/queues';

export async function queueRoutes(app: FastifyInstance) {
  app.get('/queues/stats', async () => {
    const [generateCounts, publishCounts] = await Promise.all([
      generateQueue.getJobCounts(),
      publishQueue.getJobCounts(),
    ]);

    return {
      generate: generateCounts,
      publish: publishCounts,
    };
  });
}
