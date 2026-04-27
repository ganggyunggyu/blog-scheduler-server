import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProductImageRequest, normalizeImageDownloadUrl } from '../../src/services/product-image.service.js';

test('buildProductImageRequest: 애견은 product-images 요청에 category를 싣지 않음', () => {
  const result = buildProductImageRequest({
    keyword: '강아지',
    blogId: 'qwzx16',
    category: '애견',
    dateCode: '0331',
  });

  assert.equal(result.endpoint, 'product-images');
  assert.equal(result.url, 'http://localhost:3939/api/image/product-images');
  assert.deepEqual(result.params, {
    keyword: '강아지',
    blogId: 'qwzx16',
    dateCode: '0331',
  });
});

test('buildProductImageRequest: 한려담원은 category-random 요청으로 보냄', () => {
  const result = buildProductImageRequest({
    keyword: '흑염소진액',
    blogId: 'qwzx16',
    category: '한려담원',
    dateCode: '0331',
  });

  assert.equal(result.endpoint, 'category-random');
  assert.equal(result.url, 'http://localhost:3939/api/image/category-random');
  assert.deepEqual(result.params, {
    category: '한려담원',
    keyword: '흑염소진액',
    dateCode: '0331',
  });
});

test('buildProductImageRequest: 알리바바 manuscriptType은 product-images 요청에 함께 실음', () => {
  const result = buildProductImageRequest({
    keyword: '1688',
    blogId: 'weed3122',
    dateCode: '0413',
    manuscriptType: 'alibaba',
  });

  assert.equal(result.endpoint, 'product-images');
  assert.equal(result.url, 'http://localhost:3939/api/image/product-images');
  assert.deepEqual(result.params, {
    keyword: '1688',
    blogId: 'weed3122',
    dateCode: '0413',
    manuscriptType: 'alibaba',
  });
});

test('normalizeImageDownloadUrl: 한글 S3 경로를 axios 다운로드 가능한 URL로 인코딩함', () => {
  const result = normalizeImageDownloadUrl('https://21lab-images.s3.ap-northeast-2.amazonaws.com/product-images/weed3122/1688도매사이트/라이브러리제외이미지/라이브러리제외이미지_1.JPG');

  assert.equal(
    result,
    'https://21lab-images.s3.ap-northeast-2.amazonaws.com/product-images/weed3122/1688%EB%8F%84%EB%A7%A4%EC%82%AC%EC%9D%B4%ED%8A%B8/%EB%9D%BC%EC%9D%B4%EB%B8%8C%EB%9F%AC%EB%A6%AC%EC%A0%9C%EC%99%B8%EC%9D%B4%EB%AF%B8%EC%A7%80/%EB%9D%BC%EC%9D%B4%EB%B8%8C%EB%9F%AC%EB%A6%AC%EC%A0%9C%EC%99%B8%EC%9D%B4%EB%AF%B8%EC%A7%80_1.JPG'
  );
});
