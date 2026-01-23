import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getActiveAccounts,
  getQueuesDashboard,
  getAccountQueueJobs,
  retryFailedJob,
  cleanCompletedJobs,
  drainAccountQueues,
  drainAllQueues,
} from '../queues/queue-manager';

const jobQuerySchema = z.object({
  type: z.enum(['generate', 'publish']).default('generate'),
  status: z.enum(['waiting', 'active', 'completed', 'failed', 'delayed']).default('waiting'),
  limit: z.coerce.number().min(1).max(100).default(20),
});

const retrySchema = z.object({
  type: z.enum(['generate', 'publish']),
  jobId: z.string(),
});

const cleanSchema = z.object({
  type: z.enum(['generate', 'publish']),
  grace: z.number().min(0).default(0),
});

export const queueRoutes = async (app: FastifyInstance) => {
  // 전체 대시보드 조회
  app.get('/api/queues/dashboard', async () => {
    const dashboard = await getQueuesDashboard();
    return {
      timestamp: new Date().toISOString(),
      ...dashboard,
    };
  });

  // 기존 간단한 stats (호환성 유지)
  app.get('/queues/stats', async () => {
    const activeAccounts = getActiveAccounts();
    return {
      activeAccounts: activeAccounts.length,
      accounts: activeAccounts.map((id) => id.slice(0, 6) + '***'),
    };
  });

  // 특정 계정의 작업 목록 조회
  app.get('/api/queues/:accountId/jobs', async (req) => {
    const { accountId } = req.params as { accountId: string };
    const query = jobQuerySchema.parse(req.query);

    const jobs = await getAccountQueueJobs(accountId, query.type, query.status, query.limit);

    return {
      accountId: accountId.slice(0, 3) + '***',
      type: query.type,
      status: query.status,
      count: jobs.length,
      jobs: jobs.map((job) => ({
        ...job,
        data: {
          keyword: (job.data as { keyword?: string }).keyword,
          scheduledAt: (job.data as { scheduledAt?: string }).scheduledAt,
          mode: (job.data as { mode?: string }).mode,
        },
      })),
    };
  });

  // 실패한 작업 재시도
  app.post('/api/queues/:accountId/retry', async (req, reply: FastifyReply) => {
    const { accountId } = req.params as { accountId: string };
    const body = retrySchema.parse(req.body);

    const success = await retryFailedJob(accountId, body.jobId, body.type);

    if (!success) {
      return reply.status(404).send({ success: false, message: 'Job not found or retry failed' });
    }

    return { success: true, jobId: body.jobId };
  });

  // 완료된 작업 정리
  app.post('/api/queues/:accountId/clean', async (req) => {
    const { accountId } = req.params as { accountId: string };
    const body = cleanSchema.parse(req.body);

    const removed = await cleanCompletedJobs(accountId, body.type, body.grace);

    return { success: true, removed };
  });

  // 특정 계정 큐 비우기 (waiting/delayed/paused)
  app.post('/api/queues/:accountId/drain', async (req) => {
    const { accountId } = req.params as { accountId: string };

    const result = await drainAccountQueues(accountId);

    return {
      success: true,
      accountId: accountId.slice(0, 3) + '***',
      drained: result,
    };
  });

  // 전체 큐 초기화 (모든 계정의 대기 작업 삭제)
  app.post('/api/queues/drain-all', async () => {
    const result = await drainAllQueues();

    return {
      success: true,
      ...result,
    };
  });
}
