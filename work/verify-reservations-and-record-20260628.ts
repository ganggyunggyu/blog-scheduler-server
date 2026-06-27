import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import { normalizeSessionCookies } from '../src/lib/naver-editor/cookies.js';
import { getValidCookies, naverLogin } from '../src/services/naver-auth.service.js';
import { getSession } from '../src/services/session.service.js';
import {
  readGoogleSheetValues,
  updateGoogleSheetValues,
} from '../src/services/google-sheets.service.js';

const STATUS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit#gid=817577400';
const STATUS_SHEET_GID = 817577400;
const TARGET_DATE = '2026-06-28';
const OUTPUT_DIR = path.resolve(process.cwd(), 'outputs', `reservation-verify-${TARGET_DATE}`);

interface ScheduleRow {
  _id: string;
  accountId: string;
  service?: string;
  scheduleDate?: string;
}

interface JobRow {
  _id: string;
  scheduleId: string;
  keyword?: string;
  scheduledAt?: string;
  status?: string;
  error?: string;
}

interface AccountRow {
  accountId?: string;
  blogId?: string;
  nickname?: string;
  category?: string;
}

interface CredentialRow {
  accountId?: string;
  password?: string;
}

interface TargetJob {
  schedule: ScheduleRow;
  account: AccountRow;
  job: JobRow;
}

interface VerifyResult {
  accountId: string;
  blogId: string;
  reserveButtonText: string;
  popupTotalText: string;
  popupText: string;
  keywordHits: string[];
  timeHits: string[];
  debugTextPath: string;
  screenshotPath: string;
  error?: string;
}

const args = process.argv.slice(2);

const getArg = (name: string, fallback = ''): string => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

const onlyServices = new Set(
  getArg('--services', 'pet-sheet-sunday-20260628,goat-sheet-sunday-20260628')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);
const concurrency = Math.max(1, Number(getArg('--concurrency', '3')) || 3);

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const domainFor = (schedule: ScheduleRow, account?: AccountRow): string => {
  const service = schedule.service ?? '';
  const category = account?.category ?? '';
  if (/brand/i.test(service) || category === '안과브랜드') return '안과브랜드';
  if (/ophthalmology|eye/i.test(service) || category.includes('안과')) return '안과';
  if (/pet/i.test(service) || category === '서리펫' || category === '도그마루 글밥') return '애견';
  if (/goat|hanryeo/i.test(service) || category === '흑염소') return '흑염소';
  if (/alibaba/i.test(service) || category === '알리바바') return '알리바바';
  return category || service || '기타';
};

const formatScheduleTime = (value?: string): string =>
  value ? `${value.slice(0, 10)} ${value.slice(11, 16)}` : '';

const getTextFromFrames = async (page: Page): Promise<string> => {
  const texts: string[] = [];
  for (const frame of page.frames()) {
    try {
      texts.push(await frame.locator('body').innerText({ timeout: 3000 }));
    } catch {
      // Detached or cross-origin frame.
    }
  }
  return texts.join('\n');
};

const findReserveButtonText = async (page: Page): Promise<string> => {
  const text = await getTextFromFrames(page);
  return text.match(/예약\s*발행\s*\d+\s*건/u)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';
};

const closeEditorOverlays = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(700);
  const viewport = page.viewportSize();
  if (viewport) {
    await page.mouse.click(viewport.width - 42, 42).catch(() => undefined);
  }
  await page.waitForTimeout(1200);
};

const clickReserveButton = async (page: Page): Promise<void> => {
  const viewport = page.viewportSize();
  if (viewport) {
    await page.mouse.click(viewport.width - 229, 22);
    return;
  }
  throw new Error('viewport not available');
};

