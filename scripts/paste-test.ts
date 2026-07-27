import 'dotenv/config';
import mongoose from 'mongoose';
import { findAccountById } from '../src/services/account-directory.service.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { createSession } from '../src/lib/naver-editor/browser.js';
import { getMainFrame } from '../src/lib/naver-editor/frame.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const TEST_HTML = `<p>원주마사지 붙여넣기 테스트 문단입니다.</p>
<blockquote>원주마사지 선택의 첫 번째 기준은 목적과 시간이다.</blockquote>
<p>핵심 키워드는 <span style="color:#03c75a;">원주출장마사지</span>와 <span style="color:#ff5c33;">최소 60분</span> 코스입니다.</p>
<p>일반 문단이 이어집니다. 굵게 <b>강조</b>도 테스트합니다.</p>`;

const OUT = process.env.PASTE_SHOT ?? '/tmp/paste-test.png';

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI required');
  await mongoose.connect(process.env.MONGO_URI);

  const account = await findAccountById(process.argv[2] ?? '채송민1');
  if (!account?.id || !account.password) throw new Error('account resolve 실패');

  const { cookies, fromCache } = await getValidCookies(account.id, account.password);
  console.log(`[login] ${account.id} fromCache=${fromCache}`);

  const session = await createSession(cookies as unknown[], account.id);
  const { page } = session;

  await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);

  console.log('[url]', page.url());
  console.log('[frames]', page.frames().map((f) => f.name() || '(noname)').join(', '));
  await page.screenshot({ path: OUT.replace('.png', '-pre.png'), fullPage: true }).catch(() => undefined);

  const frame = await getMainFrame(page).catch(async (error) => {
    console.log('[frame.fail]', error instanceof Error ? error.message : String(error));
    return null;
  });
  if (!frame) {
    await session.context.close();
    await closeBrowser();
    await mongoose.disconnect();
    process.exit(2);
  }
  console.log('[frame] mainFrame OK');

  // 이전 작성 글 복구 팝업 취소
  await frame.click('button.se-popup-button-cancel, .se-popup-button-cancel', { timeout: 2500 }).catch(() => undefined);
  await page.waitForTimeout(1000);

  // 본문 영역 클릭 + 포커스
  await frame.click('.se-content, [contenteditable="true"]', { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(500);

  // 방법 1: paste 이벤트 직접 dispatch (headless 안전)
  const pasteResult = await frame.evaluate((html) => {
    const el = document.querySelector<HTMLElement>('[contenteditable="true"]');
    if (!el) return 'no-contenteditable';
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', html.replace(/<[^>]+>/g, ' '));
    const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    const ok = el.dispatchEvent(evt);
    return ok ? 'dispatched' : 'prevented(handled)';
  }, TEST_HTML);
  console.log('[paste.dispatch]', pasteResult);
  await page.waitForTimeout(2000);

  // 결과 확인
  const bodyHtml = await frame.evaluate(() => {
    const el = document.querySelector('.se-main-container, .se-content, [contenteditable="true"]');
    return el ? el.innerHTML : 'none';
  });
  const hasBlockquote = bodyHtml.includes('blockquote') || bodyHtml.includes('se-quotation') || bodyHtml.includes('인용');
  const hasColor = bodyHtml.includes('03c75a') || bodyHtml.includes('ff5c33') || bodyHtml.includes('color');
  console.log(`[check] blockquote=${hasBlockquote} color=${hasColor}`);
  console.log('[body-html-preview]', bodyHtml.slice(0, 1000));

  await page.screenshot({ path: OUT, fullPage: true });
  console.log('[shot]', OUT);

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
