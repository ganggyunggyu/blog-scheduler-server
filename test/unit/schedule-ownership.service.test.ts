import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOwnedAccountIds,
  isOwnedAccountId,
  isVisibleSchedule,
  normalizeAccountId,
  resolveOwnedAccountScope,
  resolveQueryAccountIds,
  toAccountIdMatchers,
} from '../../src/services/schedule-ownership.service.js';

/*
  GET /schedules, GET /schedules/:id, DELETE /schedules/:id 는 토큰만 있으면
  남의 스케쥴까지 보이고 취소까지 됐다. schedules 컬렉션에는 owner_id 가 없고
  accountId(네이버 로그인 아이디)만 있어서, 소유권은 dabut 에 등록된 계정의
  loginId 집합으로 판단한다.
*/

const ownerAccounts = [
  { loginId: 'q9v3m7a2' },
  { loginId: 'EghFsa5478' },
  { loginId: '' },
  { loginId: 'q9v3m7a2' },
];

test('소유 계정 목록: 소문자로 맞추고 중복과 빈 값을 걷어낸다', () => {
  assert.deepEqual(buildOwnedAccountIds(ownerAccounts), ['q9v3m7a2', 'eghfsa5478']);
});

test('소유 판정: 네이버 아이디는 대소문자를 안 가린다', () => {
  const owned = buildOwnedAccountIds(ownerAccounts);

  assert.equal(isOwnedAccountId(owned, 'EGHFSA5478'), true);
  assert.equal(isOwnedAccountId(owned, ' q9v3m7a2 '), true);
  assert.equal(isOwnedAccountId(owned, 'pixelninja3'), false);
});

test('소유 판정: 빈 accountId 는 통과시키지 않는다', () => {
  // 계정 없는 문서가 아무한테나 열리면 스코프가 뚫린다.
  const owned = buildOwnedAccountIds(ownerAccounts);

  assert.equal(isOwnedAccountId(owned, ''), false);
  assert.equal(isOwnedAccountId(owned, undefined), false);
  assert.equal(isOwnedAccountId([], 'q9v3m7a2'), false);
});

test('노출 판정: 스코프가 null 이면 예전처럼 전부 보여준다', () => {
  // dabut 인증이 꺼진 배포에서는 테넌트 구분 자체가 없어서 막으면 화면이 통째로 빈다.
  assert.equal(isVisibleSchedule(null, 'pixelninja3'), true);
  assert.equal(isVisibleSchedule(null, undefined), true);
});

test('노출 판정: 스코프가 있으면 남의 계정 스케쥴은 가린다', () => {
  const owned = buildOwnedAccountIds(ownerAccounts);

  assert.equal(isVisibleSchedule(owned, 'q9v3m7a2'), true);
  assert.equal(isVisibleSchedule(owned, 'pixelninja3'), false);
  assert.equal(isVisibleSchedule([], 'q9v3m7a2'), false);
});

test('목록 필터: accountId 를 안 주면 소유한 계정 전부가 대상이다', () => {
  const owned = buildOwnedAccountIds(ownerAccounts);

  assert.deepEqual(resolveQueryAccountIds(owned, undefined), ['q9v3m7a2', 'eghfsa5478']);
});

test('목록 필터: 소유한 계정을 찍으면 그 계정만 남는다', () => {
  const owned = buildOwnedAccountIds(ownerAccounts);

  assert.deepEqual(resolveQueryAccountIds(owned, 'EGHFSA5478'), ['eghfsa5478']);
});

test('목록 필터: 남의 계정을 찍으면 후보가 비어서 아무것도 안 나간다', () => {
  const owned = buildOwnedAccountIds(ownerAccounts);

  assert.deepEqual(resolveQueryAccountIds(owned, 'pixelninja3'), []);
});

test('몽고 매처: 대소문자를 무시하고 정확히 그 아이디만 잡는다', () => {
  const [matcher] = toAccountIdMatchers(['q9v3m7a2']);

  assert.equal(matcher.test('Q9V3M7A2'), true);
  assert.equal(matcher.test('q9v3m7a2'), true);
  assert.equal(matcher.test('xq9v3m7a2'), false);
  assert.equal(matcher.test('q9v3m7a2x'), false);
});

test('몽고 매처: 정규식 특수문자가 든 아이디도 리터럴로 다룬다', () => {
  const [matcher] = toAccountIdMatchers(['a.b+c']);

  assert.equal(matcher.test('a.b+c'), true);
  assert.equal(matcher.test('axbxc'), false);
});

test('스코프 결정: 인증이 꺼져 있으면 조회조차 하지 않고 스코프를 안 건다', async () => {
  let called = false;
  const scope = await resolveOwnedAccountScope({
    authEnabled: false,
    ownerId: '',
    listAccounts: async () => {
      called = true;
      return ownerAccounts;
    },
  });

  assert.equal(scope, null);
  assert.equal(called, false, 'dabut 이 꺼져 있으면 계정 조회를 하면 안 됨');
});

test('스코프 결정: 인증이 켜졌는데 주인을 모르면 아무것도 못 보게 막는다', async () => {
  const scope = await resolveOwnedAccountScope({
    authEnabled: true,
    ownerId: '',
    listAccounts: async () => ownerAccounts,
  });

  assert.deepEqual(scope, []);
});

test('스코프 결정: 로그인한 주인의 loginId 집합을 돌려준다', async () => {
  const seen: string[] = [];
  const scope = await resolveOwnedAccountScope({
    authEnabled: true,
    ownerId: '6a6802fc086d34ddeae9e0cf',
    listAccounts: async (ownerId) => {
      seen.push(ownerId);
      return ownerAccounts;
    },
  });

  assert.deepEqual(scope, ['q9v3m7a2', 'eghfsa5478']);
  assert.deepEqual(seen, ['6a6802fc086d34ddeae9e0cf']);
});

test('정규화: 앞뒤 공백과 대소문자만 손대고 나머지는 그대로 둔다', () => {
  assert.equal(normalizeAccountId('  Q9V3m7A2 '), 'q9v3m7a2');
  assert.equal(normalizeAccountId(null), '');
});
