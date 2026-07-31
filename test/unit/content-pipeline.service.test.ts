import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_BLOCK_CATALOG,
  assertValidBlocks,
  resolveContentPipelineBlocks,
} from '../../src/services/content-pipeline.service.js';
import { CONTENT_PIPELINES, ALIBABA_CONTENT_PIPELINE } from '../../src/services/naver-blog-pipeline.js';

test('CONTENT_BLOCK_CATALOG: 프론트가 편집기를 그릴 수 있게 블록마다 라벨과 설명을 준다', () => {
  assert.ok(CONTENT_BLOCK_CATALOG.length >= 13);
  CONTENT_BLOCK_CATALOG.forEach((block) => {
    assert.ok(block.type.length > 0, JSON.stringify(block));
    assert.ok(block.label.length > 0, block.type);
    assert.ok(block.description.length > 0, block.type);
  });
});

test('assertValidBlocks: 카탈로그에 없는 블록은 막는다', () => {
  assert.throws(
    () => assertValidBlocks(['content', 'nope']),
    /알 수 없는 블록: nope/,
  );
});

/**
 * content 가 빠지면 원고 본문이 통째로 안 들어가고, 두 번 들어가면 같은 글이 두 번 붙는다.
 * 사용자가 화면에서 순서를 짜다가 흔히 내는 실수라 저장 단계에서 막는다.
 */
test('assertValidBlocks: content 가 없으면 막는다', () => {
  assert.throws(() => assertValidBlocks(['maps', 'link']), /content 블록이 정확히 한 번/);
});

test('assertValidBlocks: content 가 두 번이면 막는다', () => {
  assert.throws(
    () => assertValidBlocks(['content', 'maps', 'content']),
    /content 블록이 정확히 한 번/,
  );
});

test('assertValidBlocks: 정상 조합은 통과한다', () => {
  assert.doesNotThrow(() => assertValidBlocks(['maps', 'spacing', 'content', 'multiImages']));
});

test('resolveContentPipelineBlocks: 커스텀이 있으면 그걸 쓴다', () => {
  const blocks = resolveContentPipelineBlocks({
    custom: ['content', 'link'],
    keywordCategory: '애견',
  });

  assert.deepEqual(blocks, ['content', 'link']);
});

test('resolveContentPipelineBlocks: 커스텀이 없으면 기존 내장 파이프라인으로 떨어진다', () => {
  const blocks = resolveContentPipelineBlocks({ keywordCategory: '애견' });

  assert.deepEqual(blocks, CONTENT_PIPELINES['애견']);
});

test('resolveContentPipelineBlocks: 알리바바는 커스텀이 없으면 전용 파이프라인을 쓴다', () => {
  const blocks = resolveContentPipelineBlocks({ manuscriptType: 'alibaba' });

  assert.deepEqual(blocks, ALIBABA_CONTENT_PIPELINE);
});

test('resolveContentPipelineBlocks: 커스텀은 알리바바 분기보다도 우선한다', () => {
  const blocks = resolveContentPipelineBlocks({
    custom: ['content'],
    manuscriptType: 'alibaba',
  });

  assert.deepEqual(blocks, ['content']);
});

test('resolveContentPipelineBlocks: 안과 spacing 제외 규칙은 내장 경로에서만 적용된다', () => {
  const builtin = resolveContentPipelineBlocks({
    keywordCategory: '안과',
    hasExcludeLibrary: false,
  });
  assert.ok(!builtin.includes('spacing'));

  const custom = resolveContentPipelineBlocks({
    custom: ['maps', 'spacing', 'content'],
    keywordCategory: '안과',
    hasExcludeLibrary: false,
  });
  assert.ok(custom.includes('spacing'), '커스텀은 사용자가 짠 순서를 그대로 존중해야 함');
});
