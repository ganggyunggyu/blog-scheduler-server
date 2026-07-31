import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactJobData } from '../../src/lib/queue/redact-job-data.js';

/*
  잡 페이로드에는 네이버 로그인 비밀번호가 평문으로 들어간다(워커가 로그인해야 해서
  피할 수 없음). 그런데 Bull Board 가 붙은 /admin/queues 는 PUBLIC_PREFIXES 라
  로그인 없이 열린다. 화면에 뿌리기 전에 지운다.
*/

test('redactJobData: account.password 를 지운다', () => {
  const redacted = redactJobData({
    keyword: '흑염소 효능',
    account: { id: 'someone@naver.com', password: 'p@ssw0rd!', blogId: 'blog1' },
  });

  const account = (redacted as { account: Record<string, unknown> }).account;
  assert.equal(account.password, '***');
  assert.equal(account.id, 'someone@naver.com', '나머지 필드는 그대로 보여야 함');
  assert.equal(account.blogId, 'blog1');
});

test('redactJobData: 원본 객체를 건드리지 않는다', () => {
  // 화면에 뿌리려고 지운 값이 워커가 쓸 실제 잡 데이터까지 망가뜨리면 로그인이 깨진다.
  const original = { account: { id: 'a@naver.com', password: 'real-secret' } };
  redactJobData(original);

  assert.equal(original.account.password, 'real-secret');
});

test('redactJobData: 중첩된 곳의 비밀번호도 지운다', () => {
  const redacted = redactJobData({
    accounts: [
      { id: 'a@naver.com', password: 'secret1' },
      { id: 'b@naver.com', password: 'secret2' },
    ],
  }) as { accounts: Array<Record<string, unknown>> };

  assert.equal(redacted.accounts[0].password, '***');
  assert.equal(redacted.accounts[1].password, '***');
});

test('redactJobData: 비밀번호가 없으면 그대로 둔다', () => {
  const input = { keyword: '흑염소', count: 3, ok: true };
  assert.deepEqual(redactJobData(input), input);
});

test('redactJobData: 값이 없거나 객체가 아니어도 터지지 않는다', () => {
  assert.equal(redactJobData(null), null);
  assert.equal(redactJobData(undefined), undefined);
  assert.equal(redactJobData('문자열'), '문자열');
});
