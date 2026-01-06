import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSchedule, formatKst } from '../../src/services/schedule.service';

process.env.TZ = 'Asia/Seoul';

test('calculateSchedule builds sequential slots across days', () => {
  const items = calculateSchedule(
    ['keyword1', 'keyword2', 'keyword3', 'keyword4', 'keyword5'],
    '2025-01-07',
    10,
    2,
    2
  );

  assert.equal(items.length, 5);
  assert.equal(items[0].keyword, 'keyword1');
  assert.equal(formatKst(items[0].scheduledAt), '2025-01-07T10:00:00+09:00');
  assert.equal(formatKst(items[1].scheduledAt), '2025-01-07T12:00:00+09:00');
  assert.equal(formatKst(items[2].scheduledAt), '2025-01-08T10:00:00+09:00');
  assert.equal(items[2].day, 2);
  assert.equal(items[2].slot, 1);
});
