import 'dotenv/config';
import mongoose from 'mongoose';
import type { Cookie } from 'playwright';
import { findAccountById } from '../src/services/account-directory.service.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { getBrowser, closeBrowser } from '../src/lib/browser/playwright.js';
import { getMainFrame } from '../src/lib/naver-editor/frame.js';

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI required');
  await mongoose.connect(process.env.MONGO_URI);

  const account = await findAccountById(process.argv[2] ?? '채송민1');
  if (!account?.id || !account.password) throw new Error('account resolve 실패');

  const { cookies, fromCache } = await getValidCookies(account.id, account.password);
  console.log(`[login] ${account.id} fromCache=${fromCache} cookies=${(cookies as unknown[]).length}`);

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  });
  await context.addCookies(cookies as Cookie[]);
  const page = await context.newPage();

  await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const frame = await getMainFrame(page);

  // 팝업(작성중 글) 닫기 시도
  await frame.click('.se-popup-button-cancel, button.se-popup-button', { timeout: 2000 }).catch(() => undefined);
  await page.waitForTimeout(1000);

  // 본문 포커스 + 텍스트 입력 (툴바 활성화용)
  await frame.click('.se-content, [contenteditable="true"], .se-text-paragraph', { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  await page.keyboard.type('원주마사지 실측 테스트 문장입니다', { delay: 20 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(500);

  // 1) 툴바 전체 버튼 덤프
  const toolbarButtons = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('button[data-name]')).map((b) => ({
      name: b.getAttribute('data-name'),
      group: b.getAttribute('data-group'),
      title: b.getAttribute('title'),
      aria: b.getAttribute('aria-label'),
    })),
  );
  console.log('=== TOOLBAR_BUTTONS ===');
  console.log(JSON.stringify(toolbarButtons, null, 1));

  // 2) 인용구 관련 버튼 검색
  const quoteButtons = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map((b) => ({
      name: b.getAttribute('data-name'),
      title: b.getAttribute('title'),
      aria: b.getAttribute('aria-label'),
      cls: b.className,
    })).filter((x) => /quot|인용/i.test(`${x.name} ${x.title} ${x.aria} ${x.cls}`)),
  );
  console.log('=== QUOTE_BUTTONS ===');
  console.log(JSON.stringify(quoteButtons, null, 1));

  // 3) 글자색 버튼 클릭 → 색상 팔레트 덤프
  await frame.click('button[data-name="font-color"]', { timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  const palette = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('button.se-color-palette, [class*="color-palette"] button, button[class*="se-color"]')).map((b) => ({
      title: b.getAttribute('title'),
      value: b.getAttribute('data-value'),
      cls: b.className,
    })).slice(0, 40),
  );
  console.log('=== COLOR_PALETTE ===');
  console.log(JSON.stringify(palette, null, 1));

  await context.close();
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
