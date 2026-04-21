import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import type { Page } from 'playwright';
import { env } from '../config/env.js';
import { SELECTORS } from '../constants/selectors.js';
import { getBrowser } from '../lib/browser/playwright.js';
import { checkRateLimit, getSession, saveSession } from './session.service.js';
import { logger } from '../lib/logging/logger.js';
import { attemptCaptchaSolve } from './captcha-solver.service.js';
import { inferLoginFailureMessage } from './login-failure.service.js';

const log = logger.child({ scope: 'Login' });

const AUTH_COOKIE_NAMES = ['NID_AUT', 'NID_SES'];
const LOGIN_DEBUG_DIR = path.join(process.cwd(), 'data', 'login-failures');

const buildArtifactBaseName = (id: string): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${timestamp}_${safeId}`;
};

const saveLoginFailureArtifacts = async (
  page: Page,
  id: string,
  message: string
): Promise<void> => {
  const artifactBaseName = buildArtifactBaseName(id);
  const screenshotPath = path.join(LOGIN_DEBUG_DIR, `${artifactBaseName}.png`);
  const htmlPath = path.join(LOGIN_DEBUG_DIR, `${artifactBaseName}.html`);
  const metaPath = path.join(LOGIN_DEBUG_DIR, `${artifactBaseName}.json`);

  try {
    await mkdir(LOGIN_DEBUG_DIR, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const [html, url] = await Promise.all([
      page.content(),
      Promise.resolve(page.url()),
    ]);

    await Promise.all([
      writeFile(htmlPath, html, 'utf8'),
      writeFile(
        metaPath,
        JSON.stringify(
          {
            accountId: id,
            message,
            url,
            capturedAt: new Date().toISOString(),
            screenshotPath,
            htmlPath,
          },
          null,
          2
        ),
        'utf8'
      ),
    ]);

    log.warn('failure.artifacts.saved', {
      account: `${id.slice(0, 3)}***`,
      htmlPath,
      metaPath,
      screenshotPath,
    });
  } catch (error) {
    log.error('failure.artifacts.failed', {
      account: `${id.slice(0, 3)}***`,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

const fillInput = async (page: Page, selector: string, text: string): Promise<void> => {
  await page.waitForSelector(selector, { timeout: env.PLAYWRIGHT_ACTION_TIMEOUT_MS });
  await page.fill(selector, text);
};

const isNavigationRaceError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return error.message.includes('Execution context was destroyed')
    || error.message.includes('Cannot find context with specified id');
};

const withNavigationRetry = async <T>(
  page: Page,
  callback: () => Promise<T>,
  fallback: T
): Promise<T> => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await callback();
    } catch (error) {
      if (!isNavigationRaceError(error)) throw error;
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }

  return fallback;
};

const getLoginError = async (page: Page): Promise<string | null> => {
  return withNavigationRetry(page, async () => {
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
  }, null);
};

const getLoginPageText = async (page: Page): Promise<string | null> => {
  return withNavigationRetry(page, async () => {
    const body = await page.textContent('body');
    const normalized = body?.replace(/\s+/g, ' ').trim();
    return normalized || null;
  }, null);
};

const hasCaptcha = async (page: Page): Promise<boolean> => {
  return withNavigationRetry(page, async () => {
    const selectors = [
      SELECTORS.login.captcha,
      '.captcha_wrap',
      '#rcapt',
      '#chptchakey',
      '#captcha_type',
      '#captchaimg',
    ];
    for (const selector of selectors) {
      const el = await page.$(selector);
      if (el) {
        const isVisible = selector === '#chptchakey' || selector === '#captcha_type'
          ? true
          : await el.isVisible().catch(() => false);
        if (isVisible) return true;
      }
    }
    return false;
  }, false);
};

const hasTwoFactor = async (page: Page): Promise<boolean> => {
  return withNavigationRetry(page, async () => {
    const selectors = ['#new_device_confirm', '.sp_ti_login'];
    for (const selector of selectors) {
      const el = await page.$(selector);
      if (el) return true;
    }
    return false;
  }, false);
};

export const naverLogin = async (
  id: string,
  password: string
): Promise<{ cookies: unknown[]; success: boolean; message: string }> => {
  const maskedAccount = `${id.slice(0, 3)}***`;
  const browser = await getBrowser();

  const useFingerprint = process.env.FINGERPRINT_ENABLED === 'true';
  let contextOptions: Parameters<typeof browser.newContext>[0] = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  };

  if (useFingerprint) {
    const { getProfileForAccount } = await import('../lib/fingerprint/index.js');
    const profile = getProfileForAccount(id);
    contextOptions = {
      userAgent: profile.userAgent,
      viewport: profile.viewport,
      deviceScaleFactor: profile.deviceScaleFactor,
      locale: profile.locale,
      timezoneId: profile.timezoneId,
      colorScheme: profile.colorScheme,
    };
  }

  const context = await browser.newContext(contextOptions);

  if (useFingerprint) {
    const { getProfileForAccount, applyStealth } = await import('../lib/fingerprint/index.js');
    await applyStealth(context, getProfileForAccount(id));
  }

  context.setDefaultTimeout(env.PLAYWRIGHT_ACTION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS);
  const page = await context.newPage();
  page.setDefaultTimeout(env.PLAYWRIGHT_ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS);

  try {
    const url = 'https://nid.naver.com/nidlogin.login';
    log.info('navigate', { account: maskedAccount, url });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    if (await hasCaptcha(page)) {
      log.warn('captcha.detected', { account: maskedAccount, stage: 'before' });
      if (env.GEMINI_API_KEY) {
        await fillInput(page, SELECTORS.login.id, id);
        await page.waitForTimeout(300);
        await fillInput(page, SELECTORS.login.pw, password);
        await page.waitForTimeout(500);
        const solved = await attemptCaptchaSolve(page, password);
        if (!solved) {
          await saveLoginFailureArtifacts(page, id, '보안문자 자동 풀기 실패');
          return { cookies: [], success: false, message: '보안문자 자동 풀기 실패' };
        }
      } else {
        await saveLoginFailureArtifacts(page, id, '보안문자 입력 필요 (GEMINI_API_KEY 미설정)');
        return { cookies: [], success: false, message: '보안문자 입력 필요 (GEMINI_API_KEY 미설정)' };
      }
    } else {
      log.info('credentials.enter', { account: maskedAccount });
      await fillInput(page, SELECTORS.login.id, id);
      await page.waitForTimeout(300);
      await fillInput(page, SELECTORS.login.pw, password);
      await page.waitForTimeout(500);

      log.info('submit', { account: maskedAccount });
      await page.click(SELECTORS.login.btn);

      log.info('result.wait', { account: maskedAccount });
      try {
        await page.waitForURL(
          (url) => !url.href.includes('nid.naver.com/nidlogin'),
          { timeout: 15_000 }
        );
      } catch {
        // 캡챠 시 같은 URL로 리다이렉트되므로 15초면 충분
      }

      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      if (await hasCaptcha(page)) {
        log.warn('captcha.detected', { account: maskedAccount, stage: 'after-submit' });
        if (env.GEMINI_API_KEY) {
          const solved = await attemptCaptchaSolve(page, password);
          if (!solved) {
            await saveLoginFailureArtifacts(page, id, '보안문자 자동 풀기 실패');
            return { cookies: [], success: false, message: '보안문자 자동 풀기 실패' };
          }
        } else {
          await saveLoginFailureArtifacts(page, id, '보안문자 입력 필요 (GEMINI_API_KEY 미설정)');
          return { cookies: [], success: false, message: '보안문자 입력 필요 (GEMINI_API_KEY 미설정)' };
        }
      }
    }

    const [errorMessage, pageText] = await Promise.all([
      getLoginError(page),
      getLoginPageText(page),
    ]);

    if (errorMessage) {
      const resolvedMessage = inferLoginFailureMessage(errorMessage, pageText);
      log.warn('error', { account: maskedAccount, message: resolvedMessage });
      await saveLoginFailureArtifacts(page, id, resolvedMessage);
      return { cookies: [], success: false, message: resolvedMessage };
    }

    if (await hasTwoFactor(page)) {
      log.warn('twofactor.required', { account: maskedAccount });
      await saveLoginFailureArtifacts(page, id, '2차 인증이 필요합니다.');
      return { cookies: [], success: false, message: '2차 인증이 필요합니다.' };
    }

    const cookies = await context.cookies();
    const cookieNames = new Set(
      cookies.map((cookie) => cookie.name).filter((name): name is string => Boolean(name))
    );
    const hasRequiredCookies = AUTH_COOKIE_NAMES.every((name) => cookieNames.has(name));

    if (!hasRequiredCookies && page.url().includes('nid.naver.com')) {
      const resolvedMessage = inferLoginFailureMessage(null, pageText);
      log.warn('page.still_login', { account: maskedAccount, url: page.url(), message: resolvedMessage });
      await saveLoginFailureArtifacts(page, id, resolvedMessage);
      return { cookies: [], success: false, message: resolvedMessage };
    }

    log.info('success', { account: maskedAccount, cookies: cookies.length });
    return { cookies, success: true, message: 'Login success' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    log.error('failed', { account: maskedAccount, message });
    await saveLoginFailureArtifacts(page, id, message);
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
