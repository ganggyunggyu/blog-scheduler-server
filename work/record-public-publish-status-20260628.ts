import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import {
  readGoogleSheetValues,
  updateGoogleSheetValues,
} from '../src/services/google-sheets.service.js';

const STATUS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit#gid=817577400';
const STATUS_SHEET_GID = 817577400;
const TARGET_DATE = '2026-06-28';
const OUTPUT_DIR = path.resolve(process.cwd(), 'outputs', `public-publish-verify-${TARGET_DATE}`);

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
  postUrl?: string;
  completedAt?: Date | string;
  updatedAt?: Date | string;
}

interface AccountRow {
  accountId?: string;
  blogId?: string;
  nickname?: string;
  category?: string;
}

interface TargetJob {
  schedule: ScheduleRow;
  account: AccountRow;
  job: JobRow;
}

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
}

const args = process.argv.slice(2);

const getArg = (name: string, fallback = ''): string => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

const onlyServices = new Set(
  getArg('--services', [
    'pet-sheet-sunday-20260628',
    'goat-sheet-sunday-20260628',
    'default',
    'alibaba',
    'ophthalmology-sheet',
    'eye-brand-generated-makeup',
    'designated-daily',
  ].join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);
const rewriteRange = getArg('--rewrite-range', '');

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const decodeXml = (value: string): string =>
  value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gsu, '$1')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");

const normalizeUrl = (value: string): string => value.split('?')[0].replace(/\/$/u, '');

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

const formatKstFromDate = (value?: Date | string): string => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return parts.replace(' ', ' ');
};

const formatScheduleTime = (value?: string): string =>
  value ? `${value.slice(0, 10)} ${value.slice(11, 16)}` : '';

const fetchRss = async (blogId: string): Promise<RssItem[]> => {
  const response = await fetch(`https://rss.blog.naver.com/${blogId}.xml`);
  if (!response.ok) throw new Error(`RSS ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>(.*?)<\/item>/gsu)].map((match) => {
    const item = match[1] ?? '';
    const title = item.match(/<title>(.*?)<\/title>/su)?.[1] ?? '';
    const link = item.match(/<link>(.*?)<\/link>/su)?.[1] ?? '';
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/su)?.[1] ?? '';
    return {
      title: normalizeText(decodeXml(title)),
      link: normalizeText(decodeXml(link)),
      pubDate: normalizeText(decodeXml(pubDate)),
    };
  });
};

const findRssMatch = (items: RssItem[], job: JobRow): RssItem | undefined => {
  const keyword = normalizeText(job.keyword ?? '');
  const postUrl = normalizeUrl(job.postUrl ?? '');
  if (postUrl && /\/\d+$/u.test(postUrl)) {
    const byUrl = items.find((item) => normalizeUrl(item.link).includes(postUrl));
    if (byUrl) return byUrl;
  }
  if (!keyword) return undefined;
  return items.find((item) => item.title.includes(keyword));
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

const buildPublishedVerification = (job: JobRow, match?: RssItem): string => {
  if (match) return `공개 RSS 확인: ${match.pubDate} / ${normalizeUrl(match.link)}`;
  if (job.postUrl) return `DB postUrl 확인, RSS 매칭 누락: ${normalizeUrl(job.postUrl)}`;
  return 'published DB 확인, RSS/postUrl 누락';
};

const buildRow = (item: TargetJob, match?: RssItem): string[] => {
  const keyword = normalizeText(item.job.keyword ?? '');
  const failed = item.job.status === 'failed';
  const published = item.job.status === 'published';
  const actualTime = match?.pubDate
    ? formatKstFromDate(match.pubDate)
    : formatKstFromDate(item.job.completedAt ?? item.job.updatedAt) || formatScheduleTime(item.job.scheduledAt);

  return [
    TARGET_DATE,
    domainFor(item.schedule, item.account),
    normalizeText(item.account.nickname || item.schedule.accountId),
    item.schedule.accountId,
    keyword,
    failed ? '실패' : published ? '발행' : '진행중',
    `${item.schedule.service ?? 'unknown'} / ${published ? '즉시발행 또는 예약발행 공개확인' : '실패/미완료'}`,
    failed
      ? `DB 실패: ${normalizeText(item.job.error ?? '').slice(0, 180)}`
      : buildPublishedVerification(item.job, match),
    match?.title || keyword,
    actualTime,
    String(item.job.scheduleId),
    String(item.job._id),
  ];
};

const sheetKey = (row: string[]): string =>
  `${row[0] ?? ''}|${row[3] ?? ''}|${row[4] ?? ''}|${row[10] ?? ''}|${row[11] ?? ''}`;

const targetKey = (item: TargetJob): string => {
  const keyword = normalizeText(item.job.keyword ?? '');
  return `${TARGET_DATE}|${item.schedule.accountId}|${keyword}|${item.job.scheduleId}|${item.job._id}`;
};

const main = async (): Promise<void> => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });

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
    .find({
      scheduleId: { $in: schedules.map((schedule) => schedule._id) },
      scheduledAt: { $regex: `^${TARGET_DATE}` },
    }, {
      projection: {
        _id: 1,
        scheduleId: 1,
        keyword: 1,
        scheduledAt: 1,
        status: 1,
        error: 1,
        postUrl: 1,
        completedAt: 1,
        updatedAt: 1,
      },
    })
    .sort({ scheduledAt: 1, _id: 1 })
    .toArray();

  const targetJobs = jobs.flatMap((job) => {
    const schedule = scheduleById.get(String(job.scheduleId));
    if (!schedule) return [];
    const account = accountById.get(schedule.accountId) ?? { accountId: schedule.accountId, blogId: schedule.accountId };
    return [{ schedule, account, job }];
  });

  const rssByBlog = new Map<string, RssItem[]>();
  const verification = [];
  for (const account of accountById.values()) {
    const blogId = account.blogId || account.accountId;
    if (!blogId || rssByBlog.has(blogId)) continue;
    try {
      const items = await fetchRss(blogId);
      rssByBlog.set(blogId, items);
      verification.push({ blogId, rssItems: items.slice(0, 8) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rssByBlog.set(blogId, []);
      verification.push({ blogId, error: message });
    }
  }

  const existing = await readGoogleSheetValues({
    spreadsheet: STATUS_SHEET_URL,
    gid: STATUS_SHEET_GID,
    range: rewriteRange || 'A:L',
  });

  const allRowsByKey = new Map(targetJobs.map((item) => {
    const blogId = item.account.blogId || item.schedule.accountId;
    const match = item.job.status === 'published'
      ? findRssMatch(rssByBlog.get(blogId) ?? [], item.job)
      : undefined;
    return [targetKey(item), buildRow(item, match)] as const;
  }));

  const rows = rewriteRange
    ? existing.values.map((row) => allRowsByKey.get(sheetKey(row)) ?? row)
    : targetJobs.flatMap((item) => {
      const existingAll = existing.values.slice(1).map(sheetKey);
      if (new Set(existingAll).has(targetKey(item))) return [];
      return [allRowsByKey.get(targetKey(item)) ?? []];
    }).filter((row) => row.length > 0);

  let sheetResult = { updatedRange: '', updatedRows: 0 };
  if (rows.length > 0) {
    const startRow = findFirstEmptyRow(existing.values);
    const range = rewriteRange || `A${startRow}:L${startRow + rows.length - 1}`;
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
    rowCount: rows.length,
    sheetResult,
    verification,
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    targetDate: TARGET_DATE,
    services: [...onlyServices],
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
