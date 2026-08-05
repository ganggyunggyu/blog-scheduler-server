import { GoogleGenAI } from '@google/genai';
import type { Page } from 'playwright';
import { env } from '../config/env.js';
import { SELECTORS } from '../constants/selectors.js';
import { logger } from '../lib/logging/logger.js';

const log = logger.child({ scope: 'Captcha' });

/**
 * 쓸 모델 이름.
 *
 * gemini-2.5-flash 로 박아뒀다가, 구글이 신규 프로젝트에 그 버전을 닫으면서
 * 404 로 통째로 죽었다. 키를 바꿔도 안 풀렸고 재배포해야만 고칠 수 있었다.
 * 기본값을 버전 없는 별칭으로 두고, 그마저 막히면 배포 없이 갈아끼우게 환경변수로 받는다.
 */
const DEFAULT_MODEL = 'gemini-flash-latest';

export const resolveCaptchaModel = (source: { CAPTCHA_MODEL?: string }): string =>
  source.CAPTCHA_MODEL?.trim() || DEFAULT_MODEL;

const MODEL = resolveCaptchaModel({ CAPTCHA_MODEL: process.env.CAPTCHA_MODEL });
const MAX_ATTEMPTS = 3;
const CAPTCHA_INPUT_DELAY_MS = 200;
const PW_INPUT_DELAY_MS = 150;
const LOGIN_CLICK_WAIT_MS = 3000;

let geminiClient: GoogleGenAI | null = null;

const clickVisibleLoginButton = async (page: Page): Promise<void> => {
  const button = page.locator(SELECTORS.login.btn).filter({ visible: true }).first();
  await button.click();
};

const getGeminiClient = (): GoogleGenAI => {
  if (geminiClient) return geminiClient;
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  geminiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return geminiClient;
};

const safeEvaluate = async <T>(page: Page, fn: () => T, fallback: T): Promise<T> => {
  return page.evaluate(fn).catch(() => fallback);
};

const solveCaptchaWithAI = async (imageBase64: string, question: string): Promise<string> => {
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          {
            text: `이 이미지는 네이버 로그인 캡차로 나오는 가상 영수증 이미지야.
질문: "${question}"
답만 정확히 적어. 숫자면 숫자만, 물건 이름이면 이름만. 다른 말 하지마.`,
          },
        ],
      },
    ],
  });

  const answer = response.text?.trim() ?? '';
  log.info('ai.answer', { question, answer });
  return answer;
};

export const detectCaptcha = async (page: Page): Promise<{
  detected: boolean;
  base64?: string;
  question?: string;
  captchaType?: string;
}> => {
  const captchaType = await safeEvaluate(page, () => {
    const el = document.getElementById('captcha_type') as HTMLInputElement | null;
    return el?.value || '';
  }, '');

  if (!captchaType) return { detected: false };

  const base64 = await safeEvaluate(page, () => {
    const img = document.getElementById('captchaimg') as HTMLImageElement | null;
    if (!img?.src) return '';
    const match = img.src.match(/base64,(.+)/);
    return match?.[1] || '';
  }, '');

  if (!base64) return { detected: false };

  const question = await safeEvaluate(page, () => {
    const el = document.getElementById('captcha_info');
    return el?.textContent?.trim() || '';
  }, '');

  return { detected: true, base64, question, captchaType };
};

export const attemptCaptchaSolve = async (page: Page, password?: string): Promise<boolean> => {
  if (!env.GEMINI_API_KEY) {
    log.error('gemini-key-missing');
    return false;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const captcha = await detectCaptcha(page);

      if (!captcha.detected) {
        log.info('no-captcha-found', { attempt });
        return true;
      }

      log.info('attempt.start', { attempt, max: MAX_ATTEMPTS, type: captcha.captchaType, question: captcha.question });

      const answer = await solveCaptchaWithAI(captcha.base64!, captcha.question!);

      if (!answer) {
        log.warn('answer.empty', { attempt });
        continue;
      }

      // 캡차 답 입력
      await page.fill('#captcha', answer);
      await page.waitForTimeout(CAPTCHA_INPUT_DELAY_MS);

      // 구형 통합 화면(캡차+비번이 같은 화면)이면 비번도 채움
      if (password && (await page.$('#pw'))) {
        log.info('pw.refill', { attempt, phase: 'captcha' });
        await page.fill('#pw', password);
        await page.waitForTimeout(PW_INPUT_DELAY_MS);
      }

      // 캡차 확인 버튼 클릭
      log.info('captcha.submit', { answer, attempt });
      await clickVisibleLoginButton(page);
      await page.waitForTimeout(LOGIN_CLICK_WAIT_MS);

      // 신형 흐름: 캡차 통과 후 로그인 폼으로 복귀하며 비번이 비워짐
      // → 비번을 다시 채우고 로그인 버튼을 재클릭해야 최종 로그인됨
      if (password && page.url().includes('nidlogin')) {
        const captchaGone = !(await detectCaptcha(page)).detected;
        const hasPwField = Boolean(await page.$('#pw'));
        if (captchaGone && hasPwField) {
          log.info('relogin.after-captcha', { attempt });
          await page.fill('#pw', password);
          await page.waitForTimeout(PW_INPUT_DELAY_MS);
          await clickVisibleLoginButton(page);
          await page.waitForTimeout(LOGIN_CLICK_WAIT_MS);
        }
      }

      // 로그인 페이지를 벗어났으면 성공
      if (!page.url().includes('nidlogin')) {
        log.info('solved', { attempt });
        return true;
      }

      // 여전히 로그인 페이지 → 캡차 재출현/실패, 다음 attempt 에서 재감지
      log.warn('attempt.failed', { attempt });
    } catch (error) {
      log.error('attempt.error', {
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
  }

  log.error('all-attempts-failed', { maxAttempts: MAX_ATTEMPTS });
  return false;
};
