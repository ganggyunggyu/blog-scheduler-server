import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSession } from '../../src/lib/naver-editor/browser.js';

test('closeSession: already closed browser context errors are ignored', async () => {
  const session = {
    context: {
      close: async () => {
        throw new Error('browserContext.close: Target page, context or browser has been closed');
      },
    },
  } as Parameters<typeof closeSession>[0];

  await assert.doesNotReject(closeSession(session));
});

test('closeSession: unexpected errors still throw', async () => {
  const expectedError = new Error('unexpected close failure');
  const session = {
    context: {
      close: async () => {
        throw expectedError;
      },
    },
  } as Parameters<typeof closeSession>[0];

  await assert.rejects(closeSession(session), expectedError);
});
