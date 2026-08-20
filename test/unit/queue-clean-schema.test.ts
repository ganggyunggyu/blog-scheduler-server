import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSchema } from '../../src/lib/queue/clean-request.js';

/*
  /api/queues/:accountId/clean 은 큐에서 잡을 지우는 파괴적 엔드포인트다.
  끝난 잡(completed/failed)만 지울 수 있어야 하고, 아직 실행 전이거나 실행 중인
  잡(waiting/active/delayed)이 여기로 들어오면 예약이 통째로 날아간다.
*/

test('status 를 안 주면 completed 로 둔다 (기존 호출부 호환)', () => {
  const parsed = cleanSchema.parse({ type: 'generate' });

  assert.equal(parsed.status, 'completed');
  assert.equal(parsed.grace, 0);
});

test('쌓인 실패 잡을 걷어내려면 failed 를 지정할 수 있다', () => {
  const parsed = cleanSchema.parse({ type: 'generate', status: 'failed' });

  assert.equal(parsed.status, 'failed');
});

test('실행 전/실행 중 상태는 스키마에서 막는다', () => {
  for (const status of ['waiting', 'active', 'delayed', 'paused']) {
    assert.throws(
      () => cleanSchema.parse({ type: 'generate', status }),
      undefined,
      `${status} 가 통과하면 예약이 날아간다`,
    );
  }
});

test('type 은 필수다', () => {
  assert.throws(() => cleanSchema.parse({ status: 'failed' }));
});
