import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signDabutServiceToken, verifyDabutToken } from '../../src/services/dabut-app.service.js';

/*
  다붓의 /generate/project 는 Depends(get_current_user) 로 막혀 있고, 프로젝트를
  owner_id 로 격리해서 읽는다. 스케쥴러가 헤더 없이 부르면 무조건 401 이라
  프로젝트 원고 경로가 통째로 죽는다.

  예약 잡은 며칠 뒤에 돌기 때문에 사용자가 로그인할 때 받은 토큰을 잡에 실어두면
  실행 시점엔 만료돼 있다. 그래서 같은 JWT_SECRET 으로 실행 직전에 새로 발급한다.
  다붓과 검증 규칙이 같은지는 verifyDabutToken 왕복으로 확인한다.
*/

const OWNER_ID = '6a6802fc086d34ddeae9e0cf';

test('signDabutServiceToken: 발급한 토큰을 같은 규칙으로 다시 검증할 수 있다', () => {
  const token = signDabutServiceToken(OWNER_ID);
  assert.ok(token, '토큰이 발급되어야 함');

  const payload = verifyDabutToken(token);
  assert.ok(payload, '발급한 토큰은 검증을 통과해야 함');
  assert.equal(payload?.sub, OWNER_ID);
});

test('signDabutServiceToken: 다붓이 읽는 형태(HS256 3분할)로 나온다', () => {
  const token = signDabutServiceToken(OWNER_ID);
  const parts = token.split('.');
  assert.equal(parts.length, 3, 'header.payload.signature 세 조각이어야 함');

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
  assert.equal(header.alg, 'HS256');
  assert.equal(header.typ, 'JWT');
});

test('signDabutServiceToken: 만료 시각이 미래로 박힌다', () => {
  const token = signDabutServiceToken(OWNER_ID);
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

  assert.equal(typeof payload.exp, 'number');
  assert.ok(payload.exp * 1000 > Date.now(), '만료가 미래여야 함');
});

test('signDabutServiceToken: ownerId 가 비면 발급하지 않는다', () => {
  // 빈 sub 로 토큰을 만들면 다붓이 401 을 주는데, 원인이 안 보이는 실패가 된다.
  assert.throws(() => signDabutServiceToken(''), /ownerId/);
});

test('verifyDabutToken: 서명이 다른 토큰은 통과시키지 않는다', () => {
  const token = signDabutServiceToken(OWNER_ID);
  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1]}.${'a'.repeat(parts[2].length)}`;

  assert.equal(verifyDabutToken(tampered), null);
});
