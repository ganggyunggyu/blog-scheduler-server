import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import axios, { isAxiosError } from 'axios';
import { z } from 'zod';
import { env } from '../config/env.js';
import {
  findDabutUser,
  isDabutAuthEnabled,
  verifyDabutToken,
  type DabutJwtPayload,
} from '../services/dabut-app.service.js';
import { logger } from '../lib/logging/logger.js';

const log = logger.child({ scope: 'Auth' });

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const signupSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  label: z.string().optional(),
});

/** 인증 없이 열어두는 경로. 로그인/회원가입과 헬스체크, Bull Board 만. */
const PUBLIC_PREFIXES = [
  '/api/auth/login',
  '/api/auth/signup',
  '/health',
  '/admin/queues',
];

const readBearerToken = (req: FastifyRequest): string => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return '';
  return header.slice(7);
};

export interface AuthedRequest extends FastifyRequest {
  dabutUser?: DabutJwtPayload;
}

/** 라우트 핸들러에서 로그인한 계정 id 를 꺼낼 때 쓴다. */
export const getRequestOwnerId = (req: FastifyRequest): string =>
  (req as AuthedRequest).dabutUser?.sub ?? '';

const forwardDabut = async (path: string, body: unknown) => {
  const { data } = await axios.post(`${env.DABUT_API_URL}${path}`, body, { timeout: 20000 });
  return data;
};

const toAuthError = (error: unknown, fallback: string) => {
  if (isAxiosError(error)) {
    const status = error.response?.status ?? 502;
    const detail = error.response?.data?.detail;
    return { status, message: typeof detail === 'string' ? detail : fallback };
  }
  return { status: 502, message: fallback };
};

export const authRoutes = async (app: FastifyInstance) => {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isDabutAuthEnabled()) return;
    if (PUBLIC_PREFIXES.some((prefix) => req.url.startsWith(prefix))) return;

    const payload = verifyDabutToken(readBearerToken(req));
    if (!payload) {
      return reply.status(401).send({ message: '인증이 필요합니다.' });
    }

    (req as AuthedRequest).dabutUser = payload;
  });

  app.post('/api/auth/login', async (req, reply: FastifyReply) => {
    if (!isDabutAuthEnabled()) {
      return reply.status(503).send({
        message: 'JWT_SECRET 또는 DABUT_APP_MONGO_URI 가 없어서 로그인 기능이 꺼져 있습니다.',
      });
    }

    const body = loginSchema.parse(req.body);

    try {
      // 비밀번호 검증은 dabut 이 하도록 넘긴다. bcrypt 를 여기로 끌어올 이유가 없다.
      const data = await forwardDabut('/auth/app/login', body);
      log.info('login.success', { username: body.username });

      return {
        accessToken: data.access_token,
        user: {
          id: data.user?.id ?? '',
          username: data.user?.username ?? body.username,
          label: data.user?.label ?? '',
          isActive: data.user?.is_active !== false,
        },
      };
    } catch (error) {
      const { status, message } = toAuthError(error, '로그인에 실패했습니다.');
      log.warn('login.failed', { username: body.username, status });
      return reply.status(status === 401 ? 401 : status).send({ message });
    }
  });

  app.post('/api/auth/signup', async (req, reply: FastifyReply) => {
    if (!isDabutAuthEnabled()) {
      return reply.status(503).send({ message: '회원가입 기능이 꺼져 있습니다.' });
    }

    const body = signupSchema.parse(req.body);

    try {
      const data = await forwardDabut('/auth/app/signup', {
        username: body.username,
        password: body.password,
        label: body.label ?? '',
      });
      log.info('signup.success', { username: body.username });

      return {
        user: {
          id: data.id ?? data.user?.id ?? '',
          username: data.username ?? body.username,
          label: data.label ?? body.label ?? '',
          isActive: true,
        },
      };
    } catch (error) {
      const { status, message } = toAuthError(error, '회원가입에 실패했습니다.');
      log.warn('signup.failed', { username: body.username, status });
      return reply.status(status).send({ message });
    }
  });

  app.get('/api/auth/me', async (req, reply: FastifyReply) => {
    const payload = verifyDabutToken(readBearerToken(req));
    if (!payload) {
      return reply.status(401).send({ message: '인증이 필요합니다.' });
    }

    const user = await findDabutUser(payload.sub);
    if (!user) {
      return reply.status(401).send({ message: '계정을 찾을 수 없습니다.' });
    }

    return { user };
  });
};
