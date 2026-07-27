import 'dotenv/config';
import mongoose from 'mongoose';
import { findAccountById } from '../src/services/account-directory.service.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { createSession } from '../src/lib/naver-editor/browser.js';
import { getMainFrame } from '../src/lib/naver-editor/frame.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp';

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI required');
  await mongoose.connect(process.env.MONGO_URI);

  const account = await findAccountById('채송민1');
  if (!account?.id || !account.password) throw new Error('account resolve 실패');
  const { cookies, fromCache } = await getValidCookies(account.id, account.password);
  console.log('[login]', account.id, 'fromCache=' + fromCache);

  const session = await createSession(cookies as unknown[], account.id);
  const { page } = session;

  // 1) 블로그 홈 — 발행글 목록
  await page.goto('https://blog.naver.com/sosoharu2026', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const homeText = await page.evaluate(() => document.body.textContent?.replace(/\s+/g, ' ').slice(0, 400) ?? '');
  console.log('[home]', homeText);
  await page.screenshot({ path: `${SHOT_DIR}/verify-home.png`, fullPage: true }).catch(() => undefined);

  // 2) 글쓰기 진입 — 예약 발행 N건 확인
  await page.goto('https://blog.naver.com/sosoharu2026?Redirect=Write&', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const frame = await getMainFrame(page).catch(() => null);
  if (frame) {
    await frame.click('.se-popup-button-cancel', { timeout: 2000 }).catch(() => undefined);
    const scheduled = await frame.evaluate(() => {
      const m = document.body.textContent?.match(/예약[^\d]{0,6}(\d+)\s*건/);
      return m ? m[0] : '예약발행 표시 없음';
    });
    console.log('[scheduled]', scheduled);
  } else {
    console.log('[write] mainFrame 없음(글쓰기 진입 실패)');
  }
  console.log('[write-url]', page.url());
  await page.screenshot({ path: `${SHOT_DIR}/verify-write.png`, fullPage: true }).catch(() => undefined);

  await session.context.close();
  await closeBrowser();
  await mongoose.disconnect();
  console.log('[done]');
};

main().catch(async (error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  await closeBrowser().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
