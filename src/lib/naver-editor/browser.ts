import { getBrowser } from '../browser/playwright.js';
import { env } from '../../config/env.js';
import type { BrowserSession } from './types.js';
import { normalizeSessionCookies } from './cookies.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CLOSED_CONTEXT_ERROR_PATTERNS = [
  'Target page, context or browser has been closed',
  'Target closed',
  'Browser has been closed',
];

const isClosedContextError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return CLOSED_CONTEXT_ERROR_PATTERNS.some((pattern) => error.message.includes(pattern));
};

export const createSession = async (cookies: unknown[]): Promise<BrowserSession> => {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  context.setDefaultTimeout(env.PLAYWRIGHT_ACTION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS);
  await context.addCookies(normalizeSessionCookies(cookies));
  const page = await context.newPage();
  page.setDefaultTimeout(env.PLAYWRIGHT_ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS);
  return { context, page };
};

export const closeSession = async (session: BrowserSession): Promise<void> => {
  try {
    await session.context.close();
  } catch (error) {
    if (isClosedContextError(error)) {
      return;
    }
    throw error;
  }
};
