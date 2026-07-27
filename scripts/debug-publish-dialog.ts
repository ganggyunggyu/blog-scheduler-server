import 'dotenv/config';
import mongoose from 'mongoose';
import { findAccountById } from '../src/services/account-directory.service.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { createSession } from '../src/lib/naver-editor/browser.js';
import { getMainFrame } from '../src/lib/naver-editor/frame.js';
import { openPublishDialog } from '../src/lib/naver-editor/publish.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const shotDir = process.env.SHOT_DIR ?? '/tmp';

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI required');
  await mongoose.connect(process.env.MONGO_URI);

  const account = await findAccountById(process.argv[2] ?? '채송민1');
  if (!account?.id || !account.password) throw new Error('account resolve 실패');
  const { cookies } = await getValidCookies(account.id, account.password);

  const session = await createSession(cookies as unknown[], account.id);
  const { page } = session;

  await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const frame = await getMainFrame(page);
  await frame.click('.se-popup-button-cancel, .se-popup-button', { timeout: 2500 }).catch(() => undefined);
  await page.waitForTimeout(800);

  const panels = await frame.evaluate(() =>
    [...document.querySelectorAll('button, a')]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .filter((el) => /닫기|close/i.test(el.className + (el.getAttribute('aria-label') ?? '') + (el.textContent ?? '')))
      .map((el) => ({ tag: el.tagName, cls: el.className, label: el.getAttribute('aria-label') ?? '' })),
  );
  console.log('[close-candidates]', JSON.stringify(panels, null, 1));

  await openPublishDialog(page, frame);
  await page.waitForTimeout(2500);

  const buttons = await frame.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => ({
        text: (b.textContent ?? '').trim().slice(0, 24),
        cls: b.className,
        testid: b.getAttribute('data-testid') ?? '',
        area: b.getAttribute('data-click-area') ?? '',
      })),
  );
  console.log('[buttons]', JSON.stringify(buttons, null, 1));

  const radios = await frame.evaluate(() =>
    [...document.querySelectorAll('input[type=radio]')].map((r) => ({
      id: r.id,
      name: (r as HTMLInputElement).name,
      checked: (r as HTMLInputElement).checked,
    })),
  );
  console.log('[radios]', JSON.stringify(radios));

  await page.screenshot({ path: `${shotDir}/publish-dialog.png`, fullPage: true }).catch(() => undefined);

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
