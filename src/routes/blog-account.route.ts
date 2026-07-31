import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  isDabutAuthEnabled,
  listDabutBlogAccounts,
  resolveDabutBlogCredential,
} from '../services/dabut-app.service.js';
import { getRequestOwnerId } from './auth.route.js';

export const blogAccountRoutes = async (app: FastifyInstance) => {
  /** 로그인한 계정이 dabut 에 등록해둔 블로그 목록. 비밀번호는 안 나간다. */
  app.get('/api/blog-accounts', async (req, reply: FastifyReply) => {
    if (!isDabutAuthEnabled()) {
      return reply.status(503).send({ message: 'dabut 연동이 꺼져 있습니다.' });
    }

    const ownerId = getRequestOwnerId(req);
    if (!ownerId) {
      return reply.status(401).send({ message: '인증이 필요합니다.' });
    }

    const accounts = await listDabutBlogAccounts(ownerId);
    return { accounts };
  });

  /**
   * 발행 전 크리덴셜 확인용. 평문 비밀번호는 응답에 담지 않고,
   * 복호화가 되는지 여부만 알려준다.
   */
  app.get('/api/blog-accounts/:id/credential-check', async (req, reply: FastifyReply) => {
    const ownerId = getRequestOwnerId(req);
    if (!ownerId) {
      return reply.status(401).send({ message: '인증이 필요합니다.' });
    }

    const { id } = req.params as { id: string };
    const credential = await resolveDabutBlogCredential({ ownerId, accountId: id });

    if (!credential) {
      return reply.status(404).send({
        ok: false,
        message: '계정을 찾을 수 없거나 비밀번호를 복호화하지 못했습니다.',
      });
    }

    return { ok: true, loginId: credential.loginId, blogId: credential.blogId };
  });
};
