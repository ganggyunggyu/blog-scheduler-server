import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCaptchaModel } from '../../src/services/captcha-solver.service.js';

/*
  모델명이 코드에 박혀 있었는데(gemini-2.5-flash) 구글이 신규 프로젝트에
  그 버전을 닫으면서 404 로 죽었다. 키를 바꿔도 안 풀렸고 재배포해야만 고칠 수
  있었다. 환경변수로 빼서 배포 없이 갈아끼우게 하고, 기본값은 버전을 고정하지
  않는 별칭으로 둬서 다음 은퇴 때 또 같은 일이 나지 않게 한다.
*/

test('기본값은 버전을 고정하지 않는 별칭이다', () => {
  const model = resolveCaptchaModel({});
  assert.equal(model, 'gemini-flash-latest');
});

test('기본값에 버전 숫자를 박지 않는다', () => {
  // gemini-2.5-flash 처럼 버전을 박으면 그 버전이 닫힐 때 같은 장애가 난다.
  assert.ok(
    !/\d+\.\d+/.test(resolveCaptchaModel({})),
    '기본 모델명에 버전 숫자가 들어가면 안 됨',
  );
});

test('환경변수로 덮어쓸 수 있다', () => {
  assert.equal(resolveCaptchaModel({ CAPTCHA_MODEL: 'gemini-3-flash-preview' }), 'gemini-3-flash-preview');
});

test('빈 값이나 공백은 기본값으로 떨어진다', () => {
  assert.equal(resolveCaptchaModel({ CAPTCHA_MODEL: '' }), 'gemini-flash-latest');
  assert.equal(resolveCaptchaModel({ CAPTCHA_MODEL: '   ' }), 'gemini-flash-latest');
});

test('앞뒤 공백을 떼고 쓴다', () => {
  assert.equal(resolveCaptchaModel({ CAPTCHA_MODEL: '  gemini-pro-latest  ' }), 'gemini-pro-latest');
});
