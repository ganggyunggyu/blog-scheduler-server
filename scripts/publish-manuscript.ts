import 'dotenv/config';
import mongoose from 'mongoose';
import { readFile } from 'fs/promises';
import type { Frame, Page } from 'playwright';
import { manuscriptToHtml } from './manuscript-to-html.js';
import { findAccountById } from '../src/services/account-directory.service.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { createSession } from '../src/lib/naver-editor/browser.js';
import { getMainFrame } from '../src/lib/naver-editor/frame.js';
import { clickTitleArea, clickContentArea, setAlignCenter } from '../src/lib/naver-editor/editor.js';
import { openPublishDialog, setPublicVisibility, confirmPublish } from '../src/lib/naver-editor/publish.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const pasteHtml = async (page: Page, frame: Frame, html: string): Promise<string> => {
  // 본문 포커스
  await frame.click('.se-content, [contenteditable="true"]').catch(() => undefined);
  await page.waitForTimeout(400);

  // 실제 클립보드에 HTML 주입 (createSession clipboard 권한)
  const written = await page.evaluate(async (h) => {
    try {
      const htmlBlob = new Blob([h], { type: 'text/html' });
      const textBlob = new Blob([h.replace(/<[^>]+>/g, ' ')], { type: 'text/plain' });
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })]);
      return 'clipboard-written';
    } catch (e) {
      return 'write-fail:' + (e instanceof Error ? e.message : String(e)).slice(0, 80);
    }
  }, html);

  // Ctrl+V 붙여넣기
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(500);
  return written;
};

const main = async (): Promise<void> => {
  const identity = process.argv[2] ?? '채송민1';
  const inPath = process.argv[3];
  if (!inPath) throw new Error('원고 파일 경로 필요 (argv[3])');
  const doPublish = process.env.DO_PUBLISH === 'true';
  const shotDir = process.env.SHOT_DIR ?? '/tmp';

  if (!process.env.MONGO_URI) throw new Error('MONGO_URI required');
  await mongoose.connect(process.env.MONGO_URI);

  const account = await findAccountById(identity);
  if (!account?.id || !account.password) throw new Error('account resolve 실패');

  const content = await readFile(inPath, 'utf8');
  const { title, html } = manuscriptToHtml(content);
  console.log('[manuscript]', { title, htmlLen: html.length });

  const { cookies } = await getValidCookies(account.id, account.password);
  const session = await createSession(cookies as unknown[], account.id);
  const { page } = session;

  await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  console.log('[url]', page.url());

  const frame = await getMainFrame(page);
  console.log('[frame] mainFrame OK');

  await frame.click('.se-popup-button-cancel, .se-popup-button', { timeout: 2500 }).catch(() => undefined);
  await page.waitForTimeout(1000);

  // 제목 입력
  await clickTitleArea(frame);
  await page.waitForTimeout(500);
  await page.keyboard.type(title, { delay: 25 });
  await page.waitForTimeout(500);
  await clickContentArea(page, frame);
  await page.waitForTimeout(700);

  // 본문 HTML 붙여넣기 (서식 반영)
  const pasteResult = await pasteHtml(page, frame, html);
  console.log('[paste]', pasteResult);
  await page.waitForTimeout(3000);

  const bodyHtml = await frame.evaluate(() => {
    const el = document.querySelector('.se-main-container, [contenteditable="true"]');
    return el ? el.innerHTML : 'none';
  });
  console.log('[check] quotation=' + (bodyHtml.includes('quotation') || bodyHtml.includes('blockquote')) + ' color=' + bodyHtml.includes('color') + ' len=' + bodyHtml.length);

  await page.screenshot({ path: `${shotDir}/publish-preview.png`, fullPage: true }).catch(() => undefined);
  console.log('[shot]', `${shotDir}/publish-preview.png`);

  if (doPublish) {
    await openPublishDialog(page, frame);
    await page.waitForTimeout(800);
    await setPublicVisibility(page, frame);
    await page.waitForTimeout(500);
    const postUrl = await confirmPublish(page, frame);
    console.log('[POST-URL]', postUrl);
  } else {
    console.log('[preview-only] 실제 발행하려면 DO_PUBLISH=true');
  }

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
