import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  authenticate,
  isWebAuthEnabled,
  issueToken,
  verifyToken,
  type WebAuthPayload,
} from '../services/web-auth.service.js';
import { logger } from '../lib/logging/logger.js';

const log = logger.child({ scope: 'WebAuth' });

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** 인증 없이 열어두는 경로. 로그인과 헬스체크, Bull Board 만. */
const PUBLIC_PREFIXES = ['/api/auth/login', '/health', '/admin/queues'];

const readBearerToken = (req: FastifyRequest): string => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return '';
  return header.slice(7);
};

export const authRoutes = async (app: FastifyInstance) => {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isWebAuthEnabled()) return;
    if (PUBLIC_PREFIXES.some((prefix) => req.url.startsWith(prefix))) return;

    const payload = verifyToken(readBearerToken(req));
    if (!payload) {
      return reply.status(401).send({ message: '인증이 필요합니다.' });
    }

    (req as FastifyRequest & { webUser?: WebAuthPayload }).webUser = payload;
  });

  app.post('/api/auth/login', async (req, reply: FastifyReply) => {
    if (!isWebAuthEnabled()) {
      return reply.status(503).send({
        message: 'WEB_AUTH_SECRET 이 설정되지 않아 로그인 기능이 꺼져 있습니다.',
      });
    }

    const body = loginSchema.parse(req.body);
    const user = authenticate(body.username, body.password);

    if (!user) {
      log.warn('login.failed', { username: body.username });
      return reply.status(401).send({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    log.info('login.success', { username: user.username });

    return {
      accessToken: issueToken(user),
      user: {
        username: user.username,
        label: user.label ?? user.username,
        role: user.role ?? 'operator',
      },
    };
  });

  app.get('/api/auth/me', async (req, reply: FastifyReply) => {
    const payload = verifyToken(readBearerToken(req));
    if (!payload) {
      return reply.status(401).send({ message: '인증이 필요합니다.' });
    }
    return {
      user: { username: payload.username, label: payload.label, role: payload.role },
    };
  });
};
