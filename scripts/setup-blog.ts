import 'dotenv/config';
import mongoose from 'mongoose';
import type { Page } from 'playwright';
import { findAccountById } from '../src/services/account-directory.service.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { createSession } from '../src/lib/naver-editor/browser.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

const DOMAIN = process.env.BLOG_DOMAIN ?? 'sosoharu';
const NICKNAME = process.env.BLOG_NICK ?? '송민';
const BLOGNAME = process.env.BLOG_NAME ?? '소소한 하루';
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp';

const shot = async (page: Page, name: string): Promise<void> => {
  await page.screenshot({ path: `${SHOT_DIR}/setup-${name}.png`, fullPage: false }).catch(() => undefined);
};

const bodyText = async (page: Page, max = 500): Promise<string> =>
  page.evaluate((m) => document.body.textContent?.replace(/\s+/g, ' ').slice(0, m) ?? '', max);

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI required');
  await mongoose.connect(process.env.MONGO_URI);

  const account = await findAccountById(process.argv[2] ?? '채송민1');
  if (!account?.id || !account.password) throw new Error('account resolve 실패');

  const { cookies } = await getValidCookies(account.id, account.password);
  const session = await createSession(cookies as unknown[], account.id);
  const { page } = session;

  await page.goto('https://section.blog.naver.com/BlogHome.naver', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // 1) 블로그 아이디 만들기 → 개설 레이어
  await page.getByText('블로그 아이디 만들기', { exact: false }).first().click({ timeout: 6000 });
  await page.waitForSelector('#domainInput', { state: 'visible', timeout: 12000 });
  await shot(page, 'a-open');

  // 2) 블로그 주소: 후보 순차 시도 → 사용가능한 첫 번째 선택 + 확인
  const candidates = (process.env.BLOG_DOMAINS ?? DOMAIN).split(',').map((c) => c.trim()).filter(Boolean);
  let chosen = '';
  for (const cand of candidates) {
    await page.click('#domainInput');
    await page.fill('#domainInput', '');
    await page.type('#domainInput', cand, { delay: 90 });
    await page.waitForTimeout(1800);
    const unavailable = await page.evaluate(() => (document.body.textContent ?? '').includes('사용할 수 없'));
    console.log(`[domain-try] ${cand} unavailable=${unavailable}`);
    if (!unavailable) { chosen = cand; break; }
  }
  if (!chosen) throw new Error('사용가능한 블로그 주소 후보가 없음');
  console.log('[domain-chosen]', chosen);
  await shot(page, 'b1-typed');
  await page.click('#domainRegisterBtn', { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await shot(page, 'b2-dialog');
  // "이 아이디로 블로그를 만들까요?" 확인 다이얼로그 → 확인
  await page.getByText('블로그를 만들까요', { exact: false }).waitFor({ timeout: 5000 }).catch(() => undefined);
  await page.getByRole('button', { name: '확인', exact: true }).last().click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  await shot(page, 'b3-domain-done');
  console.log('[domain-confirmed]', chosen);

  // 3) 별명 / 블로그명 / 테마 (같은 화면 또는 전환)
  await page.waitForSelector('#nickname', { state: 'visible', timeout: 12000 }).catch(() => undefined);
  await page.fill('#nickname', NICKNAME).catch(() => undefined);
  await page.fill('#blogname', BLOGNAME).catch(() => undefined);
  await page.waitForTimeout(500);
  await page.check('#theme1').catch(async () => { await page.click('#theme1').catch(() => undefined); });
  await shot(page, 'c-info');
  console.log('[info] nickname/blogname/theme set');

  // 4) 다음
  await page.click('#submitBlogBasicInfo').catch(() => undefined);
  await page.waitForTimeout(3000);
  await shot(page, 'd-basic-next');
  console.log('[after-basic]', await bodyText(page, 300));

  // 5) 관심주제 - 나중에 할게요 우선
  const skipped = await page.getByText('나중에 할게요', { exact: false }).first().click({ timeout: 3000 }).then(() => true).catch(() => false);
  if (!skipped) {
    await page.click('#personalThemeSubmitBtn').catch(() => undefined);
  }
  await page.waitForTimeout(2500);
  await shot(page, 'e-theme');
  console.log('[theme] skip=' + skipped);

  // 6) 블로그 시작하기
  await page.getByText('블로그 시작하기', { exact: false }).first().click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  await shot(page, 'f-start');

  // 7) 완료 확인
  await page.goto(`https://blog.naver.com/${chosen}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  console.log('[final-url]', page.url());
  console.log('[final]', await bodyText(page, 250));
  await shot(page, 'g-done');

  // 8) 글쓰기 진입 재확인
  await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  console.log('[write-url]', page.url());
  console.log('[write-frames]', page.frames().map((f) => f.name() || '(noname)').join(', '));
  await shot(page, 'h-write');

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
