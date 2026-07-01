import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose, { type Types } from 'mongoose';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { env } from '../src/config/env.js';
import { normalizeSessionCookies } from '../src/lib/naver-editor/cookies.js';
import {
  readGoogleSheetValues,
  updateGoogleSheetValues,
} from '../src/services/google-sheets.service.js';
import { getValidCookies, naverLogin } from '../src/services/naver-auth.service.js';
import { getSession } from '../src/services/session.service.js';

const TARGET_DATE = '2026-07-01';
const TARGET_REF = `core-daily-alibaba-cycle-${TARGET_DATE}`;
const TARGET_SERVICE = 'alibaba';
const STATUS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit?gid=0#gid=0';
const STATUS_SHEET_GID = 0;
const MODE_LABEL = 'alibaba auto / mode 3';
const OUTPUT_DIR = path.resolve(process.cwd(), 'outputs', `alibaba-schedule-verify-${TARGET_DATE}`);

interface ScheduleRow {
  _id: Types.ObjectId;
  accountId: string;
  service?: string;
  ref?: string;
  status?: string;
}

interface JobRow {
  _id: Types.ObjectId;
  scheduleId: Types.ObjectId;
  keyword?: string;
  scheduledAt?: string;
  slot?: number;
  status?: string;
  error?: string;
}

interface AccountRow {
  accountId?: string;
  blogId?: string;
  nickname?: string;
  category?: string;
  isEnabled?: boolean;
  status?: string;
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
  expectedKeywords: string[];
  keywordHits: string[];
  debugTextPath: string;
  screenshotPath: string;
  postText: string;
  titlesByKeyword: Record<string, string>;
  error?: string;
}

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();
const compactText = (value: string): string => value.replace(/\s+/g, '');

const formatActualTime = (scheduledAt: string): string =>
  `${scheduledAt.slice(0, 10)} ${scheduledAt.slice(11, 16)}`;

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
      { projection: { _id: 1, accountId: 1, service: 1, ref: 1, status: 1 } },
    )
    .toArray();

  if (schedules.length === 0) {
    throw new Error(`No schedules found for ref=${TARGET_REF}`);
  }

  const accounts = await db.collection<AccountRow>('blogaccounts')
    .find(
      { accountId: { $in: schedules.map((schedule) => schedule.accountId) } },
      { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, isEnabled: 1, status: 1 } },
    )
    .toArray();
  const accountById = new Map(
    accounts
      .filter((account): account is Required<Pick<AccountRow, 'accountId'>> & AccountRow => Boolean(account.accountId))
      .map((account) => [account.accountId, account]),
  );

  const jobs = await db.collection<JobRow>('schedulejobs')
    .find(
      {
        scheduleId: { $in: schedules.map((schedule) => schedule._id) },
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
        },
      },
    )
    .sort({ scheduledAt: 1, slot: 1, _id: 1 })
    .toArray();

  const scheduleById = new Map(schedules.map((schedule) => [String(schedule._id), schedule]));

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

