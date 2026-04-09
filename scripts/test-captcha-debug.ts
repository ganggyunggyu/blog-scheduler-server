import { chromium } from 'playwright';
import { detectCaptcha, attemptCaptchaSolve } from '../src/services/captcha-solver.service.js';
import { env } from '../src/config/env.js';

const ACCOUNT_ID = 'akepzkthf12';
const ACCOUNT_PW = 'rkdrudrb123!';
const LOGIN_URL = 'https://nid.naver.com/nidlogin.login';

const main = async () => {
  console.log('[0] 환경: headless=%s, slowMo=%d, actionTimeout=%d, navTimeout=%d, GEMINI=%s',
    env.PLAYWRIGHT_HEADLESS, env.PLAYWRIGHT_SLOW_MO,
    env.PLAYWRIGHT_ACTION_TIMEOUT_MS, env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
    env.GEMINI_API_KEY ? 'set' : 'MISSING');

  const browser = await chromium.launch({
    headless: env.PLAYWRIGHT_HEADLESS,
    slowMo: env.PLAYWRIGHT_SLOW_MO,
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  });
  context.setDefaultTimeout(env.PLAYWRIGHT_ACTION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS);
  const page = await context.newPage();
  page.setDefaultTimeout(env.PLAYWRIGHT_ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS);

  try {
    console.log('[1] 로그인 페이지 이동');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // 캡챠 관련 DOM 전체 스캔
    const scanDom = async (label: string) => {
      const els = await page.evaluate(() => {
        const ids = ['captcha_type', 'captchaimg', 'captcha_info', 'captcha', 'chptchakey', 'rcapt'];
        const result: Record<string, any> = {};
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el) {
            result[id] = {
              tag: el.tagName,
              visible: (el as HTMLElement).offsetParent !== null,
              value: (el as HTMLInputElement).value || '',
              text: el.textContent?.trim().slice(0, 120) || '',
            };
          }
        }
        const wrap = document.querySelector('.captcha_wrap');
        if (wrap) result['captcha_wrap'] = { visible: (wrap as HTMLElement).offsetParent !== null };
        return result;
      });
      console.log(`[DOM ${label}]`, JSON.stringify(els, null, 2));
      return els;
    };

    // 캡챠 감지 (로그인 전)
    console.log('[2] 캡챠 감지 (로그인 전)');
    const preCaptcha = await detectCaptcha(page);
    console.log('  detected:', preCaptcha.detected, '| type:', preCaptcha.captchaType, '| question:', preCaptcha.question);
    await scanDom('before-login');

    if (preCaptcha.detected) {
      console.log('[3] 로그인 전 캡챠 발견 → ID/PW 입력 후 캡챠 풀기');
      await page.fill('#id', ACCOUNT_ID);
      await page.waitForTimeout(300);
      await page.fill('#pw', ACCOUNT_PW);
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'data/captcha-debug-before.png', fullPage: true });
      const solved = await attemptCaptchaSolve(page, ACCOUNT_PW);
      console.log('[4] 캡챠 풀기 결과:', solved);
    } else {
      console.log('[3] 캡챠 없음 → 일반 로그인');
      await page.fill('#id', ACCOUNT_ID);
      await page.waitForTimeout(300);
      await page.fill('#pw', ACCOUNT_PW);
      await page.waitForTimeout(500);

      await page.click(".btn_login, #log\\.login, button[type='submit']");

      try {
        await page.waitForURL(
          (url) => !url.href.includes('nid.naver.com/nidlogin'),
          { timeout: env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS },
        );
      } catch {
        console.log('  URL 변경 타임아웃');
      }

      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'data/captcha-debug-after-submit.png', fullPage: true });

      console.log('[4] 캡챠 감지 (로그인 후)');
      const postCaptcha = await detectCaptcha(page);
      console.log('  detected:', postCaptcha.detected, '| type:', postCaptcha.captchaType, '| question:', postCaptcha.question);
      await scanDom('after-login');

      if (postCaptcha.detected) {
        console.log('[5] 로그인 후 캡챠 → 풀기 시도');
        const solved = await attemptCaptchaSolve(page, ACCOUNT_PW);
        console.log('[6] 캡챠 풀기 결과:', solved);
      }
    }

    const finalUrl = page.url();
    console.log('\n[FINAL] URL:', finalUrl);
    console.log('[FINAL] 로그인 성공:', !finalUrl.includes('nidlogin'));
    await page.screenshot({ path: 'data/captcha-debug-final.png', fullPage: true });
  } catch (error) {
    console.error('\nERROR:', error instanceof Error ? error.message : error);
    console.error('Stack:', error instanceof Error ? error.stack : '');
    await page.screenshot({ path: 'data/captcha-debug-error.png', fullPage: true }).catch(() => {});
  } finally {
    await context.close();
    await browser.close();
  }
};

main();
