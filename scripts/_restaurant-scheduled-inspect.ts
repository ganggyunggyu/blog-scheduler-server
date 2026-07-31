import 'dotenv/config';
import { readFile } from 'fs/promises';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { createSession } from '../src/lib/naver-editor/browser.js';
import { getMainFrame } from '../src/lib/naver-editor/frame.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp';

const main = async (): Promise<void> => {
  const planPath = process.argv[2];
  const onlyAccount = process.argv[3];
  if (!planPath) {
    throw new Error('사용법: tsx scripts/_restaurant-scheduled-inspect.ts <plan.json> [계정ID]');
  }

  const plan = JSON.parse(await readFile(planPath, 'utf8')) as {
    accounts: Array<{ accountId: string; password: string; region: string }>;
  };

  const targets = onlyAccount
    ? plan.accounts.filter((account) => account.accountId === onlyAccount)
    : plan.accounts;

  for (const account of targets) {
    console.log(`\n=== ${account.accountId} (${account.region}) ===`);
    const { cookies } = await getValidCookies(account.accountId, account.password);
    const session = await createSession(cookies as unknown[], account.accountId);
    const { page } = session;

    await page.goto(`https://blog.naver.com/${account.accountId}?Redirect=Write&`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(7000);

    const frame = await getMainFrame(page).catch(() => null);
    if (!frame) {
      console.log('  글쓰기 진입 실패');
      await session.context.close();
      continue;
    }

    await frame.click('.se-popup-button-cancel', { timeout: 2500 }).catch(() => undefined);
    await page.waitForTimeout(1000);

    const badge = await frame.evaluate(() => {
      const match = document.body.textContent?.match(/예약[^\d]{0,6}(\d+)\s*건/);
      return match ? match[0] : '없음';
    });
    console.log(`  예약 뱃지: ${badge}`);

    const opened = await frame
      .locator("text=/예약[^0-9]{0,6}\\d+\\s*건/")
      .first()
      .click({ timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(2500);

    if (opened) {
      const listText = await frame.evaluate(() => {
        const layer = document.querySelector('.se-popup-container, .se-layer, [class*="reserve"]');
        return (layer?.textContent ?? document.body.textContent ?? '').replace(/\s+/g, ' ').slice(0, 900);
      });
      console.log(`  예약 목록: ${listText}`);
    } else {
      console.log('  예약 목록 열기 실패');
    }

    await page
      .screenshot({ path: `${SHOT_DIR}/reserved-${account.accountId}.png`, fullPage: true })
      .catch(() => undefined);
    await session.context.close();
  }

  await closeBrowser();
};

main().catch(async (error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  await closeBrowser().catch(() => undefined);
  process.exit(1);
});
