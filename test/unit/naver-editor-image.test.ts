import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { uploadImage } from '../../src/lib/naver-editor/image.js';

test('uploadImage: 에디터 이미지 컴포넌트가 실제 삽입될 때까지 재시도함', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'naver-editor-image-'));
  const imagePath = path.join(tmpDir, 'body_1.webp');
  await writeFile(imagePath, Buffer.from([1, 2, 3]));

  let setFilesCount = 0;
  let imageComponentCount = 0;

  const fileChooser = {
    setFiles: mock.fn(async () => {
      setFilesCount += 1;
      if (setFilesCount === 2) {
        imageComponentCount = 1;
      }
    }),
  };

  const imageButton = {
    scrollIntoViewIfNeeded: mock.fn(async () => undefined),
    click: mock.fn(async () => undefined),
  };

  const page = {
    waitForEvent: mock.fn(async () => fileChooser),
    waitForTimeout: mock.fn(async () => undefined),
    keyboard: {
      press: mock.fn(async () => undefined),
    },
  };

  const locator = {
    count: mock.fn(async () => imageComponentCount),
    first: mock.fn(() => locator),
    waitFor: mock.fn(async () => undefined),
  };

  const frame = {
    $: mock.fn(async (selector: string) => (
      selector.includes('image') ? imageButton : null
    )),
    locator: mock.fn(() => locator),
    waitForFunction: mock.fn(async () => {
      if (imageComponentCount === 0) {
        throw new Error('not inserted yet');
      }
    }),
  };

  try {
    const result = await uploadImage(page as never, frame as never, imagePath);

    assert.equal(result, true);
    assert.equal(setFilesCount, 2);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
