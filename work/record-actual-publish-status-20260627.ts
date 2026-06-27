import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import {
  readGoogleSheetValues,
  updateGoogleSheetValues,
} from '../src/services/google-sheets.service.js';

const STATUS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit#gid=817577400';
const STATUS_SHEET_GID = 817577400;
const TARGET_DATE = '2026-06-27';
const OUTPUT_DIR = path.resolve(process.cwd(), 'outputs', `actual-publish-status-${TARGET_DATE}`);

interface ScheduleRow {
  _id: string;
  accountId: string;
  service?: string;
}

interface JobRow {
  _id: string;
  scheduleId: string;
  keyword?: string;
  scheduledAt?: string;
  status?: string;
  postUrl?: string;
  error?: string;
}

interface AccountRow {
  accountId?: string;
  blogId?: string;
  nickname?: string;
  category?: string;
}

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
}

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const compact = (value: string): string => normalizeText(value).replace(/\s+/g, '');

const stripRss = (value: string): string =>
  value.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').trim();

const extractTag = (block: string, tag: string): string =>
  stripRss(block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? '');

const fetchRssItems = async (blogId: string): Promise<RssItem[]> => {
  const response = await fetch(`https://rss.blog.naver.com/${blogId}.xml`);
  if (!response.ok) {
    throw new Error(`RSS ${response.status}`);
  }
  const xml = await response.text();
  return [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map((match) => ({
    title: extractTag(match[0], 'title'),
    link: extractTag(match[0], 'link'),
    pubDate: extractTag(match[0], 'pubDate'),
  }));
};

const extractLogNo = (url?: string): string => {
  if (!url) return '';
  return url.match(/\/(\d{6,})(?:\?|$)/)?.[1] ?? '';
};

const matchRssItem = (items: RssItem[], job: JobRow): RssItem | undefined => {
  const logNo = extractLogNo(job.postUrl);
  if (logNo) {
    const byLogNo = items.find((item) => item.link.includes(logNo));
    if (byLogNo) return byLogNo;
  }

  const keyword = normalizeText(job.keyword ?? '');
  if (!keyword) return undefined;
  const compactKeyword = compact(keyword);
  return items.find((item) => compact(item.title).includes(compactKeyword));
};

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

const modeFor = (schedule: ScheduleRow): string =>
  `${schedule.service ?? 'unknown'} / 27일 즉시 발행`;

const formatPubDate = (pubDate: string, fallback?: string): string => {
  if (!pubDate) return fallback ? `${fallback.slice(0, 10)} ${fallback.slice(11, 16)}` : '';
  const parsed = new Date(pubDate);
  if (Number.isNaN(parsed.getTime())) return pubDate;
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(parsed).replace(' ', ' ');
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

  const schedules = await db.collection<ScheduleRow>('schedules')
    .find({ scheduleDate: TARGET_DATE }, { projection: { _id: 1, accountId: 1, service: 1 } })
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
      projection: {
        _id: 1,
        scheduleId: 1,
        keyword: 1,
        scheduledAt: 1,
        status: 1,
        postUrl: 1,
        error: 1,
      },
    })
    .sort({ scheduleId: 1, scheduledAt: 1, _id: 1 })
    .toArray();

  await mongoose.disconnect();

  const rssByBlogId = new Map<string, RssItem[]>();
  const rssErrors = new Map<string, string>();
  for (const schedule of schedules) {
    const account = accountById.get(schedule.accountId);
    const blogId = account?.blogId || schedule.accountId;
    if (rssByBlogId.has(blogId) || rssErrors.has(blogId)) continue;
    try {
      rssByBlogId.set(blogId, await fetchRssItems(blogId));
    } catch (error) {
      rssErrors.set(blogId, error instanceof Error ? error.message : String(error));
    }
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

  const summary: Array<Record<string, string>> = [];
  const rows: string[][] = [];
  for (const job of jobs) {
    const schedule = scheduleById.get(String(job.scheduleId));
    if (!schedule) continue;
    const account = accountById.get(schedule.accountId);
    const blogId = account?.blogId || schedule.accountId;
    const sheetKey = `${TARGET_DATE}|${schedule.accountId}|${job.keyword ?? ''}|${job.scheduleId}|${job._id}`;
    if (existingKeys.has(sheetKey)) continue;

    const items = rssByBlogId.get(blogId) ?? [];
    const rssMatch = job.status === 'published' ? matchRssItem(items, job) : undefined;
    const rssError = rssErrors.get(blogId);
    const status = job.status === 'published'
      ? rssMatch ? '발행완료' : '발행완료'
      : job.status === 'failed' ? '실패' : '진행중';
    const verification = job.status === 'published'
      ? rssMatch
        ? `RSS 확인 / ${rssMatch.link}`
        : rssError
          ? `RSS 확인 실패: ${rssError}`
          : 'RSS 최신목록 키워드 매칭 실패'
      : job.error
        ? `DB 실패: ${normalizeText(job.error).slice(0, 180)}`
        : `DB 상태: ${job.status ?? 'unknown'}`;

    rows.push([
      TARGET_DATE,
      domainFor(schedule, account),
      normalizeText(account?.nickname || schedule.accountId),
      schedule.accountId,
      normalizeText(job.keyword ?? ''),
      status,
      modeFor(schedule),
      verification,
      rssMatch?.title || normalizeText(job.keyword ?? ''),
      formatPubDate(rssMatch?.pubDate ?? '', job.scheduledAt),
      String(job.scheduleId),
      String(job._id),
    ]);

    summary.push({
      accountId: schedule.accountId,
      keyword: normalizeText(job.keyword ?? ''),
      status,
      rss: rssMatch ? 'hit' : job.status === 'published' ? 'miss' : '',
      title: rssMatch?.title ?? '',
      time: formatPubDate(rssMatch?.pubDate ?? '', job.scheduledAt),
    });
  }

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

  const summaryPath = path.join(OUTPUT_DIR, 'summary.json');
  await fs.writeFile(summaryPath, JSON.stringify({
    targetDate: TARGET_DATE,
    totalJobs: jobs.length,
    rowsPrepared: rows.length,
    sheetResult,
    summary,
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    targetDate: TARGET_DATE,
    totalJobs: jobs.length,
    rowsPrepared: rows.length,
    sheetUpdatedRows: sheetResult.updatedRows,
    sheetRange: sheetResult.updatedRange,
    summaryPath,
    rssMisses: summary.filter((item) => item.rss === 'miss').length,
  }, null, 2));
};

main().catch(async (error: unknown) => {
  await mongoose.disconnect().catch(() => undefined);
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
