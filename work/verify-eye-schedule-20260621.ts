import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose, { type Types } from 'mongoose';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import { normalizeSessionCookies } from '../src/lib/naver-editor/cookies.js';
import {
  readGoogleSheetValues,
  updateGoogleSheetValues,
} from '../src/services/google-sheets.service.js';
import { getValidCookies, naverLogin } from '../src/services/naver-auth.service.js';
import { getSession } from '../src/services/session.service.js';

const TARGET_DATE = '2026-06-21';
const TARGET_REF = `eye-sheet-633450920-${TARGET_DATE}`;
const TARGET_SERVICE = 'ophthalmology-sheet';
const STATUS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit?gid=0#gid=0';
const STATUS_SHEET_GID = 0;
const MODE_LABEL = 'eye-sheet auto / mode 3';
const OUTPUT_DIR = path.resolve(process.cwd(), 'outputs', `eye-schedule-verify-${TARGET_DATE}`);
const POLL_INTERVAL_MS = 20_000;
const POLL_TIMEOUT_MS = 40 * 60_000;

interface ScheduleRow {
  _id: Types.ObjectId;
  accountId: string;
  service?: string;
  ref?: string;
}

interface JobRow {
  _id: Types.ObjectId;
  scheduleId: Types.ObjectId;
  keyword?: string;
  scheduledAt?: string;
  slot?: number;
  status?: string;
  error?: string;
  title?: string;
  generateJobId?: string;
  publishJobId?: string;
  updatedAt?: Date;
}

interface AccountRow {
  accountId?: string;
  blogId?: string;
  nickname?: string;
}

interface CredentialRow {
  accountId?: string;
  password?: string;
}

interface VerifiedJob {
  scheduleId: string;
  jobId: string;
  accountId: string;
  blogId: string;
  blogName: string;
  keyword: string;
  scheduledAt: string;
  slot: number;
  status: string;
  error?: string;
}

interface VerifyAccountResult {
  accountId: string;
  blogId: string;
  blogName: string;
  reserveButtonText: string;
  popupTotalText: string;
  expectedKeywords: string[];
  expectedTimes: string[];
  combinedHits: string[];
  postHits: string[];
  reserveHits: string[];
  reserveTimeHits: string[];
  debugTextPath: string;
  screenshotPath: string;
  postText: string;
  reserveText: string;
  error?: string;
}

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const formatActualTime = (scheduledAt: string): string =>
  `${scheduledAt.slice(0, 10)} ${scheduledAt.slice(11, 16)}`;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const loadTodayJobs = async (): Promise<VerifiedJob[]> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Mongo connection is not ready');
  }

  const schedules = await db.collection<ScheduleRow>('schedules')
    .find(
      {
        ref: TARGET_REF,
        service: TARGET_SERVICE,
        status: { $ne: 'cancelled' },
      },
      { projection: { _id: 1, accountId: 1, service: 1, ref: 1 } },
    )
    .toArray();

  if (schedules.length === 0) {
    throw new Error(`No schedules found for ref=${TARGET_REF}`);
  }

  const scheduleIds = schedules.map((schedule) => schedule._id);
  const scheduleById = new Map(schedules.map((schedule) => [String(schedule._id), schedule]));

  const accounts = await db.collection<AccountRow>('blogaccounts')
    .find(
      { accountId: { $in: schedules.map((schedule) => schedule.accountId) } },
      { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1 } },
    )
    .toArray();
  const accountById = new Map(accounts
    .filter((account): account is Required<Pick<AccountRow, 'accountId'>> & AccountRow => Boolean(account.accountId))
    .map((account) => [account.accountId, account]));

  const jobs = await db.collection<JobRow>('schedulejobs')
    .find(
      {
        scheduleId: { $in: scheduleIds },
        scheduledAt: { $regex: `^${TARGET_DATE}` },
        status: { $ne: 'cancelled' },
      },
      {
        projection: {
          _id: 1,
          scheduleId: 1,
          keyword: 1,
          scheduledAt: 1,
          slot: 1,
          status: 1,
          error: 1,
          title: 1,
          generateJobId: 1,
          publishJobId: 1,
          updatedAt: 1,
        },
      },
    )
    .sort({ scheduledAt: 1, slot: 1, _id: 1 })
    .toArray();

  return jobs.flatMap((job) => {
    const schedule = scheduleById.get(String(job.scheduleId));
    if (!schedule) {
      return [];
    }
    const account = accountById.get(schedule.accountId);
    return [{
      scheduleId: String(job.scheduleId),
      jobId: String(job._id),
      accountId: schedule.accountId,
      blogId: account?.blogId || schedule.accountId,
      blogName: normalizeText(account?.nickname || schedule.accountId),
      keyword: String(job.keyword ?? ''),
      scheduledAt: String(job.scheduledAt ?? ''),
      slot: Number(job.slot ?? 0),
      status: String(job.status ?? ''),
      error: job.error ? String(job.error) : undefined,
    }];
  });
};

const jobsSettled = (jobs: VerifiedJob[]): boolean =>
  jobs.every((job) => job.status === 'published' || job.status === 'failed');

