import 'dotenv/config';
import { readFile } from 'fs/promises';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const main = async (): Promise<void> => {
  const planPath = process.argv[2];
  if (!planPath) {
    throw new Error('사용법: tsx scripts/_login-check.ts <plan.json>');
  }

  const plan = JSON.parse(await readFile(planPath, 'utf8')) as {
    accounts: Array<{ accountId: string; password: string; region: string }>;
  };

  for (const account of plan.accounts) {
    const started = Date.now();
    try {
      const auth = await getValidCookies(account.accountId, account.password);
      console.log(
        `${account.accountId}\tOK\tcached=${auth.fromCache}\t${Math.round((Date.now() - started) / 1000)}s\t${account.region}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${account.accountId}\tFAIL\t${message.split('\n')[0].slice(0, 120)}`);
    }
  }

  await closeBrowser().catch(() => undefined);
};

main().catch(async (error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  await closeBrowser().catch(() => undefined);
  process.exit(1);
});
