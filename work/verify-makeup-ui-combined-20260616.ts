import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import { getSession } from '../src/services/session.service.js';
import { getValidCookies, naverLogin } from '../src/services/naver-auth.service.js';
import { normalizeSessionCookies } from '../src/lib/naver-editor/cookies.js';

interface PlanItem {
  keyword: string;
  scheduledAt: string;
}

interface PlanAccount {
  accountId: string;
  blogId: string;
  blogName: string;
  items: PlanItem[];
}

interface PlanShape {
  domains: Record<string, PlanAccount[]>;
}

interface Target extends PlanAccount {
  domain: string;
}

const args = process.argv.slice(2);
const getArg = (flag: string, fallback: string): string => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

const planPath = path.resolve(process.cwd(), getArg('--plan', 'work/makeup-schedule-2026-06-16-1781617159036.json'));
const outputDir = path.resolve(process.cwd(), 'data', 'verify-makeup-reservations-20260616');

const domainNames: Record<string, string> = {
  eye: '안과',
  pet: '애견',
  brand: '안과브랜드',
};

const getTextFromFrames = async (page: Page): Promise<string> => {
  const texts: string[] = [];
  for (const frame of page.frames()) {
    try {
      texts.push(await frame.locator('body').innerText({ timeout: 2000 }));
    } catch {
      // Ignore inaccessible frames.
    }
  }
  return texts.join('\n');
};

const closeOverlays = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape').catch(() => undefined);
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.click(viewport.width - 42, 42).catch(() => undefined);
  await page.waitForTimeout(1200);
};

const clickReserveCount = async (page: Page): Promise<void> => {
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.click(viewport.width - 229, 22);
};

const loadPasswords = async (accountIds: string[]): Promise<Map<string, string>> => {
  const rows = await mongoose.connection.useDb('cafe-bot')
    .collection('accounts')
    .find({ accountId: { $in: accountIds } }, { projection: { _id: 0, accountId: 1, password: 1 } })
    .toArray();
  const map = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.accountId === 'string' && typeof row.password === 'string' && row.password) {
      map.set(row.accountId, row.password);
    }
  }
  return map;
};

const getCookies = async (target: Target, passwords: Map<string, string>): Promise<unknown[]> => {
  const cached = await getSession(target.accountId);
  if (cached) return cached;

  const runtimePassword = target.accountId === 'adplan3th' ? process.env.NAVER_BRAND_PASSWORD : undefined;
  const password = runtimePassword ?? passwords.get(target.accountId);
  if (!password) throw new Error('no session or password');

  if (passwords.has(target.accountId)) {
    return (await getValidCookies(target.accountId, password)).cookies;
  }

  const login = await naverLogin(target.accountId, password);
  if (!login.success) throw new Error(login.message);
  return login.cookies;
};

const verifyTarget = async (
  browser: Browser,
  target: Target,
  passwords: Map<string, string>,
): Promise<Record<string, unknown>> => {
  let context: BrowserContext | null = null;
  const expectedKeywords = target.items.map((item) => item.keyword);
  const expectedTimes = target.items.map((item) => item.scheduledAt.slice(11, 16));

  try {
    context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addCookies(normalizeSessionCookies(await getCookies(target, passwords)));

    const postPage = await context.newPage();
    await postPage.goto(`https://blog.naver.com/PostList.naver?blogId=${target.blogId || target.accountId}&from=postList`, {
      waitUntil: 'domcontentloaded',
      timeout: env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
    });
    await postPage.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
    await postPage.waitForTimeout(3500);
    const postText = await getTextFromFrames(postPage);

    const writePage = await context.newPage();
    await writePage.goto(`https://blog.naver.com/${target.blogId || target.accountId}?Redirect=Write&`, {
      waitUntil: 'domcontentloaded',
      timeout: env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
    });
    await writePage.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
    await writePage.waitForTimeout(3500);
    await closeOverlays(writePage);
    let reserveText = await getTextFromFrames(writePage);
    const reserveButtonText = reserveText.match(/예약\s*발행\s*\d+\s*건/)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';
    if (reserveButtonText) {
      await clickReserveCount(writePage);
      await writePage.waitForTimeout(3000);
      reserveText = await getTextFromFrames(writePage);
    }

    const combinedText = `${postText}\n${reserveText}`;
    const combinedHits = expectedKeywords.filter((keyword) => combinedText.includes(keyword));
    const postHits = expectedKeywords.filter((keyword) => postText.includes(keyword));
    const reserveHits = expectedKeywords.filter((keyword) => reserveText.includes(keyword));
    const reserveTimeHits = expectedTimes.filter((time) => reserveText.includes(time));

    const base = `${target.domain}-${target.accountId}-${Date.now()}`;
    const textPath = path.join(outputDir, `combined-${base}.txt`);
    await fs.writeFile(textPath, [
      `domain=${target.domain}`,
      `account=${target.accountId}`,
      `blog=${target.blogId}`,
      `expected=${expectedKeywords.join(', ')}`,
      `reserveButton=${reserveButtonText}`,
      '',
      '[POSTLIST]',
      postText,
      '',
      '[RESERVE]',
      reserveText,
    ].join('\n'), 'utf8');

    return {
      domain: target.domain,
      accountId: target.accountId,
      reserveButtonText,
      combinedHits: `${combinedHits.length}/${expectedKeywords.length}`,
      postHits: `${postHits.length}/${expectedKeywords.length}`,
      reserveHits: `${reserveHits.length}/${expectedKeywords.length}`,
      reserveTimeHits: `${reserveTimeHits.length}/${expectedTimes.length}`,
      ok: combinedHits.length === expectedKeywords.length,
      textPath,
    };
  } catch (error) {
    return {
      domain: target.domain,
      accountId: target.accountId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await context?.close().catch(() => undefined);
  }
};

const main = async (): Promise<void> => {
  await fs.mkdir(outputDir, { recursive: true });
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8')) as PlanShape;
  const targets: Target[] = Object.entries(plan.domains).flatMap(([domainKey, accounts]) =>
    accounts.map((account) => ({ ...account, domain: domainNames[domainKey] ?? domainKey })),
  );

  await mongoose.connect(env.MONGO_URI);
  const passwords = await loadPasswords(targets.map((target) => target.accountId));
  const browser = await chromium.launch({ headless: true, slowMo: 25 });
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const target of targets) {
      const result = await verifyTarget(browser, target, passwords);
      results.push(result);
      console.log(JSON.stringify(result));
    }
  } finally {
    await browser.close();
    await mongoose.disconnect();
    await redis.quit().catch(() => undefined);
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    total: results.length,
    ok: results.filter((result) => result.ok === true).length,
    failed: results.filter((result) => result.ok !== true),
    results,
  };
  const resultPath = path.join(outputDir, `combined-result-${Date.now()}.json`);
  await fs.writeFile(resultPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`RESULT_PATH=${resultPath}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
