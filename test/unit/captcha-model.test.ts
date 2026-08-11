import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCaptchaModel } from '../../src/services/captcha-solver.service.js';

/*
  모델명이 코드에 박혀 있었는데(gemini-2.5-flash) 구글이 신규 프로젝트에
  그 버전을 닫으면서 404 로 죽었다. 키를 바꿔도 안 풀렸고 재배포해야만 고칠 수
  있었다. 환경변수로 빼서 배포 없이 갈아끼우게 하고, 기본값은 버전을 고정하지
  않는 별칭으로 둬서 다음 은퇴 때 또 같은 일이 나지 않게 한다.

  2026-08-10: 서버 환경변수 GEMINI_API_KEY 가 선불 크레딧 소진으로 죽어서
  캡차 풀이를 gpt-5.6-luna(다붓 "21lab" 계정의 OpenAI 키)로 옮겼다. 환경변수로
  갈아끼우는 구조 자체는 그대로 유지한다.
*/

test('기본값은 gpt-5.6-luna 다', () => {
  const model = resolveCaptchaModel({});
  assert.equal(model, 'gpt-5.6-luna');
});

test('환경변수로 덮어쓸 수 있다', () => {
  assert.equal(resolveCaptchaModel({ CAPTCHA_MODEL: 'gpt-5.6-terra' }), 'gpt-5.6-terra');
});

test('빈 값이나 공백은 기본값으로 떨어진다', () => {
  assert.equal(resolveCaptchaModel({ CAPTCHA_MODEL: '' }), 'gpt-5.6-luna');
  assert.equal(resolveCaptchaModel({ CAPTCHA_MODEL: '   ' }), 'gpt-5.6-luna');
});

test('앞뒤 공백을 떼고 쓴다', () => {
  assert.equal(resolveCaptchaModel({ CAPTCHA_MODEL: '  gpt-5.6-luna  ' }), 'gpt-5.6-luna');
});
