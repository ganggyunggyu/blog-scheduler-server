import 'dotenv/config';
import mongoose from 'mongoose';
import { findAccountById } from '../src/services/account-directory.service.js';
import { naverLogin } from '../src/services/naver-auth.service.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const maskId = (value: string): string =>
  value.length <= 3 ? `${value}***` : `${value.slice(0, 3)}***`;

const main = async (): Promise<void> => {
  const identity = process.argv[2] ?? '채송민1';

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const account = await findAccountById(identity);
  console.log('[resolve]', JSON.stringify({
    input: identity,
    id: account?.id ? maskId(account.id) : null,
    name: account?.name ?? null,
    blogId: account?.blogId ? maskId(account.blogId) : null,
    category: account?.category ?? '(none)',
    hasPassword: Boolean(account?.password),
  }));

  if (!account?.id || !account.password) {
    console.log('[result] FAIL - 계정 또는 실행 비밀번호를 resolve 하지 못함');
    await mongoose.disconnect();
    process.exit(1);
  }

  const startedAt = Date.now();
  const result = await naverLogin(account.id, account.password);
  const elapsedMs = Date.now() - startedAt;

  console.log('[login]', JSON.stringify({
    success: result.success,
    message: result.message,
    cookies: Array.isArray(result.cookies) ? result.cookies.length : 0,
    elapsedMs,
  }));

  await closeBrowser();
  await mongoose.disconnect();
  process.exit(result.success ? 0 : 2);
};

main().catch(async (error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  await closeBrowser().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
