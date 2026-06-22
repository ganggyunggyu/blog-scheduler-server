import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose, { type Types } from 'mongoose';
import { chromium, type BrowserContext, type Frame, type Page } from 'playwright';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import { normalizeSessionCookies } from '../src/lib/naver-editor/cookies.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import {
  readGoogleSheetValues,
  updateGoogleSheetValues,
} from '../src/services/google-sheets.service.js';

const TARGET_DATE = '2026-06-23';
const ACCOUNT_ID = 'adplan3th';
const STATUS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit?gid=0#gid=0';
const STATUS_SHEET_GID = 0;
const MODE_LABEL = 'eye-sheet auto / brand mode 3';
const OUTPUT_DIR = path.resolve(process.cwd(), 'outputs', `eye-brand-verify-${TARGET_DATE}`);

interface ScheduleRow {
  _id: Types.ObjectId;
  accountId: string;
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

interface VerifyResult {
  reserveButtonText: string;
  popupTotalText: string;
  expectedKeywords: string[];
  expectedTimes: string[];
  combinedHits: string[];
  postHits: string[];
  reserveHits: string[];
  reserveTimeHits: string[];
  postText: string;
  reserveText: string;
}

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const formatActualTime = (scheduledAt: string): string =>
  `${scheduledAt.slice(0, 10)} ${scheduledAt.slice(11, 16)}`;

const getTextFromFrames = async (page: Page): Promise<string> => {
  const texts: string[] = [];
  for (const frame of page.frames()) {
    try {
      texts.push(await frame.locator('body').innerText({ timeout: 3_000 }));
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

const closeEditorOverlays = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape').catch(() => undefined);
  const viewport = page.viewportSize();
  if (viewport) {
    await page.mouse.click(viewport.width - 42, 42).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }
  await page.waitForTimeout(1_500);
};

const loadBrandJobs = async (): Promise<VerifiedJob[]> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Mongo connection is not ready');
  }

  const schedules = await db.collection<ScheduleRow>('schedules')
    .find(
      {
        accountId: ACCOUNT_ID,
        status: { $ne: 'cancelled' },
      },
      { projection: { _id: 1, accountId: 1 } },
    )
    .toArray();

  const scheduleIds = schedules.map((schedule) => schedule._id);
  if (scheduleIds.length === 0) {
    throw new Error('brand schedules not found');
  }

  const jobs = await db.collection<JobRow>('schedulejobs')
    .find(
      {
        scheduleId: { $in: scheduleIds },
        scheduledAt: { $regex: `^${TARGET_DATE}` },
        status: 'published',
      },
      { projection: { _id: 1, scheduleId: 1, keyword: 1, scheduledAt: 1, slot: 1, status: 1, error: 1 } },
    )
    .sort({ scheduledAt: 1, slot: 1, _id: 1 })
    .toArray();

  return jobs.map((job) => ({
    scheduleId: String(job.scheduleId),
    jobId: String(job._id),
    accountId: ACCOUNT_ID,
    blogId: ACCOUNT_ID,
    blogName: '에스앤비안과 브랜드',
    keyword: String(job.keyword ?? ''),
    scheduledAt: String(job.scheduledAt ?? ''),
    slot: Number(job.slot ?? 0),
    status: String(job.status ?? ''),
    error: job.error ? String(job.error) : undefined,
  }));
};

const verifyBrand = async (jobs: VerifiedJob[]): Promise<VerifyResult> => {
  const expectedKeywords = jobs.map((job) => job.keyword);
  const expectedTimes = jobs.map((job) => job.scheduledAt.slice(11, 16));
  const auth = await getValidCookies(ACCOUNT_ID, process.env.NAVER_BRAND_PASSWORD ?? '');
  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addCookies(normalizeSessionCookies(auth.cookies));

    const postPage = await context.newPage();
    await postPage.goto(`https://blog.naver.com/PostList.naver?blogId=${ACCOUNT_ID}&from=postList`, {
      waitUntil: 'domcontentloaded',
      timeout: env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
    });
    await postPage.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await postPage.waitForTimeout(5_000);
    const postText = await getTextFromFrames(postPage);

    const page = await context.newPage();
    await page.goto(`https://blog.naver.com/${ACCOUNT_ID}?Redirect=Write&`, {
      waitUntil: 'domcontentloaded',
      timeout: env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(5_000);
    await closeEditorOverlays(page);

    const reserveButtonText = (await getTextFromFrames(page)).match(/예약\s*발행\s*\d+\s*건/u)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';
    const popupPromise = context.waitForEvent('page', { timeout: 5_000 }).catch(() => null);
    await clickReserveButton(page);
    const popupPage = await popupPromise;
    if (popupPage) {
      await popupPage.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(7_000);

    const reserveText = await getTextFromFrames(popupPage ?? page);
    const combinedText = `${postText}\n${reserveText}`;
    const result: VerifyResult = {
      reserveButtonText,
      popupTotalText: reserveText.match(/총\s*\d+\s*개/u)?.[0]?.replace(/\s+/g, ' ').trim() ?? '',
      expectedKeywords,
      expectedTimes,
      combinedHits: expectedKeywords.filter((keyword) => combinedText.includes(keyword)),
      postHits: expectedKeywords.filter((keyword) => postText.includes(keyword)),
      reserveHits: expectedKeywords.filter((keyword) => reserveText.includes(keyword)),
      reserveTimeHits: expectedTimes.filter((time) => reserveText.includes(time)),
      postText,
      reserveText,
    };

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(
      path.join(OUTPUT_DIR, 'adplan3th.txt'),
      ['[POSTLIST]', postText, '', '[RESERVE]', reserveText].join('\n'),
      'utf8',
    );
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'adplan3th.png'), fullPage: true }).catch(() => undefined);

    return result;
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};

const buildVerificationText = (verify: VerifyResult, keyword: string, time: string): string => {
  const inReserveList = verify.reserveHits.includes(keyword);
  const reserveTimeOk = verify.reserveTimeHits.includes(time);
  if (inReserveList && reserveTimeOk) {
    return `${verify.reserveButtonText || '예약 목록'} / ${verify.popupTotalText || '총수 미확인'} / 예약 키워드·시간 확인`;
  }
  return `${verify.reserveButtonText || '예약 목록'} / ${verify.popupTotalText || '총수 미확인'} / 예약 목록 일부 누락`;
};

const extractTitleForKeyword = (verify: VerifyResult, keyword: string): string => {
  const lines = `${verify.postText}\n${verify.reserveText}`
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  return lines.find((line) => line.includes(keyword) && line.length <= 140) ?? keyword;
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

const appendBrandRows = async (jobs: VerifiedJob[], verify: VerifyResult): Promise<{ range: string; updatedRows: number }> => {
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
    const rowKey = `${TARGET_DATE}|${job.accountId}|${job.keyword}|${job.scheduleId}|${job.jobId}`;
    if (existingKeys.has(rowKey)) {
      return [];
    }
    const reservationTime = job.scheduledAt.slice(11, 16);
    return [[
      TARGET_DATE,
      '안과',
      job.blogName,
      job.accountId,
      job.keyword,
      '예약/발행완료',
      MODE_LABEL,
      buildVerificationText(verify, job.keyword, reservationTime),
      extractTitleForKeyword(verify, job.keyword),
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
  if (!process.env.NAVER_BRAND_PASSWORD) {
    throw new Error('NAVER_BRAND_PASSWORD is required');
  }

  await mongoose.connect(env.MONGO_URI);

  try {
    const jobs = await loadBrandJobs();
    const verify = await verifyBrand(jobs);
    const sheetResult = await appendBrandRows(jobs, verify);
    const summaryPath = path.join(OUTPUT_DIR, 'summary.json');
    await fs.writeFile(summaryPath, JSON.stringify({ jobs, verify, sheetResult }, null, 2));
    console.log(JSON.stringify({ summaryPath, sheetResult, verify }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
