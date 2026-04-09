import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeScheduleProgress } from '../../src/queues/publish-progress.js';

test('summarizeScheduleProgress: 재시도 성공 후 published 기준으로 집계', () => {
  const summary = summarizeScheduleProgress(
    ['published', 'published', 'published', 'published'],
    4,
  );

  assert.deepEqual(summary, {
    completedJobs: 4,
    failedJobs: 0,
    status: 'completed',
  });
});

test('summarizeScheduleProgress: 실패가 남아 있으면 failed 유지', () => {
  const summary = summarizeScheduleProgress(
    ['published', 'published', 'failed', 'published'],
    4,
  );

  assert.deepEqual(summary, {
    completedJobs: 3,
    failedJobs: 1,
    status: 'failed',
  });
});

test('summarizeScheduleProgress: 진행 중 작업이 있으면 processing 유지', () => {
  const summary = summarizeScheduleProgress(
    ['published', 'publishing', 'generated', 'pending'],
    4,
  );

  assert.deepEqual(summary, {
    completedJobs: 1,
    failedJobs: 0,
    status: 'processing',
  });
});
