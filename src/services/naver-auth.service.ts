import type { Page } from 'playwright';
import { SELECTORS } from '../constants/selectors';
import { getBrowser } from '../lib/playwright';
import { checkRateLimit, getSession, saveSession } from './session.service';
import { logger } from '../lib/logger';

const log = logger.child({ scope: 'Login' });

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
  const maskedAccount = `${id.slice(0, 3)}***`;
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    const url = 'https://nid.naver.com/nidlogin.login';
    log.info('navigate', { account: maskedAccount, url });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // 캡챠 먼저 확인 (로그인 시도 전)
    const captchaBefore = await page.$(SELECTORS.login.captcha);
    if (captchaBefore) {
      log.warn('captcha.detected', { account: maskedAccount, stage: 'before' });
      return { cookies: [], success: false, message: '캡차 필요' };
    }

    log.info('credentials.enter', { account: maskedAccount });
    await pasteText(page, SELECTORS.login.id, id);
    await page.waitForTimeout(300);
    await pasteText(page, SELECTORS.login.pw, password);
    await page.waitForTimeout(500);

    log.info('submit', { account: maskedAccount });
    await page.click(SELECTORS.login.btn);

    // 로그인 결과 대기: 성공(naver.com) 또는 에러 메시지
    log.info('result.wait', { account: maskedAccount });
    try {
      await Promise.race([
        page.waitForURL((url) => !url.href.includes('nid.naver.com/nidlogin'), { timeout: 15000 }),
        page.waitForSelector('#err_common, .error_message, #captcha', { timeout: 15000 }),
      ]);
    } catch {
      // 타임아웃 시 현재 상태로 진행
    }

    await page.waitForTimeout(1000);

    // 아직 로그인 페이지면 에러 확인
    if (page.url().includes('nid.naver.com')) {
      const errorEl = await page.$('#err_common, .error_message');
      if (errorEl) {
        const errorText = await errorEl.textContent();
        log.warn('error', { account: maskedAccount, message: errorText?.trim() ?? '로그인 실패' });
        return { cookies: [], success: false, message: errorText?.trim() || '로그인 실패' };
      }

      const captchaEl = await page.$('#captcha');
      if (captchaEl) {
        log.warn('captcha.required', { account: maskedAccount });
        return { cookies: [], success: false, message: '캡차 필요' };
      }

      log.warn('page.still_login', { account: maskedAccount });
      return { cookies: [], success: false, message: '로그인 실패 (페이지 이동 안됨)' };
    }

    const cookies = await context.cookies();
    log.info('success', { account: maskedAccount, cookies: cookies.length });

    return { cookies, success: true, message: 'Login success' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    log.error('failed', { account: maskedAccount, message });
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
