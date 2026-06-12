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

test('buildScheduleRequestFingerprint: 시간 정책 차이는 fingerprint에 반영함', () => {
  const defaultTiming = buildScheduleRequestFingerprint({
    accountId: 'dhtksk1p',
    service: 'default',
    ref: '',
    scheduleDate: '2026-04-10',
    scheduleMode: '2',
    generateImages: true,
    imageCount: 5,
    delayBetweenPostsSeconds: 10,
    keywords: ['흑염소효능', '수족냉증'],
    imageSource: 'product',
    manuscriptType: 'hanryeodamwon',
    keywordCategory: '한려담원',
    scheduleTimingKey: '',
  });

  const fixedTiming = buildScheduleRequestFingerprint({
    accountId: 'dhtksk1p',
    service: 'default',
    ref: '',
    scheduleDate: '2026-04-10',
    scheduleMode: '2',
    generateImages: true,
    imageCount: 5,
    delayBetweenPostsSeconds: 10,
    keywords: ['흑염소효능', '수족냉증'],
    imageSource: 'product',
    manuscriptType: 'hanryeodamwon',
    keywordCategory: '한려담원',
    scheduleTimingKey: 'fixed_2350',
  });

  assert.notEqual(defaultTiming, fixedTiming);
});

test('buildScheduleRequestFingerprint: 수동 원고가 다르면 fingerprint도 달라짐', () => {
  const first = buildScheduleRequestFingerprint({
    accountId: 'fail5644',
    service: 'default',
    ref: '',
    scheduleDate: '2026-04-09',
    scheduleMode: '2',
    generateImages: true,
    imageCount: 5,
    delayBetweenPostsSeconds: 10,
    keywords: ['브리티쉬숏헤어분양'],
    manuscripts: [{ title: '첫 제목', content: '첫 본문' }],
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
    keywords: ['브리티쉬숏헤어분양'],
    manuscripts: [{ title: '다른 제목', content: '다른 본문' }],
    imageSource: 'product',
    manuscriptType: 'pet',
    keywordCategory: '애견',
  });

  assert.notEqual(first, second);
});

test('buildScheduleRequestFingerprint: 로컬 multiImages가 다르면 fingerprint도 달라짐', () => {
  const first = buildScheduleRequestFingerprint({
    accountId: 'adplan3th',
    service: 'manual-local',
    ref: 'eye-brand-final',
    scheduleDate: '2026-06-12',
    scheduleMode: '2',
    generateImages: false,
    imageCount: 6,
    delayBetweenPostsSeconds: 10,
    keywords: ['고도근시라식'],
    manuscripts: [{ title: '고도근시 라식', content: '본문' }],
    providedMultiImages: [{ slide: ['/tmp/a/slide_01.png'] }],
    imageSource: 'local',
    manuscriptType: 'default',
    keywordCategory: '안과브랜드',
  });

  const second = buildScheduleRequestFingerprint({
    accountId: 'adplan3th',
    service: 'manual-local',
    ref: 'eye-brand-final',
    scheduleDate: '2026-06-12',
    scheduleMode: '2',
    generateImages: false,
    imageCount: 6,
    delayBetweenPostsSeconds: 10,
    keywords: ['고도근시라식'],
    manuscripts: [{ title: '고도근시 라식', content: '본문' }],
    providedMultiImages: [{ slide: ['/tmp/b/slide_01.png'] }],
    imageSource: 'local',
    manuscriptType: 'default',
    keywordCategory: '안과브랜드',
  });

  assert.notEqual(first, second);
});

test('buildScheduleGenerateJobId/buildSchedulePublishJobId: scheduleJob 기준 고정 job id를 생성함', () => {
  const generateJobId = buildScheduleGenerateJobId('job_123');
  const publishJobId = buildSchedulePublishJobId('job_123');

  assert.equal(generateJobId, 'generate_job_123');
  assert.equal(publishJobId, 'publish_job_123');
  assert.equal(generateJobId.includes(':'), false);
  assert.equal(publishJobId.includes(':'), false);
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

test('buildAdhocGenerateIdentity: BullMQ 호환을 위해 custom job id에 콜론을 넣지 않음', () => {
  const identity = buildAdhocGenerateIdentity({
    mode: 'update',
    accountId: 'fail5644',
    blogId: 'fail5644',
    logNo: '22334455',
    keyword: '터키시앙고라',
  });

  assert.equal(identity.jobId.includes(':'), false);
  assert.match(identity.jobId, /^generate_adhoc_update_/);
});

test('buildAdhocGenerateIdentity: 카테고리가 다르면 다른 id를 반환함', () => {
  const first = buildAdhocGenerateIdentity({
    mode: 'update',
    accountId: 'iealpx8p',
    blogId: 'iealpx8p',
    logNo: '224251309968',
    keyword: '강아지임시보호',
    category: '강아지분양정보',
    imageSource: 'product',
    manuscriptType: 'pet',
    keywordCategory: '애견',
  });

  const second = buildAdhocGenerateIdentity({
    mode: 'update',
    accountId: 'iealpx8p',
    blogId: 'iealpx8p',
    logNo: '224251309968',
    keyword: '강아지임시보호',
    category: '강아지품종',
    imageSource: 'product',
    manuscriptType: 'pet',
    keywordCategory: '애견',
  });

  assert.notEqual(first.jobId, second.jobId);
  assert.notEqual(first.scheduleJobId, second.scheduleJobId);
});

test('buildAdhocGenerateIdentity: 수동 원고가 다르면 다른 id를 반환함', () => {
  const first = buildAdhocGenerateIdentity({
    mode: 'update',
    accountId: 'fail5644',
    blogId: 'fail5644',
    logNo: '22334455',
    keyword: '브리티쉬숏헤어분양',
    manuscriptType: 'pet',
    keywordCategory: '애견',
    providedManuscript: {
      title: '브리티쉬숏헤어분양 체크 포인트',
      content: '첫 본문',
    },
  });

  const second = buildAdhocGenerateIdentity({
    mode: 'update',
    accountId: 'fail5644',
    blogId: 'fail5644',
    logNo: '22334455',
    keyword: '브리티쉬숏헤어분양',
    manuscriptType: 'pet',
    keywordCategory: '애견',
    providedManuscript: {
      title: '브리티쉬숏헤어분양 성격 먼저 보기',
      content: '둘째 본문',
    },
  });

  assert.notEqual(first.jobId, second.jobId);
  assert.notEqual(first.scheduleJobId, second.scheduleJobId);
});
