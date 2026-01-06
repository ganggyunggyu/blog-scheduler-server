import type { Page } from 'playwright';
import { SELECTORS } from '../constants/selectors';
import { getBrowser } from '../lib/playwright';
import { checkRateLimit, getSession, saveSession } from './session.service';
import { logger } from '../lib/logger';

async function pasteText(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await page.evaluate(
    ({ sel, value }) => {
      const input = document.querySelector(sel) as HTMLInputElement | null;
      if (input) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    { sel: selector, value: text }
  );
}

export async function naverLogin(
  id: string,
  password: string
): Promise<{ cookies: unknown[]; success: boolean; message: string }> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await pasteText(page, SELECTORS.login.id, id);
    await page.waitForTimeout(300);
    await pasteText(page, SELECTORS.login.pw, password);
    await page.waitForTimeout(500);

    await page.click(SELECTORS.login.btn);

    const captcha = await page.$(SELECTORS.login.captcha);
    if (captcha) {
      logger.warn('Captcha detected for account:', id.slice(0, 3) + '***');
      return { cookies: [], success: false, message: '캡차 필요' };
    }

    await page.waitForURL('https://www.naver.com/', { timeout: 30000 });

    const cookies = await context.cookies();
    logger.info('Login success:', id.slice(0, 3) + '***');

    return { cookies, success: true, message: 'Login success' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    logger.error('Login failed:', id.slice(0, 3) + '***', message);
    return { cookies: [], success: false, message };
  } finally {
    await context.close();
  }
}

export async function getValidCookies(
  accountId: string,
  password: string
): Promise<{ cookies: unknown[]; fromCache: boolean }> {
  const cached = await getSession(accountId);
  if (cached) {
    return { cookies: cached, fromCache: true };
  }

  const canLogin = await checkRateLimit(accountId);
  if (!canLogin) {
    throw new Error('Login rate limit exceeded. Please retry later.');
  }

  const result = await naverLogin(accountId, password);
  if (!result.success) {
    throw new Error(result.message);
  }

  await saveSession(accountId, result.cookies);

  return { cookies: result.cookies, fromCache: false };
}
