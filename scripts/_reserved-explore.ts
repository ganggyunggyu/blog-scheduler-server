import 'dotenv/config';
import { getSession } from '../src/services/session.service.js';
import { createSession } from '../src/lib/naver-editor/browser.js';
import { getMainFrame } from '../src/lib/naver-editor/frame.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp';

/**
 * 예약 발행 목록 레이어의 DOM 구조만 훑어봄.
 * 캐시된 세션이 없으면 그냥 종료함 - 여기서 새 로그인을 시도하지 않음.
 */
const main = async (): Promise<void> => {
  const accountId = process.argv[2];
  if (!accountId) throw new Error('사용법: tsx scripts/_reserved-explore.ts <계정ID>');

  const cookies = await getSession(accountId);
  if (!cookies) {
    console.log(`${accountId}: 캐시된 세션 없음 - 중단함`);
    return;
  }

  const session = await createSession(cookies, accountId);
  const { page } = session;

  await page.goto(`https://blog.naver.com/${accountId}?Redirect=Write&`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  const frame = await getMainFrame(page);
  await frame.click('.se-popup-button-cancel', { timeout: 2500 }).catch(() => undefined);
  await page.waitForTimeout(1200);

  const badge = await frame.evaluate(() => {
    const nodes = [...document.querySelectorAll('button, a, span, div')];
    const hit = nodes.find((node) => /예약\s*발행\s*\d+\s*건/.test(node.textContent ?? ''));
    if (!hit) return null;
    return { tag: hit.tagName, cls: hit.className, text: (hit.textContent ?? '').trim().slice(0, 40) };
  });
  console.log('[badge]', JSON.stringify(badge));

  const clicked = await frame
    .locator('text=/예약\\s*발행\\s*\\d+\\s*건/')
    .first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  console.log('[clicked]', clicked);
  await page.waitForTimeout(3000);

  const layer = await frame.evaluate(() => {
    const candidates = [...document.querySelectorAll('div,ul,section')].filter((node) => {
      const text = node.textContent ?? '';
      return /예약/.test(text) && text.length < 4000 && node.querySelectorAll('li,tr').length > 0;
    });
    const target = candidates[candidates.length - 1];
    if (!target) return null;
    return {
      cls: target.className,
      html: target.innerHTML.slice(0, 2500),
    };
  });
  console.log('[layer]', JSON.stringify(layer, null, 1));

  await page.screenshot({ path: `${SHOT_DIR}/reserved-layer-${accountId}.png`, fullPage: true }).catch(() => undefined);
  await session.context.close();
  await closeBrowser();
};

main().catch(async (error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  await closeBrowser().catch(() => undefined);
  process.exit(1);
});
