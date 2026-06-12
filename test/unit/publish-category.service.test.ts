import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublishCategory } from '../../src/services/publish-category.service.js';

test('resolvePublishCategory: 안과브랜드 파이프라인은 에스앤비 안과 카테고리를 기본 선택함', () => {
  assert.equal(
    resolvePublishCategory({ keywordCategory: '안과브랜드' }),
    '에스앤비 안과',
  );
});

test('resolvePublishCategory: 글별 카테고리가 있으면 파이프라인 기본값보다 우선함', () => {
  assert.equal(
    resolvePublishCategory({
      jobCategory: '에스앤비 안과',
      keywordCategory: '안과브랜드',
    }),
    '에스앤비 안과',
  );
});

test('resolvePublishCategory: 일반 파이프라인은 기존 keywordCategory를 유지함', () => {
  assert.equal(
    resolvePublishCategory({ keywordCategory: '안과' }),
    '안과',
  );
});
