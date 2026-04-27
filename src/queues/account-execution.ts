export interface AccountExecutionCoordinator {
  waitForAccountTurn: (accountId: string) => Promise<void>;
  releaseAccountTurnIfIdle: (accountId: string) => Promise<boolean>;
  getActiveAccountId: () => string | null;
}

interface AccountExecutionCoordinatorInput {
  isAccountIdle: (accountId: string) => Promise<boolean>;
  runCleaner: (accountId: string) => Promise<void>;
  onCleanerError?: (accountId: string, error: unknown) => void | Promise<void>;
}

interface WaitingAccount {
  accountId: string;
  resolve: () => void;
}

export const createAccountExecutionCoordinator = ({
  isAccountIdle,
  runCleaner,
  onCleanerError,
}: AccountExecutionCoordinatorInput): AccountExecutionCoordinator => {
  let activeAccountId: string | null = null;
  let cleanupPromise: Promise<void> | null = null;
  let releasePromise: Promise<boolean> | null = null;
  const waiters: WaitingAccount[] = [];

  const resolveActiveAccountWaiters = (): void => {
    if (!activeAccountId) {
      return;
    }

    for (let index = 0; index < waiters.length;) {
      const waiter = waiters[index];
      if (waiter.accountId !== activeAccountId) {
        index += 1;
        continue;
      }

      waiters.splice(index, 1);
      waiter.resolve();
    }
  };

  const activateNextAccount = (): void => {
    if (activeAccountId) {
      resolveActiveAccountWaiters();
      return;
    }

    const next = waiters.shift();
    if (!next) {
      return;
    }

    activeAccountId = next.accountId;
    next.resolve();
    resolveActiveAccountWaiters();
  };

  const runCleanup = async (accountId: string): Promise<void> => {
    try {
      await runCleaner(accountId);
    } catch (error) {
      await onCleanerError?.(accountId, error);
    } finally {
      if (activeAccountId === accountId) {
        activeAccountId = null;
      }
      cleanupPromise = null;
      activateNextAccount();
    }
  };

  const waitForAccountTurn = async (accountId: string): Promise<void> => {
    if (cleanupPromise) {
      await cleanupPromise;
    }

    if (!activeAccountId) {
      activeAccountId = accountId;
      return;
    }

    if (activeAccountId === accountId) {
      return;
    }

    await new Promise<void>((resolve) => {
      waiters.push({ accountId, resolve });
    });
  };

  const releaseAccountTurnIfIdle = async (accountId: string): Promise<boolean> => {
    if (releasePromise) {
      return releasePromise;
    }

    releasePromise = (async () => {
      if (activeAccountId !== accountId || cleanupPromise) {
        return false;
      }

      const idle = await isAccountIdle(accountId);
      if (!idle) {
        return false;
      }

      cleanupPromise = runCleanup(accountId);
      await cleanupPromise;
      return true;
    })().finally(() => {
      releasePromise = null;
    });

    return releasePromise;
  };

  return {
    waitForAccountTurn,
    releaseAccountTurnIfIdle,
    getActiveAccountId: () => activeAccountId,
  };
};
