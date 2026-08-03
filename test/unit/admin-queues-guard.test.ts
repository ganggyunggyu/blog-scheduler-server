import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAdminQueuesAccess } from '../../src/lib/queue/admin-queues-guard.js';

/*
  Bull Board 는 브라우저로 여는 UI 라 Bearer 토큰을 못 실어 보낸다.
  그래서 전역 인증 훅의 공개 목록에 들어가 있는데, 배포하고 나면 그 경로가
  공개 인터넷에 열린다. Bull Board 는 보기만 하는 게 아니라 잡 삭제와 재시도까지
  되므로 아무나 들어오면 예약이 통째로 날아갈 수 있다.

  브라우저가 스스로 물어봐 주는 Basic 인증으로 막는다.
*/

const PASSWORD = 'super-secret';
const header = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

test('비밀번호가 맞으면 통과시킨다', () => {
  const result = checkAdminQueuesAccess(header('admin', PASSWORD), PASSWORD);
  assert.equal(result, 'ok');
});

test('비밀번호가 틀리면 막는다', () => {
  assert.equal(checkAdminQueuesAccess(header('admin', 'wrong'), PASSWORD), 'unauthorized');
});

test('헤더가 없으면 막는다', () => {
  assert.equal(checkAdminQueuesAccess(undefined, PASSWORD), 'unauthorized');
  assert.equal(checkAdminQueuesAccess('', PASSWORD), 'unauthorized');
});

test('Basic 이 아닌 방식은 막는다', () => {
  assert.equal(checkAdminQueuesAccess('Bearer abc.def.ghi', PASSWORD), 'unauthorized');
});

test('비밀번호를 설정하지 않으면 화면 자체를 닫는다', () => {
  // 설정을 깜빡한 채 배포했을 때 열린 채로 두는 것이 가장 위험하다.
  assert.equal(checkAdminQueuesAccess(header('admin', 'anything'), ''), 'disabled');
  assert.equal(checkAdminQueuesAccess(undefined, undefined), 'disabled');
});

test('깨진 base64 를 줘도 터지지 않는다', () => {
  assert.equal(checkAdminQueuesAccess('Basic !!!not-base64!!!', PASSWORD), 'unauthorized');
});
