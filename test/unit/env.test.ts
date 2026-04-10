import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../../src/config/env.js';

const BASE_ENV = {
  MONGO_URI: 'mongodb://localhost:27017/test',
};

test('parseEnv: PLAYWRIGHT_HEADLESS 기본값은 true 임', () => {
  const parsed = parseEnv(BASE_ENV);

  assert.equal(parsed.PLAYWRIGHT_HEADLESS, true);
});

test('parseEnv: PLAYWRIGHT_HEADLESS 문자열 false 를 boolean false 로 파싱함', () => {
  const parsed = parseEnv({
    ...BASE_ENV,
    PLAYWRIGHT_HEADLESS: 'false',
  });

  assert.equal(parsed.PLAYWRIGHT_HEADLESS, false);
});
