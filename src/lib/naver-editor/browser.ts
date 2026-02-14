import { getBrowser } from '../browser/playwright.js';
import type { BrowserSession } from './types.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const createSession = async (cookies: unknown[]): Promise<BrowserSession> => {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addCookies(cookies as any[]);
  const page = await context.newPage();
  return { context, page };
};

export const closeSession = async (session: BrowserSession): Promise<void> => {
  await session.context.close();
};