const waitForSettledJobs = async (): Promise<VerifiedJob[]> => {
  const startedAt = Date.now();
  let jobs = await loadTodayJobs();

  while (!jobsSettled(jobs)) {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for jobs to settle for ${TARGET_REF}`);
    }
    console.log(JSON.stringify({
      phase: 'poll',
      totals: jobs.reduce<Record<string, number>>((acc, job) => {
        acc[job.status] = (acc[job.status] ?? 0) + 1;
        return acc;
      }, {}),
    }));
    await sleep(POLL_INTERVAL_MS);
    jobs = await loadTodayJobs();
  }

  return jobs;
};

const loadPasswords = async (accountIds: string[]): Promise<Map<string, string>> => {
  const rows = await mongoose.connection.useDb('cafe-bot')
    .collection<CredentialRow>('accounts')
    .find({ accountId: { $in: accountIds } }, { projection: { _id: 0, accountId: 1, password: 1 } })
    .toArray();

  return new Map(
    rows
      .filter((row): row is Required<Pick<CredentialRow, 'accountId' | 'password'>> => Boolean(row.accountId && row.password))
      .map((row) => [row.accountId, row.password]),
  );
};

const getTextFromFrames = async (page: Page): Promise<string> => {
  const texts: string[] = [];
  for (const frame of page.frames()) {
    try {
      texts.push(await frame.locator('body').innerText({ timeout: 3000 }));
    } catch {
      // ignore detached/cross-origin frames
    }
  }
  return texts.join('\n');
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
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('button,a,[role="button"],span,div'));
        for (const node of nodes) {
          const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          const visible = rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || '1') > 0;
          if (visible && /예약\s*발행\s*\d+\s*건/.test(text)) {
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

const findReserveButtonText = async (page: Page): Promise<string> => {
  const text = await getTextFromFrames(page);
  const match = text.match(/예약\s*발행\s*\d+\s*건/);
  return match?.[0] ? normalizeText(match[0]) : '';
};

const closeEditorOverlays = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape').catch(() => undefined);
  const viewport = page.viewportSize();
  if (viewport) {
    await page.mouse.click(viewport.width - 42, 42).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1500);
};

const getCookiesForAccount = async (
  accountId: string,
  passwordMap: Map<string, string>,
): Promise<unknown[]> => {
  const cached = await getSession(accountId);
  if (cached) {
    return cached;
  }

  const password = accountId === 'adplan3th'
    ? process.env.NAVER_BRAND_PASSWORD
    : passwordMap.get(accountId);
  if (!password) {
    throw new Error('no cached session or runtime password');
  }

  const validated = await getValidCookies(accountId, password);
  if (validated.cookies.length > 0) {
    return validated.cookies;
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
  blogName: string,
  jobs: VerifiedJob[],
  passwordMap: Map<string, string>,
): Promise<VerifyAccountResult> => {
  const baseName = `${accountId}-${Date.now()}`;
  const debugTextPath = path.join(OUTPUT_DIR, `${baseName}.txt`);
  const screenshotPath = path.join(OUTPUT_DIR, `${baseName}.png`);
  const expectedKeywords = jobs.map((job) => job.keyword);
  const expectedTimes = jobs.map((job) => job.scheduledAt.slice(11, 16));

  let context: BrowserContext | null = null;
  try {
    const cookies = await getCookiesForAccount(accountId, passwordMap);
    context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addCookies(normalizeSessionCookies(cookies));

    const postPage = await context.newPage();
    await postPage.goto(`https://blog.naver.com/PostList.naver?blogId=${blogId}&from=postList`, {
      waitUntil: 'domcontentloaded',
      timeout: env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
    });
    await postPage.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
    await postPage.waitForTimeout(5000);
    const postText = await getTextFromFrames(postPage);

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

    const reserveText = await getTextFromFrames(popupPage ?? page);
    const combinedText = `${postText}\n${reserveText}`;
    const combinedHits = expectedKeywords.filter((keyword) => combinedText.includes(keyword));
    const postHits = expectedKeywords.filter((keyword) => postText.includes(keyword));
    const reserveHits = expectedKeywords.filter((keyword) => reserveText.includes(keyword));
    const reserveTimeHits = expectedTimes.filter((time) => reserveText.includes(time));

    await fs.writeFile(debugTextPath, [
      '[POSTLIST]',
      postText,
      '',
      '[RESERVE]',
      reserveText,
    ].join('\n'), 'utf8');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

    return {
      accountId,
      blogId,
      blogName,
      reserveButtonText,
      popupTotalText: reserveText.match(/총\s*\d+\s*개/u)?.[0]?.replace(/\s+/g, ' ').trim() ?? '',
      expectedKeywords,
      expectedTimes,
      combinedHits,
      postHits,
      reserveHits,
      reserveTimeHits,
      debugTextPath,
      screenshotPath,
      postText,
      reserveText,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await fs.writeFile(debugTextPath, message, 'utf8').catch(() => undefined);
    return {
      accountId,
      blogId,
      blogName,
      reserveButtonText: '',
      popupTotalText: '',
      expectedKeywords,
      expectedTimes,
      combinedHits: [],
      postHits: [],
      reserveHits: [],
      reserveTimeHits: [],
      debugTextPath,
      screenshotPath,
      postText: '',
      reserveText: '',
      error: message,
    };
  } finally {
    await context?.close().catch(() => undefined);
  }
};

