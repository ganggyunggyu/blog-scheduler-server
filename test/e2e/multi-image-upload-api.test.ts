import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TEST_ACCOUNT, KEYWORDS } from '../fixtures/test-data';
import { runApiImageUploadTest } from './helpers/multi-upload/api-runner.ts';

const IMAGE_API_URL = process.env.IMAGE_API_URL ?? 'http://localhost:3939/api/image/product-images';
const IMAGE_API_KEYWORD = process.env.IMAGE_API_KEYWORD ?? KEYWORDS.뱅갈고양이.keyword;

const buildAccount = () => ({
  id: TEST_ACCOUNT.id,
  password: TEST_ACCOUNT.pw,
});

test('[E2E] multi image upload (api)', async () => {
  assert.ok(TEST_ACCOUNT.id, 'TEST_ID가 필요합니다.');
  assert.ok(TEST_ACCOUNT.pw, 'TEST_PW가 필요합니다.');
  assert.ok(IMAGE_API_URL, 'IMAGE_API_URL이 필요합니다.');

  await runApiImageUploadTest({
    account: buildAccount(),
    apiUrl: IMAGE_API_URL,
    keyword: IMAGE_API_KEYWORD,
    maxPerType: 3,
  });
});
