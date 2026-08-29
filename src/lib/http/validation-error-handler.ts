import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../logging/logger.js';

const log = logger.child({ scope: 'Http' });

/**
 * 라우트가 zod 로 직접 파싱해서 던지는 검증 실패를 400 으로 내보낸다.
 *
 * 기본 핸들러는 이걸 500 Internal Server Error 로 내보내면서 issue 배열을 message 에
 * 통째로 실었다. 호출부는 서버가 터진 걸로 읽고, 응답에는 내부 필드명과 제약이 그대로
 * 나갔다. 그 외 에러는 손대지 않고 Fastify 기본 처리로 넘긴다.
 */
export const registerValidationErrorHandler = (app: FastifyInstance): void => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const fields = error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      log.warn('request.invalid', { path: request.url, fields });

      return reply.status(400).send({
        success: false,
        message: '요청 값이 올바르지 않습니다.',
        fields,
      });
    }

    return reply.send(error);
  });
};