const getCookiesForAccount = async (
  accountId: string,
  passwordMap: Map<string, string>,
): Promise<unknown[]> => {
  const cached = await getSession(accountId);
  if (cached) {
    return cached;
  }

  const password = passwordMap.get(accountId);
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

const extractTitleForKeyword = (text: string, keyword: string): string => {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const compactKeyword = compactText(keyword);
  const title = lines.find((line) => compactText(line).includes(compactKeyword) && line.length <= 140);
  return title ?? keyword;
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
    const compactPostText = compactText(postText);
    const keywordHits = expectedKeywords.filter((keyword) => compactPostText.includes(compactText(keyword)));
    const titlesByKeyword = Object.fromEntries(
      expectedKeywords.map((keyword) => [keyword, extractTitleForKeyword(postText, keyword)]),
    );

    await fs.writeFile(debugTextPath, postText, 'utf8');
    await postPage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

    return {
      accountId,
      blogId,
      blogName,
      expectedKeywords,
      keywordHits,
      debugTextPath,
      screenshotPath,
      postText,
      titlesByKeyword,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await fs.writeFile(debugTextPath, message, 'utf8').catch(() => undefined);
    return {
      accountId,
      blogId,
      blogName,
      expectedKeywords,
      keywordHits: [],
      debugTextPath,
      screenshotPath,
      postText: '',
      titlesByKeyword: {},
      error: message,
    };
  } finally {
    await context?.close().catch(() => undefined);
  }
};

const buildVerificationText = (result: VerifyAccountResult, keyword: string): string => {
  if (result.error) {
    return `실확인 실패: ${result.error}`;
  }
  return result.keywordHits.includes(keyword)
    ? '오늘 발행 글목록 확인'
    : '오늘 발행 글목록에서 키워드 미확인';
};

const findRowIndexByKey = (values: string[][], rowKey: string): number | null => {
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    const key = `${row[0] ?? ''}|${row[3] ?? ''}|${row[4] ?? ''}|${row[10] ?? ''}|${row[11] ?? ''}`;
    if (key === rowKey) {
      return index + 1;
    }
  }
  return null;
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

const upsertStatusRows = async (
  jobs: VerifiedJob[],
  verifyByAccount: Map<string, VerifyAccountResult>,
): Promise<{ updatedRows: number; updatedRanges: string[] }> => {
  const existing = await readGoogleSheetValues({
    spreadsheet: STATUS_SHEET_URL,
    gid: STATUS_SHEET_GID,
    range: 'A:L',
  });

  const pendingRows = jobs.map((job) => {
    const verify = verifyByAccount.get(job.accountId);
    return {
      key: `${TARGET_DATE}|${job.accountId}|${job.keyword}|${job.scheduleId}|${job.jobId}`,
      values: [[
        TARGET_DATE,
        '알리바바',
        job.blogName,
        job.accountId,
        job.keyword,
        job.status === 'published' ? '발행완료' : '실패',
        MODE_LABEL,
        verify ? buildVerificationText(verify, job.keyword) : '실확인 결과 없음',
        verify?.titlesByKeyword[job.keyword] ?? job.keyword,
        formatActualTime(job.scheduledAt),
        job.scheduleId,
        job.jobId,
      ]],
    };
  });

  const usedRows = new Set<number>();
  let nextEmptyRow = findFirstEmptyRow(existing.values);
  let updatedRows = 0;
  const updatedRanges: string[] = [];

  for (const row of pendingRows) {
    const existingRow = findRowIndexByKey(existing.values, row.key);
    const rowNumber = existingRow ?? (() => {
      while (usedRows.has(nextEmptyRow)) {
        nextEmptyRow += 1;
      }
      const assigned = nextEmptyRow;
      usedRows.add(assigned);
      nextEmptyRow += 1;
      return assigned;
    })();
    const range = `A${rowNumber}:L${rowNumber}`;
    const result = await updateGoogleSheetValues({
      spreadsheet: STATUS_SHEET_URL,
      gid: STATUS_SHEET_GID,
      range,
      values: row.values,
    });
    updatedRows += result.updatedRows;
    updatedRanges.push(result.updatedRange);
  }

  return { updatedRows, updatedRanges };
};

const main = async (): Promise<void> => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await mongoose.connect(env.MONGO_URI);

  let browser: Browser | null = null;
  try {
    const settledJobs = await loadTodayJobs();
    const activePublishedJobs = settledJobs.filter((job) => job.status === 'published');
    const failedJobs = settledJobs.filter((job) => job.status === 'failed');
    const passwordMap = await loadPasswords([...new Set(activePublishedJobs.map((job) => job.accountId))]);

    browser = await chromium.launch({ headless: true });

    const jobsByAccount = new Map<string, VerifiedJob[]>();
    for (const job of activePublishedJobs) {
      const group = jobsByAccount.get(job.accountId) ?? [];
      group.push(job);
      jobsByAccount.set(job.accountId, group);
    }

    const verifyResults = await Promise.all(
      [...jobsByAccount.entries()].map(async ([accountId, jobs]) =>
        verifyAccount(browser!, accountId, jobs[0].blogId, jobs[0].blogName, jobs, passwordMap),
      ),
    );

    const verifyByAccount = new Map(verifyResults.map((result) => [result.accountId, result]));
    const sheetResult = await upsertStatusRows(activePublishedJobs, verifyByAccount);

    const summary = {
      targetDate: TARGET_DATE,
      ref: TARGET_REF,
      service: TARGET_SERVICE,
      publishedAccounts: [...jobsByAccount.keys()].length,
      publishedJobs: activePublishedJobs.length,
      failedJobs: failedJobs.map((job) => ({
        accountId: job.accountId,
        keyword: job.keyword,
        status: job.status,
        error: job.error ?? '',
        scheduleId: job.scheduleId,
        jobId: job.jobId,
      })),
      accounts: verifyResults.map((result) => ({
        accountId: result.accountId,
        blogId: result.blogId,
        blogName: result.blogName,
        expectedKeywords: result.expectedKeywords,
        keywordHits: result.keywordHits,
        allKeywordsHit: result.keywordHits.length === result.expectedKeywords.length,
        titlesByKeyword: result.titlesByKeyword,
        debugTextPath: result.debugTextPath,
        screenshotPath: result.screenshotPath,
        error: result.error ?? null,
      })),
      sheet: sheetResult,
    };

    const summaryPath = path.join(OUTPUT_DIR, 'summary.json');
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
