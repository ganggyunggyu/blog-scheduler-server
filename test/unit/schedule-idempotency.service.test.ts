import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdhocGenerateIdentity,
  buildScheduleGenerateJobId,
  buildSchedulePublishJobId,
  buildScheduleRequestFingerprint,
} from '../../src/services/schedule-idempotency.service.js';

test('buildScheduleRequestFingerprint: 동일 요청은 같은 fingerprint를 반환함', () => {
  const first = buildScheduleRequestFingerprint({
    accountId: 'fail5644',
    service: 'default',
    ref: '',
    scheduleDate: '2026-04-09',
    scheduleMode: '2',
    generateImages: true,
    imageCount: 5,
    delayBetweenPostsSeconds: 10,
    keywords: ['터키시앙고라', '털안빠지는강아지'],
    imageSource: 'product',
    manuscriptType: 'pet',
    keywordCategory: '애견',
  });

  const second = buildScheduleRequestFingerprint({
    accountId: 'fail5644',
    service: 'default',
    ref: '',
    scheduleDate: '2026-04-09',
    scheduleMode: '2',
    generateImages: true,
    imageCount: 5,
    delayBetweenPostsSeconds: 10,
    keywords: ['터키시앙고라', '털안빠지는강아지'],
    imageSource: 'product',
    manuscriptType: 'pet',
    keywordCategory: '애견',
  });

  assert.equal(first, second);
});

test('buildScheduleRequestFingerprint: 공백 차이는 무시하지만 모드 차이는 반영함', () => {
  const trimmed = buildScheduleRequestFingerprint({
    accountId: 'fail5644',
    service: 'default',
    ref: '',
    scheduleDate: '2026-04-09',
    scheduleMode: '2',
    generateImages: true,
    imageCount: 5,
    delayBetweenPostsSeconds: 10,
    keywords: [' 터키시앙고라 ', '털안빠지는강아지'],
    imageSource: 'product',
    manuscriptType: 'pet',
    keywordCategory: '애견',
  });

  const differentMode = buildScheduleRequestFingerprint({
    accountId: 'fail5644',
    service: 'default',
    ref: '',
    scheduleDate: '2026-04-09',
    scheduleMode: '3',
    generateImages: true,
    imageCount: 5,
    delayBetweenPostsSeconds: 10,
    keywords: ['터키시앙고라', '털안빠지는강아지'],
    imageSource: 'product',
    manuscriptType: 'pet',
    keywordCategory: '애견',
  });

  assert.notEqual(trimmed, differentMode);
});

test('buildScheduleGenerateJobId/buildSchedulePublishJobId: scheduleJob 기준 고정 job id를 생성함', () => {
  assert.equal(buildScheduleGenerateJobId('job_123'), 'generate:job_123');
  assert.equal(buildSchedulePublishJobId('job_123'), 'publish:job_123');
});

test('buildAdhocGenerateIdentity: 동일 update 요청은 같은 id를 반환함', () => {
  const first = buildAdhocGenerateIdentity({
    mode: 'update',
    accountId: 'fail5644',
    blogId: 'fail5644',
    logNo: '22334455',
    keyword: '터키시앙고라',
    service: 'default',
    ref: '',
    imageSource: 'product',
    manuscriptType: 'pet',
    keywordCategory: '애견',
  });

  const second = buildAdhocGenerateIdentity({
    mode: 'update',
    accountId: 'fail5644',
    blogId: 'fail5644',
    logNo: '22334455',
    keyword: '터키시앙고라',
    service: 'default',
    ref: '',
    imageSource: 'product',
    manuscriptType: 'pet',
    keywordCategory: '애견',
  });

  assert.deepEqual(first, second);
});

test('buildAdhocGenerateIdentity: logNo가 다르면 다른 id를 반환함', () => {
  const first = buildAdhocGenerateIdentity({
    mode: 'image-replace',
    accountId: 'fail5644',
    blogId: 'fail5644',
    logNo: '22334455',
    keyword: '한려담원',
  });

  const second = buildAdhocGenerateIdentity({
    mode: 'image-replace',
    accountId: 'fail5644',
    blogId: 'fail5644',
    logNo: '22334456',
    keyword: '한려담원',
  });

  assert.notEqual(first.jobId, second.jobId);
  assert.notEqual(first.scheduleJobId, second.scheduleJobId);
});
