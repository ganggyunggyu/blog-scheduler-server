import type { FastifyInstance } from 'fastify';
import { getActiveAccounts } from '../queues/queue-manager';

export async function queueRoutes(app: FastifyInstance) {
  app.get('/queues/stats', async () => {
    const activeAccounts = getActiveAccounts();

    return {
      activeAccounts: activeAccounts.length,
      accounts: activeAccounts.map((id) => id.slice(0, 6) + '***'),
    };
  });
}
