import type { Page } from 'playwright';
import { SELECTORS } from '../constants/selectors';
import { getBrowser } from '../lib/playwright';
import { checkRateLimit, getSession, saveSession } from './session.service';
import { logger } from '../lib/logger';

const log = logger.child({ scope: 'Login' });

const AUTH_COOKIE_NAMES = ['NID_AUT', 'NID_SES'];

const setInputValue = async (page: Page, selector: string, text: string): Promise<void> => {
  await page.waitForSelector(selector, { timeout: 10000 });
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
};

const getLoginError = async (page: Page): Promise<string | null> => {
  const selectors = ['.error_message', '#err_common'];
  for (const selector of selectors) {
    const el = await page.$(selector);
    if (!el) continue;
    const text = (await el.textContent())?.replace(/\s+/g, ' ').trim();
    if (text) {
      return text;
    }
  }
  return null;
};

const hasCaptcha = async (page: Page): Promise<boolean> => {
  const selectors = [SELECTORS.login.captcha];
  for (const selector of selectors) {
    const el = await page.$(selector);
    if (el) return true;
  }
  return false;
};

const hasTwoFactor = async (page: Page): Promise<boolean> => {
  const selectors = ['#new_device_confirm', '.sp_ti_login'];
  for (const selector of selectors) {
    const el = await page.$(selector);
    if (el) return true;
  }
  return false;
};

export const naverLogin = async (
  id: string,
  password: string
): Promise<{ cookies: unknown[]; success: boolean; message: string }> => {
  const maskedAccount = `${id.slice(0, 3)}***`;
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    const url = 'https://nid.naver.com/nidlogin.login';
    log.info('navigate', { account: maskedAccount, url });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    if (await hasCaptcha(page)) {
      log.warn('captcha.detected', { account: maskedAccount, stage: 'before' });
      return { cookies: [], success: false, message: '캡차 필요' };
    }

    log.info('credentials.enter', { account: maskedAccount });
    await setInputValue(page, SELECTORS.login.id, id);
    await page.waitForTimeout(300);
    await setInputValue(page, SELECTORS.login.pw, password);
    await page.waitForTimeout(500);

    log.info('submit', { account: maskedAccount });
    await page.click(SELECTORS.login.btn);

    log.info('result.wait', { account: maskedAccount });
    try {
      await page.waitForURL((url) => !url.href.includes('nid.naver.com/nidlogin'), { timeout: 10000 });
    } catch {
      // timeout
    }

    await page.waitForTimeout(2000);

    const errorMessage = await getLoginError(page);
    if (errorMessage) {
      log.warn('error', { account: maskedAccount, message: errorMessage });
      return { cookies: [], success: false, message: `로그인 실패: ${errorMessage}` };
    }

    if (await hasTwoFactor(page)) {
      log.warn('twofactor.required', { account: maskedAccount });
      return { cookies: [], success: false, message: '2차 인증이 필요합니다.' };
    }

    const cookies = await context.cookies();
    const cookieNames = new Set(
      cookies.map((cookie) => cookie.name).filter((name): name is string => Boolean(name))
    );
    const hasRequiredCookies = AUTH_COOKIE_NAMES.every((name) => cookieNames.has(name));

    if (!hasRequiredCookies && page.url().includes('nid.naver.com')) {
      log.warn('page.still_login', { account: maskedAccount, url: page.url() });
      return { cookies: [], success: false, message: '로그인이 완료되지 않았습니다.' };
    }

    log.info('success', { account: maskedAccount, cookies: cookies.length });
    return { cookies, success: true, message: 'Login success' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    log.error('failed', { account: maskedAccount, message });
    return { cookies: [], success: false, message };
  } finally {
    await context.close();
  }
};

export const getValidCookies = async (
  accountId: string,
  password: string
): Promise<{ cookies: unknown[]; fromCache: boolean }> => {
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
};
