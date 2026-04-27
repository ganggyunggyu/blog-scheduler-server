import { closeBrowser } from '../lib/browser/playwright.js';
import { logger } from '../lib/logging/logger.js';
import { invalidateAllSessions } from './session.service.js';

const log = logger.child({ scope: 'BrowserCleaner' });

const maskAccountId = (accountId: string): string => `${accountId.slice(0, 3)}***`;

export interface BrowserCleanerResult {
  invalidatedSessions: number;
}

export const runBrowserCleaner = async (accountId: string): Promise<BrowserCleanerResult> => {
  const maskedAccount = maskAccountId(accountId);

  log.info('start', { account: maskedAccount });

  const invalidatedSessions = await invalidateAllSessions();
  await closeBrowser();

  log.info('done', { account: maskedAccount, invalidatedSessions });

  return { invalidatedSessions };
};
