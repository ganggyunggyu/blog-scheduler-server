import { GoogleGenAI } from '@google/genai';
import type { Page } from 'playwright';
import { env } from '../config/env.js';
import { logger } from '../lib/logging/logger.js';

const log = logger.child({ scope: 'Captcha' });

const MODEL = 'gemini-2.5-flash';
const MAX_ATTEMPTS = 3;
const CAPTCHA_INPUT_DELAY_MS = 200;
const PW_INPUT_DELAY_MS = 150;
const LOGIN_CLICK_WAIT_MS = 3000;

const LOGIN_BTN_SELECTOR = ".btn_login, #log\\.login, button[type='submit']";

let geminiClient: GoogleGenAI | null = null;

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

      // 답 입력
      await page.fill('#captcha', answer);
      await page.waitForTimeout(CAPTCHA_INPUT_DELAY_MS);

      // 비밀번호 항상 재입력 (캡차 페이지에서 비워질 수 있음)
      if (password) {
        log.info('pw.refill', { attempt });
        await page.fill('#pw', password);
        await page.waitForTimeout(PW_INPUT_DELAY_MS);
      }

      log.info('submit', { answer, attempt });
      await page.click(LOGIN_BTN_SELECTOR);
      await page.waitForTimeout(LOGIN_CLICK_WAIT_MS);

      // 성공 확인
      if (!page.url().includes('nidlogin')) {
        log.info('solved', { attempt });
        return true;
      }

      // 캡차가 여전히 있는지 확인
      const stillHasCaptcha = await detectCaptcha(page);
      if (!stillHasCaptcha.detected) {
        log.info('solved', { attempt });
        return true;
      }

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
