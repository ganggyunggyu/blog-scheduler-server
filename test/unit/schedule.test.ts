import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduleTimingOptions, calculateSchedule, parseKeywordWithCategory, resolveScheduleMode, toScheduleQueueJob, type ScheduleMode } from '../../src/services/schedule.service';

process.env.TZ = 'Asia/Seoul';

const withFrozenScheduleTime = (
  t: TestContext,
  now: string,
  leadTimeMinutes: string | undefined,
  run: () => void,
): void => {
  const previousLeadTimeMinutes = process.env.LEAD_TIME_MINUTES;

  if (leadTimeMinutes === undefined) {
    delete process.env.LEAD_TIME_MINUTES;
  } else {
    process.env.LEAD_TIME_MINUTES = leadTimeMinutes;
  }
  t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });

  t.after(() => {
    t.mock.timers.reset();

    if (previousLeadTimeMinutes === undefined) {
      delete process.env.LEAD_TIME_MINUTES;
      return;
    }

    process.env.LEAD_TIME_MINUTES = previousLeadTimeMinutes;
  });

  run();
};

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

test('calculateSchedule today: LEAD_TIME_MINUTES 기본값은 현재 기준 60분 이후', (t) => {
  withFrozenScheduleTime(t, '2026-03-16T12:33:00+09:00', undefined, () => {
    const [item] = calculateSchedule(['keyword1'], '2026-03-16', '2');

    assert.ok(item);
    assert.equal(item.scheduledAt.toISOString(), '2026-03-16T04:33:00.000Z');
  });
});

test('calculateSchedule today: 정각이면 다음 정시에 맞춰 예약 시간 결정', (t) => {
  withFrozenScheduleTime(t, '2026-03-16T12:00:00+09:00', '60', () => {
    const [item] = calculateSchedule(['keyword1'], '2026-03-16', '2');

    assert.ok(item);
    assert.equal(item.scheduledAt.toISOString(), '2026-03-16T04:00:00.000Z');
  });
});

test('calculateSchedule today: 비정각이면 현재 기준 60분 뒤 시각으로 예약 시간 결정', (t) => {
  withFrozenScheduleTime(t, '2026-03-16T12:33:00+09:00', '60', () => {
    const [item] = calculateSchedule(['keyword1'], '2026-03-16', '2');

    assert.ok(item);
    assert.equal(item.scheduledAt.toISOString(), '2026-03-16T04:33:00.000Z');
  });
});

test('calculateSchedule today: 같은 날 후속 슬롯은 60분 간격으로 배치', (t) => {
  withFrozenScheduleTime(t, '2026-03-16T12:33:00+09:00', '60', () => {
    const items = calculateSchedule(['keyword1', 'keyword2'], '2026-03-16', '2');

    assert.equal(items.length, 2);
    assert.equal(items[0]?.scheduledAt.toISOString(), '2026-03-16T04:33:00.000Z');
    assert.equal(items[1]?.scheduledAt.toISOString(), '2026-03-16T05:33:00.000Z');
  });
});

test('calculateSchedule future date: 미래 날짜는 랜덤 시작 시각 규칙을 유지', (t) => {
  const randomMock = t.mock.method(Math, 'random', () => 0);

  withFrozenScheduleTime(t, '2026-03-16T12:33:00+09:00', '60', () => {
    const [item] = calculateSchedule(['keyword1'], '2026-03-18', '2');

    assert.ok(item);
    assert.equal(item.scheduledAt.toISOString(), '2026-03-17T21:00:00.000Z');
  });

  assert.equal(randomMock.mock.callCount(), 2);
});

test('calculateSchedule: 흑염소도 기본 배치 시간 계산을 사용함', (t) => {
  const randomMock = t.mock.method(Math, 'random', () => 0);
  const items = calculateSchedule(
    ['keyword1', 'keyword2', 'keyword3'],
    '2099-03-18',
    '2',
    buildScheduleTimingOptions({ manuscriptType: 'hanryeodamwon' }),
  );

  assert.equal(items.length, 3);
  assert.equal(items[0]?.scheduledAt.toISOString(), '2099-03-17T21:00:00.000Z');
  assert.equal(items[1]?.scheduledAt.toISOString(), '2099-03-17T23:00:00.000Z');
  assert.equal(items[2]?.scheduledAt.toISOString(), '2099-03-18T21:00:00.000Z');
  assert.equal(randomMock.mock.callCount(), 4);
});

test('resolveScheduleMode: 알리바바는 항상 모드 3으로 고정', () => {
  assert.equal(resolveScheduleMode('1', 'alibaba'), '3');
  assert.equal(resolveScheduleMode('2', 'alibaba'), '3');
  assert.equal(resolveScheduleMode('2121', 'alibaba'), '3');
});

test('resolveScheduleMode: 다른 manuscriptType은 요청 모드 그대로 반환', () => {
  assert.equal(resolveScheduleMode('2', 'default'), '2');
  assert.equal(resolveScheduleMode('1', 'hanryeodamwon'), '1');
  assert.equal(resolveScheduleMode('2', undefined), '2');
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
    keyword: '여행 정보 일상',
  });

  assert.deepEqual(parseKeywordWithCategory('스마일라식회복:안과'), {
    keyword: '스마일라식회복',
    category: '안과',
  });
});

test('toScheduleQueueJob: 업체명과 항목별 원고 타입을 큐 페이로드로 그대로 옮김', () => {
  const queueJob = toScheduleQueueJob(
    {
      _id: 'job_1',
      keyword: '수원인계동맛집',
      category: null,
      businessName: '쏘삼208 인계나혜석거리점',
      manuscriptType: 'restaurant/v2',
      scheduledAt: '2026-07-27T19:28:02+09:00',
      slot: 1,
    },
    'pending',
  );

  assert.equal(queueJob.businessName, '쏘삼208 인계나혜석거리점');
  assert.equal(queueJob.manuscriptType, 'restaurant/v2');
  assert.equal(queueJob.category, undefined);
  assert.equal(queueJob.status, 'pending');
  assert.equal(queueJob.scheduledAt, '2026-07-27T19:28:02+09:00');
});

test('toScheduleQueueJob: 업체명이 없으면 undefined 로 두고 status 는 인자를 따름', () => {
  const queueJob = toScheduleQueueJob(
    { _id: 'job_2', keyword: '터키시앙고라', scheduledAt: '2026-04-09T10:00:00+09:00', slot: 2 },
    'generating',
  );

  assert.equal(queueJob.businessName, undefined);
  assert.equal(queueJob.manuscriptType, undefined);
  assert.equal(queueJob.status, 'generating');
});
