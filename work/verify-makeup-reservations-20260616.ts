import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import { getSession } from '../src/services/session.service.js';
import { getValidCookies, naverLogin } from '../src/services/naver-auth.service.js';
import { normalizeSessionCookies } from '../src/lib/naver-editor/cookies.js';

interface PlanItem {
  keyword: string;
  scheduledAt: string;
  slot: number;
}

interface PlanAccount {
  accountId: string;
  blogId: string;
  blogName: string;
  keywords: string[];
  items: PlanItem[];
}

interface PlanShape {
  domains: Record<string, PlanAccount[]>;
  submissions: Record<string, {
    schedules: Array<{
      scheduleId: string;
      jobs: Array<{ id: string; keyword: string; scheduledAt: string; slot: number }>;
    }>;
  }>;
}

interface Target {
  domainKey: string;
  domainName: string;
  accountId: string;
  blogId: string;
  blogName: string;
  items: PlanItem[];
  scheduleId: string;
}

interface VerifyResult {
  domain: string;
  accountId: string;
  blogId: string;
  blogName: string;
  scheduleId: string;
  reserveButtonText: string;
  popupTotalText: string;
  expectedKeywords: string[];
  keywordHits: string[];
  expectedTimes: string[];
  timeHits: string[];
  debugTextPath: string;
  screenshotPath: string;
  error?: string;
}

const domainNames: Record<string, string> = {
  eye: '안과',
  pet: '애견',
  brand: '안과브랜드',
};

const args = process.argv.slice(2);
const getArg = (flag: string, fallback: string): string => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

const planPath = path.resolve(process.cwd(), getArg('--plan', 'work/makeup-schedule-2026-06-16-1781617159036.json'));
const onlyAccounts = new Set(getArg('--only', '').split(',').map((item) => item.trim()).filter(Boolean));
const outputDir = path.resolve(process.cwd(), 'data', 'verify-makeup-reservations-20260616');

const normalizeText = (text: string): string => text.replace(/\s+/g, ' ').trim();

const getTextFromFrames = async (page: Page): Promise<string> => {
  const texts: string[] = [];
  for (const frame of page.frames()) {
    try {
      texts.push(await frame.locator('body').innerText({ timeout: 3000 }));
    } catch {
      // Detached or cross-origin frames are ignored.
    }
  }
  return texts.join('\n');
};

const findReserveButtonText = async (page: Page): Promise<string> => {
  const text = await getTextFromFrames(page);
  const match = text.match(/예약\s*발행\s*\d+\s*건/);
  return match?.[0] ? normalizeText(match[0]) : '';
};

const clickReserveButton = async (page: Page): Promise<void> => {
  const viewport = page.viewportSize();
  if (viewport) {
    await page.mouse.click(viewport.width - 229, 22);
    return;
  }

  const clickInFrame = async (frame: Frame): Promise<boolean> => {
    try {
      return await frame.evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>('button,a,[role="button"],span,div'),
        );

        for (const node of nodes) {
          const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          const visible = rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || '1') > 0;
          if (visible && /예약\s*발행\s*\d+\s*건/.test(text) && text.length <= 40) {
            const target = node.closest('button,a,[role="button"]') as HTMLElement | null;
            (target ?? node).click();
            return true;
          }
        }

        return false;
      });
    } catch {
      return false;
    }
  };

  for (const frame of page.frames()) {
    if (await clickInFrame(frame)) {
      return;
    }
  }

  throw new Error('reserve button not found');
};

const closeEditorOverlays = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape').catch(() => undefined);
  const viewport = page.viewportSize();
  if (viewport) {
    await page.mouse.click(viewport.width - 42, 42).catch(() => undefined);
    await page.waitForTimeout(1000);
  }

  for (const frame of page.frames()) {
    try {
      await frame.evaluate(() => {
        const closeCandidates = Array.from(
          document.querySelectorAll<HTMLElement>('button,a,[role="button"],span,div'),
        );
        for (const node of closeCandidates) {
          const label = [
            node.getAttribute('aria-label') ?? '',
            node.getAttribute('title') ?? '',
            node.innerText ?? '',
            node.textContent ?? '',
          ].join(' ').replace(/\s+/g, ' ').trim();
          const rect = node.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(node).visibility !== 'hidden';
          if (visible && /^(닫기|Close|×|X)$/.test(label)) {
            node.click();
            return;
          }
        }
      });
    } catch {
      // Ignore frames that cannot be inspected.
    }
  }

  await page.waitForTimeout(1500);
};

const buildTargets = (plan: PlanShape): Target[] => {
  const scheduleByAccount = new Map<string, string>();
  for (const [domainKey, submission] of Object.entries(plan.submissions)) {
    const accounts = plan.domains[domainKey] ?? [];
    for (let index = 0; index < submission.schedules.length; index += 1) {
      const account = accounts[index];
      const schedule = submission.schedules[index];
      if (account && schedule) {
        scheduleByAccount.set(account.accountId, schedule.scheduleId);
      }
    }
  }

  return Object.entries(plan.domains).flatMap(([domainKey, accounts]) =>
    accounts.map((account) => ({
      domainKey,
      domainName: domainNames[domainKey] ?? domainKey,
      accountId: account.accountId,
      blogId: account.blogId || account.accountId,
      blogName: account.blogName,
      items: account.items,
      scheduleId: scheduleByAccount.get(account.accountId) ?? '',
    })),
  );
};

const loadPasswords = async (accountIds: string[]): Promise<Map<string, string>> => {
  const rows = await mongoose.connection.useDb('cafe-bot')
    .collection('accounts')
    .find({ accountId: { $in: accountIds } }, { projection: { _id: 0, accountId: 1, password: 1 } })
    .toArray();

  const passwords = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.accountId === 'string' && typeof row.password === 'string' && row.password) {
      passwords.set(row.accountId, row.password);
    }
  }
  return passwords;
};

