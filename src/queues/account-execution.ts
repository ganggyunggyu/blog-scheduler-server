export interface AccountExecutionCoordinator {
  waitForAccountTurn: (accountId: string) => Promise<void>;
  releaseAccountTurnIfIdle: (accountId: string) => Promise<boolean>;
  getActiveAccountId: () => string | null;
  getActiveAccountIds: () => string[];
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
  const activeAccountIds = new Set<string>();
  const cleanupPromises = new Map<string, Promise<void>>();
  const releasePromises = new Map<string, Promise<boolean>>();
  const waiters: WaitingAccount[] = [];

  const resolveAccountWaiters = (accountId: string): void => {
    for (let index = 0; index < waiters.length;) {
      const waiter = waiters[index];
      if (waiter.accountId !== accountId) {
        index += 1;
        continue;
      }

      waiters.splice(index, 1);
      waiter.resolve();
    }
  };

  const runCleanup = async (accountId: string): Promise<void> => {
    try {
      await runCleaner(accountId);
    } catch (error) {
      await onCleanerError?.(accountId, error);
    } finally {
      activeAccountIds.delete(accountId);
      cleanupPromises.delete(accountId);
      resolveAccountWaiters(accountId);
    }
  };

  const waitForAccountTurn = async (accountId: string): Promise<void> => {
    const cleanupPromise = cleanupPromises.get(accountId);
    if (cleanupPromise) {
      await new Promise<void>((resolve) => {
        waiters.push({ accountId, resolve });
      });
    }

    activeAccountIds.add(accountId);
  };

  const releaseAccountTurnIfIdle = async (accountId: string): Promise<boolean> => {
    const existingRelease = releasePromises.get(accountId);
    if (existingRelease) {
      return existingRelease;
    }

    const releasePromise = (async () => {
      if (!activeAccountIds.has(accountId) || cleanupPromises.has(accountId)) {
        return false;
      }

      const idle = await isAccountIdle(accountId);
      if (!idle) {
        return false;
      }

      const cleanupPromise = runCleanup(accountId);
      cleanupPromises.set(accountId, cleanupPromise);
      await cleanupPromise;
      return true;
    })().finally(() => {
      releasePromises.delete(accountId);
    });

    releasePromises.set(accountId, releasePromise);

    return releasePromise;
  };

  return {
    waitForAccountTurn,
    releaseAccountTurnIfIdle,
    getActiveAccountId: () => Array.from(activeAccountIds)[0] ?? null,
    getActiveAccountIds: () => Array.from(activeAccountIds),
  };
};
