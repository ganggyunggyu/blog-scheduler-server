import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getContentPipeline } from '../../src/services/naver-blog-pipeline.js';

test('getContentPipeline: 애견은 link 뒤에 spacing 후 content 순서 사용', () => {
  assert.deepEqual(getContentPipeline('애견'), [
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
