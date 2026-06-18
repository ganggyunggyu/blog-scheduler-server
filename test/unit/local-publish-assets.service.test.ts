import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProvidedProductData,
  hasMultiImageData,
  hasPreparedProductImages,
  needsBodyImageFallback,
} from '../../src/services/local-publish-assets.service.js';

test('hasMultiImageData: 로컬 slide 이미지가 있으면 true를 반환함', () => {
  assert.equal(
    hasMultiImageData({ slide: ['/tmp/slide_01.png'] }),
    true,
  );
});

test('hasMultiImageData: 빈 multiImages는 false를 반환함', () => {
  assert.equal(
    hasMultiImageData({ slide: [] }),
    false,
  );
});

test('buildProvidedProductData: 로컬 multiImages를 PreparedProductData 형태로 감쌈', () => {
  const result = buildProvidedProductData({
    slide: ['/tmp/slide_01.png', '/tmp/slide_02.png'],
  });

  assert.deepEqual(result, {
    bodyImages: [],
    excludeLibrary: [],
    multiImages: {
      slide: ['/tmp/slide_01.png', '/tmp/slide_02.png'],
    },
    excludeLibraryLink: [],
    metadata: {},
  });
});

test('hasPreparedProductImages: 알리바바용 product 이미지 묶음이 하나라도 있으면 true를 반환함', () => {
  assert.equal(
    hasPreparedProductImages({
      bodyImages: [],
      excludeLibrary: ['/tmp/excluded.webp'],
      multiImages: {},
      excludeLibraryLink: [],
      metadata: {},
    }),
    true,
  );

  assert.equal(
    hasPreparedProductImages({
      bodyImages: [],
      excludeLibrary: [],
      multiImages: {},
      excludeLibraryLink: [],
      metadata: {},
    }),
    false,
  );
});

test('needsBodyImageFallback: 안과브랜드 slide가 있으면 외부 body 이미지 fallback이 필요 없음', () => {
  assert.equal(
    needsBodyImageFallback({
      keywordCategory: '안과브랜드',
      bodyImages: [],
      multiImages: { slide: ['/tmp/slide_01.png'] },
    }),
    false,
  );
});

test('needsBodyImageFallback: 일반 안과는 slide만으로 content 이미지를 대체하지 않음', () => {
  assert.equal(
    needsBodyImageFallback({
      keywordCategory: '안과',
      bodyImages: [],
      multiImages: { slide: ['/tmp/slide_01.png'] },
    }),
    true,
  );
});
