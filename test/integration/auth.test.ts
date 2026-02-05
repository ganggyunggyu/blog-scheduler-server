import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getValidCookies } from '../../src/services/naver-auth.service';
import { TEST_ACCOUNT, INVALID_ACCOUNT } from '../fixtures/test-data';

test('[Auth] 로그인 성공 (getValidCookies)', async () => {
  assert.ok(TEST_ACCOUNT.id, 'TEST_ID env should be set');
  assert.ok(TEST_ACCOUNT.pw, 'TEST_PW env should be set');

  const result = await getValidCookies(TEST_ACCOUNT.id, TEST_ACCOUNT.pw);

  console.log(`  account:   ${TEST_ACCOUNT.id.slice(0, 3)}***`);
  console.log(`  fromCache: ${result.fromCache}`);
  console.log(`  cookies:   ${result.cookies.length}개`);

  assert.ok(Array.isArray(result.cookies), 'cookies should be array');
  assert.ok(result.cookies.length > 0, 'should have cookies');
  assert.equal(typeof result.fromCache, 'boolean', 'fromCache should be boolean');
});

test('[Auth] 두 번째 호출 → 캐시 히트', async () => {
  const result = await getValidCookies(TEST_ACCOUNT.id, TEST_ACCOUNT.pw);

  console.log(`  fromCache: ${result.fromCache}`);
  console.log(`  cookies:   ${result.cookies.length}개`);

  assert.equal(result.fromCache, true, 'second call should use cache');
  assert.ok(result.cookies.length > 0, 'cached cookies should exist');
});

test('[Auth] 잘못된 계정 → 에러', async () => {
  await assert.rejects(
    () => getValidCookies(INVALID_ACCOUNT.id, INVALID_ACCOUNT.pw),
    (err: Error) => {
      console.log(`  error: ${err.message}`);
      return err instanceof Error;
    },
    'should throw on invalid credentials'
  );
});
