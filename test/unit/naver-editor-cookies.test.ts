import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSessionCookies } from '../../src/lib/naver-editor/cookies.js';

test('normalizeSessionCookies: keeps valid domain and path cookies', () => {
  const cookies = normalizeSessionCookies([
    {
      name: 'NID_SES',
      value: 'session',
      domain: '.naver.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);

  assert.deepEqual(cookies, [
    {
      name: 'NID_SES',
      value: 'session',
      domain: '.naver.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
});

test('normalizeSessionCookies: rejects cookies without url or domain/path', () => {
  assert.throws(
    () =>
      normalizeSessionCookies([
        {
          name: 'broken',
          value: 'cookie',
        },
      ]),
    /must include url or both domain and path/
  );
});
