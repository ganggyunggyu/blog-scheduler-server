import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSchedule, parseKeywordWithCategory, type ScheduleMode } from '../../src/services/schedule.service';

process.env.TZ = 'Asia/Seoul';

test('calculateSchedule mode 2: 하루 2개씩 배치', () => {
  const items = calculateSchedule(
    ['keyword1', 'keyword2', 'keyword3', 'keyword4', 'keyword5'],
    '2099-01-01',
    '2'
  );

  assert.equal(items.length, 5);
  assert.equal(items[0].slot, 1);
  assert.equal(items[1].slot, 2);
  assert.equal(items[2].slot, 3);

  const day1Items = items.filter((i) => i.scheduledAt.getDate() === 1);
  const day2Items = items.filter((i) => i.scheduledAt.getDate() === 2);
  const day3Items = items.filter((i) => i.scheduledAt.getDate() === 3);

  assert.equal(day1Items.length, 2, '1일차 2개');
  assert.equal(day2Items.length, 2, '2일차 2개');
  assert.equal(day3Items.length, 1, '3일차 1개');
});

test('calculateSchedule mode 3: 하루 3개씩 배치', () => {
  const items = calculateSchedule(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    '2099-02-01',
    '3'
  );

  const day1Items = items.filter((i) => i.scheduledAt.getDate() === 1);
  const day2Items = items.filter((i) => i.scheduledAt.getDate() === 2);
  const day3Items = items.filter((i) => i.scheduledAt.getDate() === 3);

  assert.equal(day1Items.length, 3, '1일차 3개');
  assert.equal(day2Items.length, 3, '2일차 3개');
  assert.equal(day3Items.length, 1, '3일차 1개');
});

test('calculateSchedule mode 2121: 2-1-2-1 패턴', () => {
  const items = calculateSchedule(
    ['a', 'b', 'c', 'd', 'e', 'f'],
    '2099-03-01',
    '2121'
  );

  const day1Items = items.filter((i) => i.scheduledAt.getDate() === 1);
  const day2Items = items.filter((i) => i.scheduledAt.getDate() === 2);
  const day3Items = items.filter((i) => i.scheduledAt.getDate() === 3);
  const day4Items = items.filter((i) => i.scheduledAt.getDate() === 4);

  assert.equal(day1Items.length, 2, '1일차 2개 (짝수 오프셋 0)');
  assert.equal(day2Items.length, 1, '2일차 1개 (홀수 오프셋 1)');
  assert.equal(day3Items.length, 2, '3일차 2개 (짝수 오프셋 2)');
  assert.equal(day4Items.length, 1, '4일차 1개 (홀수 오프셋 3)');
});

test('parseKeywordWithCategory: 카테고리 파싱', () => {
  assert.deepEqual(parseKeywordWithCategory('맛집 추천:음식'), {
    keyword: '맛집 추천',
    category: '음식',
  });

  assert.deepEqual(parseKeywordWithCategory('단순키워드'), {
    keyword: '단순키워드',
  });

  assert.deepEqual(parseKeywordWithCategory('여행 정보 일상'), {
    keyword: '여행 정보',
    category: '일상',
  });
});
