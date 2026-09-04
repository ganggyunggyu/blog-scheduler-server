import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { CAPTCHA_KINDS } from '../services/captcha-prompt.service.js';
import { solveCaptchaImage } from '../services/captcha-solver.service.js';

const solveSchema = z.object({
  /** base64 로 인코딩한 캡차 이미지. data: 접두사는 붙이지 않는다. */
  image: z.string().min(1),
  /** 로그인 캡차의 질문. 카페 보안문자는 질문이 없다. */
  question: z.string().optional(),
  kind: z.enum(CAPTCHA_KINDS).default('login'),
});

export const captchaRoutes = async (app: FastifyInstance) => {
  app.get('/api/captcha/kinds', async () => ({ kinds: CAPTCHA_KINDS }));

  app.post('/api/captcha/solve', async (req, reply: FastifyReply) => {
    const parsed = solveSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message ?? 'invalid body' });
    }

    const { image, question, kind } = parsed.data;
    if (kind === 'login' && !question?.trim()) {
      return reply.status(400).send({ message: '로그인 캡차는 question 이 있어야 풉니다.' });
    }

    const answer = await solveCaptchaImage(image, question ?? '', kind);
    if (!answer) {
      return reply.status(502).send({ message: '모델이 빈 답을 돌려줬습니다.' });
    }
    return { answer, kind };
  });
};
