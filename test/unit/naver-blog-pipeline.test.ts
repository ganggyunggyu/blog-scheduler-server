import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALIBABA_CONTENT_PIPELINE, getContentImagesForBlock, getContentPipeline, getMultiImagesForBlock } from '../../src/services/naver-blog-pipeline.js';

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

test('getContentPipeline: 알리바바는 본문 뒤 multiImages가 있을 때만 하단 여백을 넣고 업로드함', () => {
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

test('getContentPipeline: 안과브랜드는 기준 글처럼 본문과 남은 multiImages만 사용함', () => {
  assert.deepEqual(getContentPipeline({ keywordCategory: '안과브랜드' }), [
    'content',
    'multiImages',
  ]);
});

test('getContentImagesForBlock: 안과브랜드는 slide 이미지를 본문 삽입 이미지로 우선 사용함', () => {
  assert.deepEqual(
    getContentImagesForBlock({
      keywordCategory: '안과브랜드',
      manuscriptType: 'default',
      block: 'content',
      normalImages: ['body_1.webp'],
      multiImages: { slide: ['slide_1.webp', 'slide_2.webp'] },
    }),
    ['slide_1.webp', 'slide_2.webp'],
  );
});

test('getContentImagesForBlock: 안과브랜드 slide 이미지가 없으면 body 이미지를 유지함', () => {
  assert.deepEqual(
    getContentImagesForBlock({
      keywordCategory: '안과브랜드',
      manuscriptType: 'default',
      block: 'content',
      normalImages: ['body_1.webp'],
      multiImages: { individual: ['individual_1.webp'] },
    }),
    ['body_1.webp'],
  );
});

test('getMultiImagesForBlock: 안과브랜드는 본문 삽입한 slide를 중복 업로드하지 않음', () => {
  assert.deepEqual(
    getMultiImagesForBlock({
      keywordCategory: '안과브랜드',
      multiImages: {
        individual: ['individual_1.webp'],
        slide: ['slide_1.webp'],
        collage: ['collage_1.webp'],
      },
    }),
    {
      individual: ['individual_1.webp'],
      collage: ['collage_1.webp'],
    },
  );
});

test('getMultiImagesForBlock: 안과브랜드가 slide만 갖고 있으면 multiImages 단계를 스킵함', () => {
  assert.equal(
    getMultiImagesForBlock({
      keywordCategory: '안과브랜드',
      multiImages: { slide: ['slide_1.webp'] },
    }),
    undefined,
  );
});