const buildVerificationText = (result: VerifyAccountResult, keyword: string, time: string): string => {
  if (result.error) {
    return `실확인 실패: ${result.error}`;
  }
  const inPostList = result.postHits.includes(keyword);
  const inReserveList = result.reserveHits.includes(keyword);
  const reserveTimeOk = result.reserveTimeHits.includes(time);
  if (inReserveList && reserveTimeOk) {
    return `${result.reserveButtonText || '예약 목록'} / ${result.popupTotalText || '총수 미확인'} / 예약 키워드·시간 확인`;
  }
  if (inPostList) {
    return '오늘 발행 목록 확인';
  }
  return `${result.reserveButtonText || '예약 목록'} / ${result.popupTotalText || '총수 미확인'} / 발행·예약 목록 누락`;
};

const extractTitleForKeyword = (result: VerifyAccountResult, keyword: string): string => {
  const lines = `${result.postText}\n${result.reserveText}`
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const title = lines.find((line) => line.includes(keyword) && line.length <= 140);
  return title ?? keyword;
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

const appendStatusRows = async (
  jobs: VerifiedJob[],
  verifyByAccount: Map<string, VerifyAccountResult>,
): Promise<{ range: string; updatedRows: number }> => {
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

  const rows = jobs.flatMap((job) => {
    const verify = verifyByAccount.get(job.accountId);
    const reservationTime = job.scheduledAt.slice(11, 16);
    const rowKey = `${TARGET_DATE}|${job.accountId}|${job.keyword}|${job.scheduleId}|${job.jobId}`;
    if (existingKeys.has(rowKey)) {
      return [];
    }
    return [[
      TARGET_DATE,
      '안과',
      job.blogName,
      job.accountId,
      job.keyword,
      job.status === 'published' ? '예약/발행완료' : '실패',
      MODE_LABEL,
      verify ? buildVerificationText(verify, job.keyword, reservationTime) : '실확인 결과 없음',
      verify ? extractTitleForKeyword(verify, job.keyword) : job.keyword,
      formatActualTime(job.scheduledAt),
      job.scheduleId,
      job.jobId,
    ]];
  });

  if (rows.length === 0) {
    return { range: '', updatedRows: 0 };
  }

  const startRow = findFirstEmptyRow(existing.values);
  const range = `A${startRow}:L${startRow + rows.length - 1}`;
  const result = await updateGoogleSheetValues({
    spreadsheet: STATUS_SHEET_URL,
    gid: STATUS_SHEET_GID,
    range,
    values: rows,
  });

  return { range: result.updatedRange, updatedRows: result.updatedRows };
};

const main = async (): Promise<void> => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await mongoose.connect(env.MONGO_URI);

  let browser: Browser | null = null;
  try {
    const settledJobs = await waitForSettledJobs();
    const passwordMap = await loadPasswords([...new Set(settledJobs.map((job) => job.accountId))]);
    const jobsByAccount = new Map<string, VerifiedJob[]>();
    for (const job of settledJobs) {
      const items = jobsByAccount.get(job.accountId) ?? [];
      items.push(job);
      jobsByAccount.set(job.accountId, items);
    }

    browser = await chromium.launch({ headless: true, slowMo: 50 });
    const verifyByAccount = new Map<string, VerifyAccountResult>();
    for (const [accountId, jobs] of jobsByAccount.entries()) {
      const first = jobs[0];
      const result = await verifyAccount(
        browser,
        accountId,
        first.blogId,
        first.blogName,
        jobs,
        passwordMap,
      );
      verifyByAccount.set(accountId, result);
      console.log(JSON.stringify({
        phase: 'verify',
        accountId,
        combinedHits: `${result.combinedHits.length}/${result.expectedKeywords.length}`,
        postHits: `${result.postHits.length}/${result.expectedKeywords.length}`,
        reserveHits: `${result.reserveHits.length}/${result.expectedKeywords.length}`,
        reserveTimeHits: `${result.reserveTimeHits.length}/${result.expectedTimes.length}`,
        error: result.error ?? '',
      }));
    }

    const sheetResult = await appendStatusRows(settledJobs, verifyByAccount);
    const summaryPath = path.join(OUTPUT_DIR, 'summary.json');
    await fs.writeFile(summaryPath, JSON.stringify({
      targetDate: TARGET_DATE,
      ref: TARGET_REF,
      jobs: settledJobs,
      verifyResults: [...verifyByAccount.values()],
      sheetResult,
    }, null, 2));

    console.log(JSON.stringify({
      phase: 'done',
      outputDir: OUTPUT_DIR,
      summaryPath,
      sheetRange: sheetResult.range,
      sheetUpdatedRows: sheetResult.updatedRows,
      totals: settledJobs.reduce<Record<string, number>>((acc, job) => {
        acc[job.status] = (acc[job.status] ?? 0) + 1;
        return acc;
      }, {}),
    }, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