const loadPasswords = async (accountIds: string[]): Promise<Map<string, string>> => {
  const rows = await mongoose.connection.useDb('cafe-bot')
    .collection<CredentialRow>('accounts')
    .find({ accountId: { $in: accountIds } }, { projection: { _id: 0, accountId: 1, password: 1 } })
    .toArray();

  return new Map(rows
    .filter((row): row is Required<Pick<CredentialRow, 'accountId' | 'password'>> => Boolean(row.accountId && row.password))
    .map((row) => [row.accountId, row.password]));
};

const getCookiesForAccount = async (
  accountId: string,
  passwordMap: Map<string, string>,
): Promise<unknown[]> => {
  const cached = await getSession(accountId);
  if (cached) return cached;

  const password = accountId === 'adplan3th'
    ? process.env.NAVER_BRAND_PASSWORD
    : passwordMap.get(accountId);
  if (!password) {
    throw new Error('no cached session or runtime password');
  }

  if (passwordMap.has(accountId)) {
    return (await getValidCookies(accountId, password)).cookies;
  }

  const login = await naverLogin(accountId, password);
  if (!login.success) {
    throw new Error(login.message);
  }
  return login.cookies;
};

const verifyAccount = async (
  browser: Browser,
  accountId: string,
  blogId: string,
  jobs: TargetJob[],
  passwordMap: Map<string, string>,
): Promise<VerifyResult> => {
  const baseName = `${accountId}-${Date.now()}`;
  const debugTextPath = path.join(OUTPUT_DIR, `${baseName}.txt`);
  const screenshotPath = path.join(OUTPUT_DIR, `${baseName}.png`);
  const expectedKeywords = jobs.map((item) => normalizeText(item.job.keyword ?? ''));
  const expectedTimes = jobs.map((item) => item.job.scheduledAt?.slice(11, 16) ?? '');

  let context: BrowserContext | null = null;
  try {
    const cookies = await getCookiesForAccount(accountId, passwordMap);
    context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addCookies(normalizeSessionCookies(cookies));

    const page = await context.newPage();
    await page.goto(`https://blog.naver.com/${blogId}?Redirect=Write&`, {
      waitUntil: 'domcontentloaded',
      timeout: env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
    });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(5000);
    await closeEditorOverlays(page);

    const reserveButtonText = await findReserveButtonText(page);
    const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await clickReserveButton(page);
    const popupPage = await popupPromise;
    if (popupPage) {
      await popupPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
    }
    await page.waitForTimeout(7000);

    let popupText = await getTextFromFrames(popupPage ?? page);
    if (!expectedKeywords.some((keyword) => keyword && popupText.includes(keyword))) {
      await clickReserveButton(page).catch(() => undefined);
      await page.waitForTimeout(5000);
      popupText = await getTextFromFrames(page);
    }

    await fs.writeFile(debugTextPath, [
      `url=${page.url()}`,
      `account=${accountId}`,
      `blog=${blogId}`,
      `expected=${expectedKeywords.join(', ')}`,
      '',
      popupText,
    ].join('\n'), 'utf8');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

    return {
      accountId,
      blogId,
      reserveButtonText,
      popupTotalText: popupText.match(/총\s*\d+\s*개/u)?.[0]?.replace(/\s+/g, ' ').trim() ?? '',
      popupText,
      keywordHits: expectedKeywords.filter((keyword) => keyword && popupText.includes(keyword)),
      timeHits: expectedTimes.filter((time) => time && popupText.includes(time)),
      debugTextPath,
      screenshotPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await fs.writeFile(debugTextPath, [
      `account=${accountId}`,
      `blog=${blogId}`,
      `expected=${expectedKeywords.join(', ')}`,
      '',
      message,
    ].join('\n'), 'utf8').catch(() => undefined);
    return {
      accountId,
      blogId,
      reserveButtonText: '',
      popupTotalText: '',
      popupText: '',
      keywordHits: [],
      timeHits: [],
      debugTextPath,
      screenshotPath,
      error: message,
    };
  } finally {
    await context?.close().catch(() => undefined);
  }
};

const runLimited = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
};

