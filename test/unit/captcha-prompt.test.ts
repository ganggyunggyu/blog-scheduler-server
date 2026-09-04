import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTCHA_KINDS,
  buildCaptchaPrompt,
  isCaptchaKind,
  normalizeCaptchaAnswer,
  requiresQuestion,
} from '../../src/services/captcha-prompt.service.js';

test('isCaptchaKind: 세 종류만 통과한다', () => {
  for (const kind of CAPTCHA_KINDS) assert.equal(isCaptchaKind(kind), true, kind);
  assert.equal(isCaptchaKind('signup'), false);
  assert.equal(isCaptchaKind(''), false);
  assert.equal(isCaptchaKind(undefined), false);
});

test('buildCaptchaPrompt: 로그인은 질문을 프롬프트에 박는다', () => {
  const prompt = buildCaptchaPrompt('login', '전화번호의 뒤에서 2번째 숫자');
  assert.ok(prompt.includes('전화번호의 뒤에서 2번째 숫자'));
  assert.ok(prompt.includes('영수증'));
});

test('buildCaptchaPrompt: 카페 종류는 질문을 쓰지 않는다', () => {
  const join = buildCaptchaPrompt('cafe-join', '무시되는 질문');
  const create = buildCaptchaPrompt('cafe-create', '무시되는 질문');
  assert.ok(!join.includes('무시되는 질문'));
  assert.ok(!create.includes('무시되는 질문'));
  assert.notEqual(join, create);
});

test('normalizeCaptchaAnswer: 카페 답은 영숫자만 남긴다', () => {
  assert.equal(normalizeCaptchaAnswer('cafe-join', ' "A1b2." '), 'A1b2');
  assert.equal(normalizeCaptchaAnswer('cafe-create', 'X-9 Z'), 'X9Z');
});

test('normalizeCaptchaAnswer: 로그인 답은 공백만 턴다', () => {
  assert.equal(normalizeCaptchaAnswer('login', '  테헤란로  '), '테헤란로');
  assert.equal(normalizeCaptchaAnswer('login', ' 12,000 '), '12,000');
});

test('requiresQuestion: 로그인만 질문이 필요하다', () => {
  assert.equal(requiresQuestion('login'), true);
  assert.equal(requiresQuestion('cafe-join'), false);
  assert.equal(requiresQuestion('cafe-create'), false);
});
