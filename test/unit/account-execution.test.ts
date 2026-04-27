import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccountExecutionCoordinator } from '../../src/queues/account-execution.js';

test('account execution: 다른 계정은 활성 계정 클리너가 끝날 때까지 대기함', async () => {
  const idleAccounts = new Set<string>(['account-a']);
  const cleanedAccounts: string[] = [];
  const coordinator = createAccountExecutionCoordinator({
    isAccountIdle: async (accountId) => idleAccounts.has(accountId),
    runCleaner: async (accountId) => {
      cleanedAccounts.push(accountId);
    },
  });

  await coordinator.waitForAccountTurn('account-a');

  let accountBStarted = false;
  const accountBTurn = coordinator.waitForAccountTurn('account-b').then(() => {
    accountBStarted = true;
  });

  await Promise.resolve();

  assert.equal(accountBStarted, false);
  assert.equal(coordinator.getActiveAccountId(), 'account-a');

  const released = await coordinator.releaseAccountTurnIfIdle('account-a');

  await accountBTurn;

  assert.equal(released, true);
  assert.equal(accountBStarted, true);
  assert.deepEqual(cleanedAccounts, ['account-a']);
  assert.equal(coordinator.getActiveAccountId(), 'account-b');
});

test('account execution: 같은 계정 작업은 같은 계정 턴에서 바로 진행함', async () => {
  const coordinator = createAccountExecutionCoordinator({
    isAccountIdle: async () => false,
    runCleaner: async () => undefined,
  });

  await coordinator.waitForAccountTurn('account-a');
  await coordinator.waitForAccountTurn('account-a');

  assert.equal(coordinator.getActiveAccountId(), 'account-a');
});

test('account execution: 활성 계정 큐가 남아 있으면 클리너를 실행하지 않음', async () => {
  let isIdle = false;
  const cleanedAccounts: string[] = [];
  const coordinator = createAccountExecutionCoordinator({
    isAccountIdle: async () => isIdle,
    runCleaner: async (accountId) => {
      cleanedAccounts.push(accountId);
    },
  });

  await coordinator.waitForAccountTurn('account-a');

  const firstRelease = await coordinator.releaseAccountTurnIfIdle('account-a');

  assert.equal(firstRelease, false);
  assert.deepEqual(cleanedAccounts, []);
  assert.equal(coordinator.getActiveAccountId(), 'account-a');

  isIdle = true;

  const secondRelease = await coordinator.releaseAccountTurnIfIdle('account-a');

  assert.equal(secondRelease, true);
  assert.deepEqual(cleanedAccounts, ['account-a']);
  assert.equal(coordinator.getActiveAccountId(), null);
});
