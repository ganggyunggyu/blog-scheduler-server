import 'dotenv/config';
import mongoose from 'mongoose';
import { readFile, mkdir } from 'fs/promises';
import type { Frame, Page } from 'playwright';
import { findAccountById } from '../src/services/account-directory.service.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { createSession } from '../src/lib/naver-editor/browser.js';
import { getMainFrame } from '../src/lib/naver-editor/frame.js';
import { clickTitleArea, clickContentArea } from '../src/lib/naver-editor/editor.js';
import { uploadImage } from '../src/lib/naver-editor/image.js';
import { openPublishDialog, setPublicVisibility, confirmPublish } from '../src/lib/naver-editor/publish.js';
import { setScheduleTime } from '../src/lib/naver-editor/schedule.js';
import { analyzeGeoArticle } from '../src/services/geo-optimizer.service.js';
import { downloadImagesToDir } from '../src/services/product-image.service.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const pasteHtml = async (page: Page, frame: Frame, html: string): Promise<string> => {
  await frame.click('.se-content, [contenteditable="true"]').catch(() => undefined);
  await page.waitForTimeout(500);
  const written = await page.evaluate(async (h) => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([h], { type: 'text/html' }),
          'text/plain': new Blob([h.replace(/<[^>]+>/g, ' ')], { type: 'text/plain' }),
        }),
      ]);
      return 'clipboard-ok';
    } catch (e) {
      return 'clip-fail:' + (e instanceof Error ? e.message : String(e)).slice(0, 70);
    }
  }, html);
  await page.keyboard.press('Meta+v');
  await page.waitForTimeout(2000);
  return written;
};

const main = async (): Promise<void> => {
  const identity = process.argv[2] ?? '채송민1';
  const respPath = process.argv[3];
  if (!respPath) throw new Error('gpt-with-image 응답 JSON 경로 필요 (argv[3])');
  const doPublish = process.env.DO_PUBLISH === 'true';
  const shotDir = process.env.SHOT_DIR ?? '/tmp';
  const postDate = process.env.POST_DATE;

  if (!process.env.MONGO_URI) throw new Error('MONGO_URI required');
  await mongoose.connect(process.env.MONGO_URI);

  const resp = JSON.parse(await readFile(respPath, 'utf8'));
  const images: Array<{ url: string }> = resp.images ?? [];
  // 마커는 그대로 두고(붙여넣기 후 위치 잡아 이미지 업로드), 남는 마커는 나중에 제거
  const articleHtml = String(resp.article_html);
  const markerCount = (articleHtml.match(/<div>이미지\d+\)<\/div>/g) ?? []).length;
  const title = (String(resp.content ?? '').split('\n')[0] || identity).trim();
  console.log('[article]', { title, htmlLen: articleHtml.length, images: images.length, markerCount });

  const keyword = process.env.GEO_KEYWORD ?? title.split(' ')[0];
  const geo = analyzeGeoArticle({ title, html: articleHtml, keyword });
  console.log('[geo]', `${geo.score}점 (${geo.grade})`, geo.signals.map((s) => `${s.key}=${s.passed ? 'O' : 'X'}`).join(' '));
  geo.suggestions.forEach((s) => console.log('[geo-todo]', s));

  // S3 이미지 로컬 다운로드
  const imagesDir = `${shotDir}/imgs`;
  await mkdir(imagesDir, { recursive: true });
  const localPaths = await downloadImagesToDir(
    images.map((im, i) => ({ url: im.url, filename: `img${i + 1}.png` })),
    imagesDir,
  );
  console.log('[images] downloaded', localPaths.length);

  const account = await findAccountById(identity);
  if (!account?.id || !account.password) throw new Error('account resolve 실패');
  const { cookies } = await getValidCookies(account.id, account.password);

  const session = await createSession(cookies as unknown[], account.id);
  const { page } = session;

  await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const frame = await getMainFrame(page);
  console.log('[frame] mainFrame OK');

  await frame.click('.se-popup-button-cancel, .se-popup-button', { timeout: 2500 }).catch(() => undefined);
  await page.waitForTimeout(1000);

  await clickTitleArea(frame);
  await page.waitForTimeout(500);
  await page.keyboard.type(title, { delay: 25 });
  await page.waitForTimeout(500);
  await clickContentArea(page, frame);
  await page.waitForTimeout(700);

  const pasteResult = await pasteHtml(page, frame, articleHtml);
  console.log('[paste]', pasteResult);

  for (const sel of ['button[aria-label="닫기"]', '.se-help-panel-close', '.se-sidebar-close-button']) {
    await frame.locator(sel).first().click({ timeout: 800 }).catch(() => undefined);
  }
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(1000);

  // 마커 위치에 이미지 업로드 (triple-click으로 마커 줄 선택 → 파일 업로드)
  for (let i = 0; i < localPaths.length; i += 1) {
    const marker = frame.getByText(`이미지${i + 1})`, { exact: false }).first();
    const found = await marker.count().catch(() => 0);
    if (!found) { console.log(`[img] marker 이미지${i + 1}) 못찾음`); continue; }
    await marker.click({ clickCount: 3 }).catch(() => undefined);
    await page.waitForTimeout(400);
    const ok = await uploadImage(page, frame, localPaths[i]).then(() => true).catch((e) => { console.log('[img-fail]', String(e).slice(0, 60)); return false; });
    console.log(`[img] 이미지${i + 1} 업로드=${ok}`);
    await page.waitForTimeout(1500);
  }
  // 남은 마커 텍스트 제거
  await frame.evaluate(() => {
    document.querySelectorAll('*').forEach((el) => {
      if (el.children.length === 0 && /^이미지\d+\)$/.test((el.textContent || '').trim())) {
        el.textContent = '';
      }
    });
  }).catch(() => undefined);

  await page.screenshot({ path: `${shotDir}/article-preview.png`, fullPage: true }).catch(() => undefined);

  if (doPublish) {
    await openPublishDialog(page, frame);
    await page.waitForTimeout(1500);
    await setPublicVisibility(page, frame).catch(() => undefined);
    await page.waitForTimeout(500);

    if (postDate) {
      await setScheduleTime(page, frame, new Date(postDate));
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${shotDir}/schedule-set.png` }).catch(() => undefined);
    }

    const postUrl = await confirmPublish(page, frame);
    console.log('[POST-URL]', postUrl);
    await page.screenshot({ path: `${shotDir}/after-publish.png`, fullPage: true }).catch(() => undefined);
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
