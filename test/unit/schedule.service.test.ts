import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toScheduleQueueJob } from '../../src/services/schedule.service.js';

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
