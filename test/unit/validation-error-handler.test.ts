import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { z } from 'zod';
import { registerValidationErrorHandler } from '../../src/lib/http/validation-error-handler.js';

const schema = z.object({
  start_hour: z.number().int().min(0).max(23).optional(),
  posts_per_day: z.number().int().min(1).max(10).optional(),
});

const buildApp = () => {
  const app = Fastify({ logger: false });
  registerValidationErrorHandler(app);

  app.post('/parse', async (req) => schema.parse(req.body));
  app.get('/boom', async () => {
    throw new Error('무언가 터짐');
  });

  return app;
};

/**
 * 예전에는 zod 검증 실패가 500 으로 나가면서 issue 배열이 message 에 통째로 실렸다.
 * 호출부가 서버 장애로 오해하고, 내부 필드명과 제약이 응답에 그대로 나갔다.
 */
test('zod 검증 실패는 400 으로 나가고 어긋난 필드만 알려준다', async () => {
  const app = buildApp();

  const response = await app.inject({
    method: 'POST',
    url: '/parse',
    payload: { start_hour: 25, posts_per_day: 99 },
  });

  assert.equal(response.statusCode, 400);

  const body = response.json();
  assert.equal(body.success, false);
  assert.deepEqual(
    body.fields.map((field: { field: string }) => field.field).sort(),
    ['posts_per_day', 'start_hour']
  );
  // 내부 zod issue 원본(code/inclusive 같은 것)은 새어나가지 않는다.
  assert.ok(!JSON.stringify(body).includes('too_big'));

  await app.close();
});

test('정상 요청은 그대로 통과한다', async () => {
  const app = buildApp();

  const response = await app.inject({
    method: 'POST',
    url: '/parse',
    payload: { start_hour: 9, posts_per_day: 4 },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { start_hour: 9, posts_per_day: 4 });

  await app.close();
});

/** reply.send(error) 로 기본 처리에 넘기는데, 이게 핸들러를 다시 부르면 무한루프가 된다. */
test('zod 가 아닌 에러는 기본 500 으로 나가고 핸들러가 다시 안 불린다', async () => {
  const app = buildApp();

  const response = await app.inject({ method: 'GET', url: '/boom' });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().message, '무언가 터짐');

  await app.close();
});
