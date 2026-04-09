import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessLoginFailure,
  inferLoginFailureMessage,
} from '../../src/services/login-failure.service.js';

test('assessLoginFailure: 네트워크 불안정은 retryable job 실패로 분류함', () => {
  const assessment = assessLoginFailure('접속하신 네트워크 환경이 불안정합니다. 다른 네트워크를 이용하시거나 잠시 후 다시 시도하세요.');

  assert.deepEqual(assessment, {
    category: 'network_unstable',
    isLoginFailure: true,
    retryable: true,
    scope: 'job',
    normalizedMessage: '로그인 실패: 접속하신 네트워크 환경이 불안정합니다. 다른 네트워크를 이용하시거나 잠시 후 다시 시도하세요.',
  });
});

test('assessLoginFailure: 비밀번호 오류는 account 중단으로 분류함', () => {
  const assessment = assessLoginFailure('로그인 실패: 비밀번호를 다시 확인해주세요.');

  assert.equal(assessment.category, 'invalid_credentials');
  assert.equal(assessment.isLoginFailure, true);
  assert.equal(assessment.retryable, false);
  assert.equal(assessment.scope, 'account');
  assert.equal(assessment.normalizedMessage, '로그인 실패: 비밀번호를 다시 확인해주세요.');
});

test('assessLoginFailure: 보안문자 요구는 account 중단으로 분류함', () => {
  const assessment = assessLoginFailure('보안문자 입력 필요 (GEMINI_API_KEY 미설정)');

  assert.equal(assessment.category, 'captcha_required');
  assert.equal(assessment.isLoginFailure, true);
  assert.equal(assessment.retryable, false);
  assert.equal(assessment.scope, 'account');
});

test('assessLoginFailure: 강제 로그인 컨텍스트에서는 알 수 없는 auth 오류도 retry 대상으로 둠', () => {
  const assessment = assessLoginFailure('browser disconnected unexpectedly', {
    forceLoginContext: true,
  });

  assert.equal(assessment.category, 'unknown_login');
  assert.equal(assessment.isLoginFailure, true);
  assert.equal(assessment.retryable, true);
  assert.equal(assessment.scope, 'job');
  assert.equal(assessment.normalizedMessage, '로그인 실패: browser disconnected unexpectedly');
});

test('assessLoginFailure: 일반 게시 오류는 로그인 실패로 오인하지 않음', () => {
  const assessment = assessLoginFailure('이미지 업로드 실패');

  assert.equal(assessment.category, 'not_login_failure');
  assert.equal(assessment.isLoginFailure, false);
  assert.equal(assessment.retryable, false);
  assert.equal(assessment.scope, 'none');
});

test('inferLoginFailureMessage: 로그인 페이지 본문에서 네트워크 불안정 원인을 복구함', () => {
  const message = inferLoginFailureMessage(
    null,
    'NAVER 로그인 접속하신 네트워크 환경이 불안정합니다. 다른 네트워크를 이용하시거나 잠시 후 다시 시도하세요.'
  );

  assert.equal(
    message,
    '로그인 실패: 접속하신 네트워크 환경이 불안정합니다. 다른 네트워크를 이용하시거나 잠시 후 다시 시도하세요.'
  );
});

test('inferLoginFailureMessage: 페이지에 힌트가 없으면 로그인 페이지 잔류로 정리함', () => {
  const message = inferLoginFailureMessage(null, 'NAVER 로그인 아이디 비밀번호 로그인 상태 유지');

  assert.equal(message, '로그인 실패: 로그인 페이지에 머물러 있습니다.');
});