const getCookiesForTarget = async (
  target: Target,
  passwords: Map<string, string>,
): Promise<unknown[]> => {
  const cached = await getSession(target.accountId);
  if (cached) return cached;

  const runtimePassword = target.accountId === 'adplan3th' ? process.env.NAVER_BRAND_PASSWORD : undefined;
  const password = runtimePassword ?? passwords.get(target.accountId);
  if (!password) {
    throw new Error('no cached session or password');
  }

  if (passwords.has(target.accountId)) {
    return (await getValidCookies(target.accountId, password)).cookies;
  }

  const login = await naverLogin(target.accountId, password);
  if (!login.success) {
    throw new Error(login.message);
  }
  return login.cookies;
};

const verifyTarget = async (
  browser: Browser,
  target: Target,
  passwords: Map<string, string>,
): Promise<VerifyResult> => {
  const baseName = `${target.domainKey}-${target.accountId}-${Date.now()}`;
  const debugTextPath = path.join(outputDir, `${baseName}.txt`);
  const screenshotPath = path.join(outputDir, `${baseName}.png`);
  const expectedKeywords = target.items.map((item) => item.keyword);
  const expectedTimes = target.items.map((item) => item.scheduledAt.slice(11, 16));

  let context: BrowserContext | null = null;
  try {
    const cookies = await getCookiesForTarget(target, passwords);
    context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addCookies(normalizeSessionCookies(cookies));

    const page = await context.newPage();
    await page.goto(`https://blog.naver.com/${target.blogId}?Redirect=Write&`, {
      waitUntil: 'domcontentloaded',
      timeout: env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
    });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(5000);
    await closeEditorOverlays(page);

    const reserveButtonText = await findReserveButtonText(page);
    let popupPage: Page | null = null;
    if (reserveButtonText) {
      const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
      await clickReserveButton(page);
      popupPage = await popupPromise;
      if (popupPage) {
        await popupPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
      }
      await page.waitForTimeout(7000);
    }

    let popupText = await getTextFromFrames(popupPage ?? page);
    if (!expectedKeywords.some((keyword) => popupText.includes(keyword))) {
      const viewport = page.viewportSize();
      if (viewport) {
        await page.mouse.click(viewport.width - 229, 22);
        await page.waitForTimeout(5000);
        popupText = await getTextFromFrames(page);
      }
    }
    await fs.writeFile(debugTextPath, [
      `url=${page.url()}`,
      `title=${await page.title().catch(() => '')}`,
      `domain=${target.domainName}`,
      `account=${target.accountId}`,
      `blog=${target.blogId}`,
      `expected=${expectedKeywords.join(', ')}`,
      '',
      popupText,
    ].join('\n'), 'utf8');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

    const popupTotalText = popupText.match(/총\s*\d+\s*개/)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';
    return {
      domain: target.domainName,
      accountId: target.accountId,
      blogId: target.blogId,
      blogName: target.blogName,
      scheduleId: target.scheduleId,
      reserveButtonText,
      popupTotalText,
      expectedKeywords,
      keywordHits: expectedKeywords.filter((keyword) => popupText.includes(keyword)),
      expectedTimes,
      timeHits: expectedTimes.filter((time) => popupText.includes(time)),
      debugTextPath,
      screenshotPath,
    };
  } catch (error) {
    await fs.writeFile(debugTextPath, [
      `domain=${target.domainName}`,
      `account=${target.accountId}`,
      `blog=${target.blogId}`,
      `expected=${expectedKeywords.join(', ')}`,
      '',
      error instanceof Error ? error.stack ?? error.message : String(error),
    ].join('\n'), 'utf8');
    return {
      domain: target.domainName,
      accountId: target.accountId,
      blogId: target.blogId,
      blogName: target.blogName,
      scheduleId: target.scheduleId,
      reserveButtonText: '',
      popupTotalText: '',
      expectedKeywords,
      keywordHits: [],
      expectedTimes,
      timeHits: [],
      debugTextPath,
      screenshotPath,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await context?.close().catch(() => undefined);
  }
};

const main = async (): Promise<void> => {
  await fs.mkdir(outputDir, { recursive: true });
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8')) as PlanShape;
  const targets = buildTargets(plan).filter((target) =>
    onlyAccounts.size === 0 || onlyAccounts.has(target.accountId),
  );

  await mongoose.connect(env.MONGO_URI);
  const passwords = await loadPasswords(targets.map((target) => target.accountId));
  const browser = await chromium.launch({
    headless: true,
    slowMo: 50,
  });

  const results: VerifyResult[] = [];
  try {
    for (const target of targets) {
      const result = await verifyTarget(browser, target, passwords);
      results.push(result);
      console.log(JSON.stringify({
        domain: result.domain,
        accountId: result.accountId,
        reserveButtonText: result.reserveButtonText,
        popupTotalText: result.popupTotalText,
        keywordHits: `${result.keywordHits.length}/${result.expectedKeywords.length}`,
        timeHits: `${result.timeHits.length}/${result.expectedTimes.length}`,
        error: result.error ?? '',
        debugTextPath: result.debugTextPath,
      }));
    }
  } finally {
    await browser.close();
    await mongoose.disconnect();
    await redis.quit().catch(() => undefined);
  }

  const resultPath = path.join(outputDir, `result-${Date.now()}.json`);
  await fs.writeFile(resultPath, JSON.stringify({ planPath, results }, null, 2), 'utf8');
  console.log(`RESULT_PATH=${resultPath}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
