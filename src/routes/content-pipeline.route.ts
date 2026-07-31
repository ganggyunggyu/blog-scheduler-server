import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  CONTENT_BLOCK_CATALOG,
  deleteContentPipeline,
  listBuiltinPipelines,
  listContentPipelines,
  saveContentPipeline,
} from '../services/content-pipeline.service.js';
import { getRequestOwnerId } from './auth.route.js';

const savePipelineSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  blocks: z.array(z.string().min(1)).min(1),
  isActive: z.boolean().optional(),
  order: z.number().int().optional(),
});

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '알 수 없는 오류';

export const contentPipelineRoutes = async (app: FastifyInstance) => {
  /**
   * 편집 화면이 블록 팔레트와 출발점 목록을 그릴 때 씀.
   * 계정별 데이터가 아니라 고정 카탈로그지만, /api 전역 인증 훅 아래에 있어
   * 다른 라우트와 같이 로그인 상태에서만 열린다.
   */
  app.get('/api/content-pipelines/blocks', async () => ({
    blocks: CONTENT_BLOCK_CATALOG,
    builtins: listBuiltinPipelines(),
  }));

  app.get('/api/content-pipelines', async (req, reply: FastifyReply) => {
    const ownerId = getRequestOwnerId(req);
    if (!ownerId) {
      return reply.status(401).send({ message: '인증이 필요합니다.' });
    }

    return { pipelines: await listContentPipelines(ownerId) };
  });

  app.post('/api/content-pipelines', async (req, reply: FastifyReply) => {
    const ownerId = getRequestOwnerId(req);
    if (!ownerId) {
      return reply.status(401).send({ message: '인증이 필요합니다.' });
    }

    const parsed = savePipelineSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message ?? '잘못된 요청' });
    }

    try {
      const pipeline = await saveContentPipeline({ ownerId, ...parsed.data });
      return { pipeline };
    } catch (error) {
      // 블록 조합이 틀린 건 사용자가 고칠 수 있는 문제라 400 으로 돌려준다.
      return reply.status(400).send({ message: toMessage(error) });
    }
  });

  app.delete('/api/content-pipelines/:key', async (req, reply: FastifyReply) => {
    const ownerId = getRequestOwnerId(req);
    if (!ownerId) {
      return reply.status(401).send({ message: '인증이 필요합니다.' });
    }

    const { key } = req.params as { key: string };
    const removed = await deleteContentPipeline(ownerId, key);

    if (!removed) {
      return reply.status(404).send({ message: '파이프라인을 찾을 수 없습니다.' });
    }

    return { success: true };
  });
};
