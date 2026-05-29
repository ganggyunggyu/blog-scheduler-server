import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALIBABA_CONTENT_PIPELINE, getContentImagesForBlock, getContentPipeline } from '../../src/services/naver-blog-pipeline.js';

test('getContentPipeline: 애견은 link 뒤에 spacing 후 content 순서 사용', () => {
  assert.deepEqual(getContentPipeline({ keywordCategory: '애견' }), [
    'excluded1',
    'maps',
    'phone',
    'excluded2',
    'excluded3',
    'link',
    'spacing',
    'content',
  ]);
});

test('getContentPipeline: default 파이프라인은 기존 순서 유지', () => {
  assert.deepEqual(getContentPipeline(), [
    'excluded1',
    'maps',
    'phone',
    'excluded2',
    'content',
    'excluded3',
    'link',
    'multiImages',
  ]);
});

test('getContentPipeline: 알리바바는 본문 뒤 하단 이미지 전 여백을 넣고 multiImages를 업로드함', () => {
  assert.deepEqual(getContentPipeline({ manuscriptType: 'alibaba' }), ALIBABA_CONTENT_PIPELINE);
});

test('getContentPipeline: 알리바바 manuscriptType은 category 분기보다 우선함', () => {
  assert.deepEqual(
    getContentPipeline({ keywordCategory: '애견', manuscriptType: 'alibaba' }),
    ALIBABA_CONTENT_PIPELINE,
  );
});

test('getContentImagesForBlock: 알리바바 content 단계는 body 이미지를 유지함', () => {
  assert.deepEqual(
    getContentImagesForBlock({
      manuscriptType: 'alibaba',
      block: 'content',
      normalImages: ['body_1.webp', 'body_2.webp'],
    }),
    ['body_1.webp', 'body_2.webp'],
  );
});

test('getContentImagesForBlock: 기본 content 단계는 body 이미지를 유지함', () => {
  assert.deepEqual(
    getContentImagesForBlock({
      manuscriptType: 'default',
      block: 'content',
      normalImages: ['body_1.webp', 'body_2.webp'],
    }),
    ['body_1.webp', 'body_2.webp'],
  );
});

test('getContentPipeline: 안과는 라이브러리제외 이미지가 없으면 spacing을 제외함', () => {
  assert.deepEqual(getContentPipeline({ keywordCategory: '안과', hasExcludeLibrary: false }), [
    'allExcluded',
    'excludeLibraryLinks',
    'maps',
    'content',
    'multiImages',
  ]);
});

test('getContentPipeline: 안과기본은 라이브러리제외 이미지가 없으면 spacing을 제외함', () => {
  assert.deepEqual(getContentPipeline({ keywordCategory: '안과기본', hasExcludeLibrary: false }), [
    'maps',
    'content',
    'multiImages',
  ]);
});

test('getContentPipeline: 안과는 라이브러리제외 이미지가 있으면 spacing을 유지함', () => {
  assert.deepEqual(getContentPipeline({ keywordCategory: '안과', hasExcludeLibrary: true }), [
    'allExcluded',
    'excludeLibraryLinks',
    'maps',
    'spacing',
    'content',
    'multiImages',
  ]);
});
