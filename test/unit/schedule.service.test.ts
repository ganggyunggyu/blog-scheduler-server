import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScheduleTimingKey,
  calculateSchedule,
  toScheduleQueueJob,
} from '../../src/services/schedule.service.js';

/**
 * 다붓 Project 를 항목별 원고 방식으로 쓰는 경로.
 * 하드코딩 enum 을 안 늘리고 프로젝트 id 만 실어 보내는 게 목적임.
 */
test('toScheduleQueueJob: projectId 를 큐 페이로드로 옮김', () => {
  const job = toScheduleQueueJob(
    {
      _id: 'job_1',
      keyword: '원주마사지',
      businessName: null,
      manuscriptType: null,
      projectId: 'proj_abc',
      scheduledAt: '2026-08-01T09:00:00+09:00',
      slot: 1,
    },
    'pending',
  );

  assert.equal(job.projectId, 'proj_abc');
});

test('toScheduleQueueJob: projectId 가 없으면 undefined 로 둠', () => {
  const job = toScheduleQueueJob(
    {
      _id: 'job_2',
      keyword: '원주마사지',
      scheduledAt: '2026-08-01T09:00:00+09:00',
      slot: 1,
    },
    'pending',
  );

  assert.equal(job.projectId, undefined);
});

/**
 * 발행 타이밍 직접 설정.
 * 안 주면 지금까지처럼 랜덤으로 잡고, 주면 그 값 그대로 나와야 함.
 */

const dayString = (offsetDays: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};

const hhmm = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

test('calculateSchedule: 시작 시각과 간격을 직접 주면 그대로 잡힘', () => {
  const items = calculateSchedule(['a', 'b', 'c', 'd'], dayString(10), '2', {
    startHour: 9,
    intervalMinutes: 30,
  });

  assert.deepEqual(items.map((item) => hhmm(item.scheduledAt)), [
    '09:00',
    '09:30',
    '09:00',
    '09:30',
  ]);
  assert.equal(items[2].scheduledAt.getDate(), items[0].scheduledAt.getDate() + 1);
});

test('calculateSchedule: postsPerDay 가 scheduleMode 를 덮어씀', () => {
  const items = calculateSchedule(['a', 'b', 'c', 'd'], dayString(10), '1', {
    startHour: 8,
    intervalMinutes: 60,
    postsPerDay: 4,
  });

  const firstDay = items[0].scheduledAt.getDate();
  assert.equal(items.filter((item) => item.scheduledAt.getDate() === firstDay).length, 4);
  assert.deepEqual(items.map((item) => hhmm(item.scheduledAt)), [
    '08:00',
    '09:00',
    '10:00',
    '11:00',
  ]);
});

test('calculateSchedule: 안 주면 6~10시 시작 / 120~180분 간격 그대로', () => {
  const items = calculateSchedule(['a', 'b'], dayString(10), '2');

  const startHour = items[0].scheduledAt.getHours();
  assert.ok(startHour >= 6 && startHour <= 10, `시작 시각이 범위 밖: ${startHour}`);

  const gapMinutes =
    (items[1].scheduledAt.getTime() - items[0].scheduledAt.getTime()) / 60000;
  assert.ok(gapMinutes >= 120 && gapMinutes <= 180, `간격이 범위 밖: ${gapMinutes}`);
});

test('buildScheduleTimingKey: 아무것도 안 정하면 빈 문자열(기존 지문과 호환)', () => {
  assert.equal(buildScheduleTimingKey({}), '');
});

test('buildScheduleTimingKey: 타이밍만 달라도 키가 달라짐', () => {
  const base = buildScheduleTimingKey({ startHour: 9, intervalMinutes: 30, postsPerDay: 2 });

  assert.notEqual(base, buildScheduleTimingKey({ startHour: 10, intervalMinutes: 30, postsPerDay: 2 }));
  assert.notEqual(base, buildScheduleTimingKey({ startHour: 9, intervalMinutes: 60, postsPerDay: 2 }));
  assert.notEqual(base, buildScheduleTimingKey({ startHour: 9, intervalMinutes: 30, postsPerDay: 3 }));
});
