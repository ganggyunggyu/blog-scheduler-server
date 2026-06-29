import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { chromium, type BrowserContext, type Frame, type Page } from 'playwright';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import { normalizeSessionCookies } from '../src/lib/naver-editor/cookies.js';
import {
  readGoogleSheetValues,
  updateGoogleSheetValues,
} from '../src/services/google-sheets.service.js';
import { getValidCookies, naverLogin } from '../src/services/naver-auth.service.js';
import { getSession } from '../src/services/session.service.js';

interface ManifestItem {
  keyword: string;
  title: string;
  scheduledAt: string;
  slot: number;
}

interface ScheduleJobRow {
  _id: string;
  keyword: string;
  scheduledAt: string;
  slot: number;
  status: string;
  publishJobId?: string;
}

interface VerifySummary {
  reserveButtonText: string;
  popupTotalText: string;
  popupText: string;
  screenshotPath: string;
  debugTextPath: string;
}

interface SheetWriteSummary {
  ranges: string[];
  updatedRows: number;
}

const ACCOUNT_ID = 'adplan3th';
const BLOG_ID = 'adplan3th';
const BLOG_NAME = '에스앤비안과 브랜드';
const SCHEDULE_ID = 'sch_76409084-e8e4-4dd3-b3bf-2954f92e2d1f';
const MANIFEST_PATH = path.resolve('work/eye-brand-week-20260630/manifest.json');
const OUTPUT_DIR = path.resolve('outputs/eye-brand-week-verify-20260630');
const STATUS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit?gid=0#gid=0';
const STATUS_SHEET_GID = 0;
const MODE_LABEL = 'eye-brand weekly local generated / mode 3';

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

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

const clickReserveButton = async (page: Page): Promise<void> => {
  const clickInFrame = async (frame: Frame): Promise<boolean> => {
    const button = frame.locator('button.reserve_btn__Km5Xh').first();
    if (await button.count().catch(() => 0) > 0) {
      await button.click({ timeout: 5000, force: true });
      return true;
    }

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

  const viewport = page.viewportSize();
  if (viewport) {
    await page.mouse.click(viewport.width - 229, 22);
    return;
  }

  throw new Error('reserve button not found');
};

const closeEditorOverlays = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape').catch(() => undefined);
  for (const frame of page.frames()) {
    await frame.locator('button.se-help-panel-close-button')
      .click({ timeout: 2000, force: true })
      .catch(() => undefined);
  }
  const viewport = page.viewportSize();
  if (viewport) {
    await page.mouse.click(viewport.width - 42, 42).catch(() => undefined);
  }
  await page.waitForTimeout(1500);
};

const findReserveButtonText = async (page: Page): Promise<string> => {
  const text = await getTextFromFrames(page);
  const match = text.match(/예약\s*발행\s*\d+\s*건/u);
  return match?.[0] ? normalizeText(match[0]) : '';
};

const getCookies = async (): Promise<unknown[]> => {
  const cached = await getSession(ACCOUNT_ID);
  if (cached) {
    return cached;
  }

  const password = process.env.NAVER_BRAND_PASSWORD;
  if (!password) {
    throw new Error('NAVER_BRAND_PASSWORD 없음');
  }

  const validated = await getValidCookies(ACCOUNT_ID, password);
  if (validated.cookies.length > 0) {
    return validated.cookies;
  }

  const login = await naverLogin(ACCOUNT_ID, password);
  if (!login.success) {
    throw new Error(login.message);
  }
  return login.cookies;
};

const loadManifestItems = async (): Promise<ManifestItem[]> => {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as { items?: ManifestItem[] };
  return manifest.items ?? [];
};

const loadJobs = async (): Promise<ScheduleJobRow[]> => {
  const rows = await mongoose.connection.db?.collection<ScheduleJobRow>('schedulejobs')
    .find(
      { scheduleId: SCHEDULE_ID },
      { projection: { _id: 1, keyword: 1, scheduledAt: 1, slot: 1, status: 1, publishJobId: 1 } },
    )
    .sort({ scheduledAt: 1, slot: 1 })
    .toArray();
  return rows ?? [];
};

