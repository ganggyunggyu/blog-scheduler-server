import 'dotenv/config';
import { readFile } from 'fs/promises';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { createSession } from '../src/lib/naver-editor/browser.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp';

const main = async (): Promise<void> => {
  const planPath = process.argv[2];
  const onlyAccount = process.argv[3];
  const plan = JSON.parse(await readFile(planPath, 'utf8')) as {
    accounts: Array<{ accountId: string; password: string; region: string }>;
  };
  const targets = onlyAccount
    ? plan.accounts.filter((account) => account.accountId === onlyAccount)
    : plan.accounts;

  for (const account of targets) {
    console.log(`\n=== ${account.accountId} ===`);
    const { cookies } = await getValidCookies(account.accountId, account.password);
    const session = await createSession(cookies as unknown[], account.accountId);
    const { page } = session;

    await page.goto(`https://blog.naver.com/${account.accountId}?Redirect=Write&`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(8000);

    console.log('  url:', page.url());
    console.log('  frames:', page.frames().map((frame) => frame.name() || frame.url().slice(0, 70)).join(' | '));

    for (const frame of page.frames()) {
      const text = await frame
        .evaluate(() => document.body?.textContent?.replace(/\s+/g, ' ').slice(0, 300) ?? '')
        .catch(() => '');
      if (text.trim()) {
        console.log(`  [${frame.name() || 'main'}] ${text}`);
      }
    }

    await page
      .screenshot({ path: `${SHOT_DIR}/probe-${account.accountId}.png`, fullPage: true })
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
