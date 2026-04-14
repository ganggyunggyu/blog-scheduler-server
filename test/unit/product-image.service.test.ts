import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProductImageRequest } from '../../src/services/product-image.service.js';

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
