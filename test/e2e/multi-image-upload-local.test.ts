import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'fs/promises';

import { TEST_ACCOUNT } from '../fixtures/test-data';
import { runLocalImageUploadTest } from './helpers/multi-upload/local-runner.ts';

const IMAGE_ROOT = process.env.TEST_IMAGE_ROOT ?? '';

const buildAccount = () => ({
  id: TEST_ACCOUNT.id,
  password: TEST_ACCOUNT.pw,
});

test('[E2E] multi image upload (local)', async () => {
  assert.ok(TEST_ACCOUNT.id, 'TEST_ID가 필요합니다.');
  assert.ok(TEST_ACCOUNT.pw, 'TEST_PW가 필요합니다.');
  assert.ok(IMAGE_ROOT, 'TEST_IMAGE_ROOT가 필요합니다.');

  await access(IMAGE_ROOT);

  await runLocalImageUploadTest({
    account: buildAccount(),
    imageRoot: IMAGE_ROOT,
  });
});