const extractTitleForKeyword = (popupText: string, keyword: string): string => {
  const lines = popupText
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  return lines.find((line) => line.includes(keyword) && line.length <= 140) ?? keyword;
};

const buildVerification = (result: VerifyResult | undefined, job: JobRow): string => {
  if (!result) return 'UI 실확인 결과 없음';
  if (result.error) return `UI 실확인 실패: ${result.error}`;
  const keyword = normalizeText(job.keyword ?? '');
  const time = job.scheduledAt?.slice(11, 16) ?? '';
  const keywordOk = keyword ? result.keywordHits.includes(keyword) : false;
  const timeOk = time ? result.timeHits.includes(time) : false;
  const base = `${result.reserveButtonText || '예약 목록'} / ${result.popupTotalText || '총수 미확인'}`;
  return `${base} / 키워드 ${keywordOk ? '확인' : '누락'}, 시간 ${timeOk ? '확인' : '누락'}`;
};

const rowStatus = (result: VerifyResult | undefined, job: JobRow): string => {
  if (job.status === 'failed') return '실패';
  if (job.status !== 'published') return '진행중';
  const keyword = normalizeText(job.keyword ?? '');
  const time = job.scheduledAt?.slice(11, 16) ?? '';
  if (result && !result.error && result.keywordHits.includes(keyword) && result.timeHits.includes(time)) {
    return '예약';
  }
  return '예약(UI부분확인)';
};

const findFirstEmptyRow = (values: string[][]): number => {
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    if (!row.slice(0, 12).some((cell) => cell && cell.trim() !== '')) {
      return index + 1;
    }
  }
  return values.length + 1;
};

