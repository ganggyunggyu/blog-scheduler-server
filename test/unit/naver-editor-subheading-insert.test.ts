import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { isSubheading } from '../../src/lib/naver-editor/subheading.js';
import { insertImagesAtSubheadings } from '../../src/lib/naver-editor/image.js';

test('isSubheading: 번호/괄호/화살표 소제목 패턴을 인식함', () => {
  assert.equal(isSubheading('1. 첫 번째 소제목'), true);
  assert.equal(isSubheading('【1】두 번째 소제목'), true);
  assert.equal(isSubheading('[1] 세 번째 소제목'), true);
  assert.equal(isSubheading('▶ 1 네 번째 소제목'), true);
  assert.equal(isSubheading('그냥 평범한 본문 문장'), false);
  assert.equal(isSubheading(''), false);
});

test('insertImagesAtSubheadings: 소제목마다 이미지를 순서대로 하나씩 삽입함', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'insert-subheading-'));
  const imageA = path.join(tmpDir, 'a.webp');
  const imageB = path.join(tmpDir, 'b.webp');
  await writeFile(imageA, Buffer.from([1]));
  await writeFile(imageB, Buffer.from([2]));

  const paragraphTexts = ['인트로 문단', '1. 첫 번째 소제목', '본문 내용 1', '2. 두 번째 소제목', '본문 내용 2'];

  let imageComponentCount = 0;
  const uploadedFiles: string[] = [];

  const fileChooser = {
    setFiles: mock.fn(async (filePath: string) => {
      uploadedFiles.push(filePath);
      imageComponentCount += 1;
    }),
  };

  const imageButton = {
    scrollIntoViewIfNeeded: mock.fn(async () => undefined),
    click: mock.fn(async () => undefined),
  };

  const locator = {
    count: mock.fn(async () => imageComponentCount),
    first: mock.fn(() => locator),
    waitFor: mock.fn(async () => undefined),
  };

  const page = {
    waitForEvent: mock.fn(async () => fileChooser),
    waitForTimeout: mock.fn(async () => undefined),
    keyboard: { press: mock.fn(async () => undefined) },
  };

  const frame = {
    evaluate: mock.fn(async (_fn: unknown, arg?: unknown) => {
      if (arg === undefined) {
        return paragraphTexts;
      }
      return true;
    }),
    $: mock.fn(async (selector: string) => (selector.includes('image') ? imageButton : null)),
    locator: mock.fn(() => locator),
    waitForFunction: mock.fn(async () => undefined),
  };

  try {
    const result = await insertImagesAtSubheadings(page as never, frame as never, [imageA, imageB]);

    assert.deepEqual(result, { inserted: 2, matched: 2 });
    assert.deepEqual(uploadedFiles, [imageA, imageB]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('insertImagesAtSubheadings: 소제목을 못 찾으면 matched=0 을 돌려줌 (호출부가 폴백 처리)', async () => {
  const paragraphTexts = ['그냥 평범한 문단', '또 다른 문단'];

  const frame = {
    evaluate: mock.fn(async (_fn: unknown, arg?: unknown) => {
      if (arg === undefined) {
        return paragraphTexts;
      }
      return true;
    }),
  };
  const page = { waitForTimeout: mock.fn(async () => undefined) };

  const result = await insertImagesAtSubheadings(page as never, frame as never, ['/tmp/x.png']);

  assert.deepEqual(result, { inserted: 0, matched: 0 });
});

test('insertImagesAtSubheadings: 소제목보다 이미지가 적으면 이미지 개수만큼만 매칭함', async () => {
  const paragraphTexts = ['1. 하나', '2. 둘', '3. 셋'];
  let calls = 0;

  const frame = {
    evaluate: mock.fn(async (_fn: unknown, arg?: unknown) => {
      if (arg === undefined) {
        return paragraphTexts;
      }
      calls += 1;
      return false; // focus 실패로 처리해 uploadImage 까지 안 가도 matched 값만 검증
    }),
  };
  const page = { waitForTimeout: mock.fn(async () => undefined) };

  const result = await insertImagesAtSubheadings(page as never, frame as never, ['/tmp/only-one.png']);

  assert.equal(result.matched, 1);
  assert.equal(result.inserted, 0);
  assert.equal(calls, 1);
});
