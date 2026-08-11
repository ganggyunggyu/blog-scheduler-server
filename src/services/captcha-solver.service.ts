import axios from 'axios';
import type { Page } from 'playwright';
import { SELECTORS } from '../constants/selectors.js';
import { logger } from '../lib/logging/logger.js';
import { resolveOwnerApiKey } from './dabut-app.service.js';

const log = logger.child({ scope: 'Captcha' });

/**
 * 캡차 풀이는 다붓 "21lab" 계정이 등록해둔 OpenAI 키로 gpt-5.6-luna 를 쓴다.
 *
 * 예전엔 서버 환경변수 GEMINI_API_KEY 로 고정해뒀는데, 그 구글 프로젝트가 선불
 * 크레딧 소진(RESOURCE_EXHAUSTED)으로 죽어서 캡차 자동풀기가 통째로 막혔다.
 * 계정별 키 체계로 옮기는 첫 단계로, 일단 스케쥴러가 관리하는 계정들의 소유주인
 * "21lab" 다붓 계정의 OpenAI 키를 매번 복호화해서 쓴다(요청마다 새로 읽어서
 * 다붓 쪽에서 키를 바꾸면 재배포 없이 바로 반영됨).
 */
const CAPTCHA_KEY_OWNER_ID = '6a6abf0bf86b1cbdd1afe1dd';

/**
 * 모델이 은퇴/장애로 죽으면 배포 없이 갈아끼울 수 있게 환경변수로도 받는다
 * (gemini-2.5-flash 가 신규 프로젝트에서 통째로 막혔던 전례가 있어서 그대로 유지함).
 */
const DEFAULT_CAPTCHA_MODEL = 'gpt-5.6-luna';

export const resolveCaptchaModel = (source: { CAPTCHA_MODEL?: string }): string =>
  source.CAPTCHA_MODEL?.trim() || DEFAULT_CAPTCHA_MODEL;

const CAPTCHA_MODEL = resolveCaptchaModel({ CAPTCHA_MODEL: process.env.CAPTCHA_MODEL });
const MAX_ATTEMPTS = 3;
const CAPTCHA_INPUT_DELAY_MS = 200;
const PW_INPUT_DELAY_MS = 150;
const LOGIN_CLICK_WAIT_MS = 3000;

const clickVisibleLoginButton = async (page: Page): Promise<void> => {
  const button = page.locator(SELECTORS.login.btn).filter({ visible: true }).first();
  await button.click();
};

const safeEvaluate = async <T>(page: Page, fn: () => T, fallback: T): Promise<T> => {
  return page.evaluate(fn).catch(() => fallback);
};

interface OpenAIResponsesOutputTextPart {
  type: string;
  text?: string;
}
interface OpenAIResponsesOutputItem {
  type: string;
  content?: OpenAIResponsesOutputTextPart[];
}
interface OpenAIResponsesResult {
  output_text?: string;
  output?: OpenAIResponsesOutputItem[];
}

const extractResponsesText = (data: OpenAIResponsesResult): string => {
  if (data.output_text) return data.output_text;

  const texts = (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text as string);

  return texts.join('').trim();
};

const solveCaptchaWithAI = async (imageBase64: string, question: string): Promise<string> => {
  const apiKey = await resolveOwnerApiKey(CAPTCHA_KEY_OWNER_ID, 'openai');
  if (!apiKey) {
    throw new Error('캡차 풀이용 OpenAI 키를 다붓 계정에서 찾지 못했습니다.');
  }

  const { data } = await axios.post<OpenAIResponsesResult>(
    'https://api.openai.com/v1/responses',
    {
      model: CAPTCHA_MODEL,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `이 이미지는 네이버 로그인 캡차로 나오는 가상 영수증 이미지야.
질문: "${question}"
답만 정확히 적어. 숫자면 숫자만, 물건 이름이면 이름만. 다른 말 하지마.`,
            },
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${imageBase64}`,
            },
          ],
        },
      ],
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 30000,
    },
  );

  const answer = extractResponsesText(data).trim();
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