const main = async (): Promise<void> => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await mongoose.connect(env.MONGO_URI);

  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo connection not ready');

  const serviceQuery = onlyServices.size > 0 ? { service: { $in: [...onlyServices] } } : {};
  const schedules = await db.collection<ScheduleRow>('schedules')
    .find({ scheduleDate: TARGET_DATE, ...serviceQuery }, {
      projection: { _id: 1, accountId: 1, service: 1, scheduleDate: 1 },
    })
    .sort({ service: 1, accountId: 1 })
    .toArray();
  const scheduleById = new Map(schedules.map((schedule) => [String(schedule._id), schedule]));

  const accounts = await db.collection<AccountRow>('blogaccounts')
    .find({ accountId: { $in: schedules.map((schedule) => schedule.accountId) } }, {
      projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, category: 1 },
    })
    .toArray();
  const accountById = new Map(accounts
    .filter((account) => account.accountId)
    .map((account) => [String(account.accountId), account]));

  const jobs = await db.collection<JobRow>('schedulejobs')
    .find({ scheduleId: { $in: schedules.map((schedule) => schedule._id) } }, {
      projection: { _id: 1, scheduleId: 1, keyword: 1, scheduledAt: 1, status: 1, error: 1 },
    })
    .sort({ scheduledAt: 1, _id: 1 })
    .toArray();

  const targetJobs = jobs.flatMap((job) => {
    const schedule = scheduleById.get(String(job.scheduleId));
    if (!schedule) return [];
    const account = accountById.get(schedule.accountId) ?? { accountId: schedule.accountId, blogId: schedule.accountId };
    return [{ schedule, account, job }];
  });

  const passwordMap = await loadPasswords([...new Set(targetJobs.map((item) => item.schedule.accountId))]);
  const jobsByAccount = new Map<string, TargetJob[]>();
  for (const item of targetJobs) {
    const list = jobsByAccount.get(item.schedule.accountId) ?? [];
    list.push(item);
    jobsByAccount.set(item.schedule.accountId, list);
  }

  const browser = await chromium.launch({ headless: true, slowMo: 40 });
  const verifyByAccount = new Map<string, VerifyResult>();
  try {
    const entries = [...jobsByAccount.entries()];
    const results = await runLimited(entries, concurrency, async ([accountId, accountJobs]) => {
      const first = accountJobs[0];
      const blogId = first.account.blogId || accountId;
      const result = await verifyAccount(browser, accountId, blogId, accountJobs, passwordMap);
      console.log(JSON.stringify({
        accountId,
        service: first.schedule.service,
        keywordHits: `${result.keywordHits.length}/${accountJobs.length}`,
        timeHits: `${result.timeHits.length}/${accountJobs.length}`,
        reserveButtonText: result.reserveButtonText,
        popupTotalText: result.popupTotalText,
        error: result.error ?? '',
      }));
      return result;
    });
    for (const result of results) {
      verifyByAccount.set(result.accountId, result);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const existing = await readGoogleSheetValues({
    spreadsheet: STATUS_SHEET_URL,
    gid: STATUS_SHEET_GID,
    range: 'A:L',
  });
  const existingKeys = new Set(
    existing.values
      .slice(1)
      .map((row) => `${row[0] ?? ''}|${row[3] ?? ''}|${row[4] ?? ''}|${row[10] ?? ''}|${row[11] ?? ''}`),
  );

  const rows = targetJobs.flatMap((item) => {
    const keyword = normalizeText(item.job.keyword ?? '');
    const key = `${TARGET_DATE}|${item.schedule.accountId}|${keyword}|${item.job.scheduleId}|${item.job._id}`;
    if (existingKeys.has(key)) return [];
    const result = verifyByAccount.get(item.schedule.accountId);
    return [[
      TARGET_DATE,
      domainFor(item.schedule, item.account),
      normalizeText(item.account.nickname || item.schedule.accountId),
      item.schedule.accountId,
      keyword,
      rowStatus(result, item.job),
      `${item.schedule.service ?? 'unknown'} / 28일 계정당 2건 예약`,
      item.job.status === 'failed'
        ? `DB 실패: ${normalizeText(item.job.error ?? '').slice(0, 180)}`
        : buildVerification(result, item.job),
      result ? extractTitleForKeyword(result.popupText, keyword) : keyword,
      formatScheduleTime(item.job.scheduledAt),
      String(item.job.scheduleId),
      String(item.job._id),
    ]];
  });

  let sheetResult = { updatedRange: '', updatedRows: 0 };
  if (rows.length > 0) {
    const startRow = findFirstEmptyRow(existing.values);
    const range = `A${startRow}:L${startRow + rows.length - 1}`;
    sheetResult = await updateGoogleSheetValues({
      spreadsheet: STATUS_SHEET_URL,
      gid: STATUS_SHEET_GID,
      range,
      values: rows,
    });
  }

  const summaryPath = path.join(OUTPUT_DIR, `summary-${Date.now()}.json`);
  await fs.writeFile(summaryPath, JSON.stringify({
    targetDate: TARGET_DATE,
    services: [...onlyServices],
    totalJobs: targetJobs.length,
    verifyResults: [...verifyByAccount.values()].map((result) => ({
      accountId: result.accountId,
      blogId: result.blogId,
      reserveButtonText: result.reserveButtonText,
      popupTotalText: result.popupTotalText,
      keywordHits: result.keywordHits,
      timeHits: result.timeHits,
      debugTextPath: result.debugTextPath,
      screenshotPath: result.screenshotPath,
      error: result.error,
    })),
    sheetResult,
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    targetDate: TARGET_DATE,
    services: [...onlyServices],
    accounts: jobsByAccount.size,
    totalJobs: targetJobs.length,
    sheetUpdatedRows: sheetResult.updatedRows,
    sheetRange: sheetResult.updatedRange,
    summaryPath,
  }, null, 2));
};

main().catch(async (error: unknown) => {
  await mongoose.disconnect().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}).finally(async () => {
  await mongoose.disconnect().catch(() => undefined);
  await redis.quit().catch(() => undefined);
});