const verifyNaverUi = async (): Promise<VerifySummary> => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const debugTextPath = path.join(OUTPUT_DIR, 'adplan3th-reservations.txt');
  const screenshotPath = path.join(OUTPUT_DIR, 'adplan3th-reservations.png');

  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addCookies(normalizeSessionCookies(await getCookies()));

    const page = await context.newPage();
    await page.goto(`https://blog.naver.com/${BLOG_ID}?Redirect=Write&`, {
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

    const targetPage = popupPage ?? page;
    const popupText = await getTextFromFrames(targetPage);
    const popupTotalText = popupText.match(/총\s*\d+\s*개/u)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';
    await fs.writeFile(debugTextPath, popupText, 'utf8');
    await targetPage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

    return {
      reserveButtonText,
      popupTotalText,
      popupText,
      screenshotPath,
      debugTextPath,
    };
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};

const formatDateTime = (scheduledAt: string): string =>
  `${scheduledAt.slice(0, 10)} ${scheduledAt.slice(11, 16)}`;

const timePatterns = (scheduledAt: string): string[] => {
  const date = scheduledAt.slice(0, 10);
  const [year, month, day] = date.split('-');
  const time = scheduledAt.slice(11, 16);
  return [
    `${date} ${time}`,
    `${year}.${month}.${day} ${time}`,
    `${year}.${month}.${day}. ${time}`,
    `${month}.${day} ${time}`,
    `${month}.${day}. ${time}`,
    `${Number(month)}.${Number(day)} ${time}`,
    `${Number(month)}.${Number(day)}. ${time}`,
    time,
  ];
};

const buildVerificationText = (
  summary: VerifySummary,
  item: ManifestItem,
): string => {
  const titleOk = summary.popupText.includes(item.title);
  const keywordOk = summary.popupText.includes(item.keyword);
  const timeOk = timePatterns(item.scheduledAt).some((pattern) => summary.popupText.includes(pattern));
  const countOk = /예약\s*발행\s*15\s*건/u.test(summary.reserveButtonText) || /총\s*15\s*개/u.test(summary.popupTotalText);

  return [
    summary.reserveButtonText || '예약버튼 미확인',
    summary.popupTotalText || '총수 미확인',
    `count ${countOk ? '확인' : '부분확인'}`,
    `title ${titleOk ? '확인' : '누락'}`,
    `keyword ${keywordOk ? '확인' : '누락'}`,
    `time ${timeOk ? '확인' : '누락'}`,
  ].join(' / ');
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
  jobs: ScheduleJobRow[],
  items: ManifestItem[],
  summary: VerifySummary,
): Promise<SheetWriteSummary> => {
  const itemByKeyword = new Map(items.map((item) => [item.keyword, item]));
  const existing = await readGoogleSheetValues({
    spreadsheet: STATUS_SHEET_URL,
    gid: STATUS_SHEET_GID,
    range: 'A:L',
  });
  const existingRowsByKey = new Map(
    existing.values
      .slice(1)
      .map((row, index): [string, number] => [
        `${row[0] ?? ''}|${row[3] ?? ''}|${row[4] ?? ''}|${row[10] ?? ''}|${row[11] ?? ''}`,
        index + 2,
      ]),
  );

  const rows = jobs.flatMap((job) => {
    const item = itemByKeyword.get(job.keyword);
    if (!item) {
      return [];
    }
    const date = job.scheduledAt.slice(0, 10);
    const rowKey = `${date}|${ACCOUNT_ID}|${job.keyword}|${SCHEDULE_ID}|${job._id}`;
    return [{
      rowNumber: existingRowsByKey.get(rowKey),
      values: [
        date,
        '안과브랜드',
        BLOG_NAME,
        ACCOUNT_ID,
        job.keyword,
        job.status === 'published' ? '예약' : '실패',
        MODE_LABEL,
        buildVerificationText(summary, item),
        item.title,
        formatDateTime(job.scheduledAt),
        SCHEDULE_ID,
        job._id,
      ],
    }];
  });

  if (rows.length === 0) {
    return { ranges: [], updatedRows: 0 };
  }

  const ranges: string[] = [];
  let updatedRows = 0;
  const existingRows = rows
    .filter((row): row is { rowNumber: number; values: string[] } => row.rowNumber !== undefined)
    .sort((a, b) => a.rowNumber - b.rowNumber);
  const newRows = rows
    .filter((row): row is { rowNumber: undefined; values: string[] } => row.rowNumber === undefined)
    .map((row) => row.values);

  for (let index = 0; index < existingRows.length;) {
    const group = [existingRows[index]];
    index += 1;
    while (
      index < existingRows.length
      && existingRows[index].rowNumber === group[group.length - 1].rowNumber + 1
    ) {
      group.push(existingRows[index]);
      index += 1;
    }

    const range = `A${group[0].rowNumber}:L${group[group.length - 1].rowNumber}`;
    const result = await updateGoogleSheetValues({
      spreadsheet: STATUS_SHEET_URL,
      gid: STATUS_SHEET_GID,
      range,
      values: group.map((row) => row.values),
    });
    ranges.push(result.updatedRange);
    updatedRows += result.updatedRows;
  }

  if (newRows.length > 0) {
    const startRow = findFirstEmptyRow(existing.values);
    const range = `A${startRow}:L${startRow + newRows.length - 1}`;
    const result = await updateGoogleSheetValues({
      spreadsheet: STATUS_SHEET_URL,
      gid: STATUS_SHEET_GID,
      range,
      values: newRows,
    });
    ranges.push(result.updatedRange);
    updatedRows += result.updatedRows;
  }

  return { ranges, updatedRows };
};

const main = async (): Promise<void> => {
  await mongoose.connect(env.MONGO_URI);
  try {
    const [items, jobs] = await Promise.all([
      loadManifestItems(),
      loadJobs(),
    ]);
    if (jobs.length !== 15) {
      throw new Error(`예상 job 15건, 실제 ${jobs.length}건`);
    }
    if (!jobs.every((job) => job.status === 'published')) {
      throw new Error(`미완료 job 존재: ${jobs.map((job) => `${job.keyword}:${job.status}`).join(', ')}`);
    }

    const summary = await verifyNaverUi();
    const sheet = await appendStatusRows(jobs, items, summary);

    console.log(JSON.stringify({
      scheduleId: SCHEDULE_ID,
      reserveButtonText: summary.reserveButtonText,
      popupTotalText: summary.popupTotalText,
      debugTextPath: summary.debugTextPath,
      screenshotPath: summary.screenshotPath,
      verifiedTitles: items.filter((item) => summary.popupText.includes(item.title)).length,
      verifiedKeywords: items.filter((item) => summary.popupText.includes(item.keyword)).length,
      sheet,
    }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
