import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccountExecutionCoordinator } from '../../src/queues/account-execution.js';

test('account execution: 다른 계정은 서로 대기하지 않고 병렬로 활성화됨', async () => {
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
  await coordinator.waitForAccountTurn('account-b').then(() => {
    accountBStarted = true;
  });

  assert.equal(accountBStarted, true);
  assert.deepEqual(coordinator.getActiveAccountIds().sort(), ['account-a', 'account-b']);

  const released = await coordinator.releaseAccountTurnIfIdle('account-a');

  assert.equal(released, true);
  assert.deepEqual(cleanedAccounts, ['account-a']);
  assert.deepEqual(coordinator.getActiveAccountIds(), ['account-b']);
});

test('account execution: 같은 계정 작업은 같은 계정 턴에서 바로 진행함', async () => {
  const coordinator = createAccountExecutionCoordinator({
    isAccountIdle: async () => false,
    runCleaner: async () => undefined,
  });

  await coordinator.waitForAccountTurn('account-a');
  await coordinator.waitForAccountTurn('account-a');

  assert.equal(coordinator.getActiveAccountId(), 'account-a');
  assert.deepEqual(coordinator.getActiveAccountIds(), ['account-a']);
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
  assert.deepEqual(coordinator.getActiveAccountIds(), ['account-a']);

  isIdle = true;

  const secondRelease = await coordinator.releaseAccountTurnIfIdle('account-a');

  assert.equal(secondRelease, true);
  assert.deepEqual(cleanedAccounts, ['account-a']);
  assert.equal(coordinator.getActiveAccountId(), null);
  assert.deepEqual(coordinator.getActiveAccountIds(), []);
});

test('account execution: 같은 계정은 클리너 실행 중 새 작업을 대기시킴', async () => {
  let finishCleanup = () => undefined;
  const coordinator = createAccountExecutionCoordinator({
    isAccountIdle: async () => true,
    runCleaner: async () => new Promise<void>((resolve) => {
      finishCleanup = resolve;
    }),
  });

  await coordinator.waitForAccountTurn('account-a');

  const releasePromise = coordinator.releaseAccountTurnIfIdle('account-a');
  await Promise.resolve();

  let nextStarted = false;
  const nextTurn = coordinator.waitForAccountTurn('account-a').then(() => {
    nextStarted = true;
  });

  await Promise.resolve();

  assert.equal(nextStarted, false);

  finishCleanup();
  await releasePromise;
  await nextTurn;

  assert.equal(nextStarted, true);
  assert.deepEqual(coordinator.getActiveAccountIds(), ['account-a']);
});
