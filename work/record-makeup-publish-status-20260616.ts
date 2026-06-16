import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import {
  readGoogleSheetValues,
  updateGoogleSheetValues,
} from '../src/services/google-sheets.service.js';

interface PlanItem {
  keyword: string;
  scheduledAt: string;
  slot: number;
}

interface PlanAccount {
  accountId: string;
  blogId: string;
  blogName: string;
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

interface VerifyResult {
  domain: string;
  accountId: string;
  blogName: string;
  scheduleId: string;
  reserveButtonText: string;
  popupTotalText: string;
  expectedKeywords: string[];
  keywordHits: string[];
  expectedTimes: string[];
  timeHits: string[];
  debugTextPath: string;
  error?: string;
}

interface VerifyFile {
  results: VerifyResult[];
}

interface JobStatus {
  _id: string;
  scheduleId: string;
  keyword: string;
  scheduledAt: string;
  status: string;
  error?: string;
}

const STATUS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oUo85a9m3MTTzWeX8FGnKZqCDfPRNdGZFxr4-vZqSrM/edit#gid=817577400';
const STATUS_SHEET_GID = 817577400;

const args = process.argv.slice(2);
const getArg = (flag: string, fallback = ''): string => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

const planPath = path.resolve(process.cwd(), getArg('--plan', 'work/makeup-schedule-2026-06-16-1781617159036.json'));
const verifyPath = getArg('--verify');

if (!verifyPath) {
  throw new Error('--verify result json is required');
}

const domainNames: Record<string, string> = {
  eye: '안과',
  pet: '애견',
  brand: '안과브랜드',
};

const formatScheduleTime = (value: string): string =>
  `${value.slice(0, 4)}.${value.slice(5, 7)}.${value.slice(8, 10)} ${value.slice(11, 16)}`;

const formatScheduleDate = (value: string): string => value.slice(0, 10);

const compactName = (value: string): string => value.replace(/\s+/g, '');

const buildScheduleIdByAccount = (plan: PlanShape): Map<string, string> => {
  const map = new Map<string, string>();
  for (const [domainKey, submission] of Object.entries(plan.submissions)) {
    const accounts = plan.domains[domainKey] ?? [];
    for (let index = 0; index < submission.schedules.length; index += 1) {
      const account = accounts[index];
      const schedule = submission.schedules[index];
      if (account && schedule) map.set(account.accountId, schedule.scheduleId);
    }
  }
  return map;
};

const buildJobMap = (plan: PlanShape): Map<string, { scheduleId: string; jobId: string }> => {
  const map = new Map<string, { scheduleId: string; jobId: string }>();
  for (const submission of Object.values(plan.submissions)) {
    for (const schedule of submission.schedules) {
      for (const job of schedule.jobs) {
        map.set(`${schedule.scheduleId}:${job.keyword}:${job.scheduledAt}`, {
          scheduleId: schedule.scheduleId,
          jobId: job.id,
        });
      }
    }
  }
  return map;
};

const findFirstEmptyRow = (values: string[][]): number => {
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    const hasContent = row.slice(0, 12).some((cell) => cell && cell.trim() !== '');
    if (!hasContent) return index + 1;
  }
  return values.length + 1;
};

const loadJobStatuses = async (jobIds: string[]): Promise<Map<string, JobStatus>> => {
  const rows = await mongoose.connection.db.collection('schedulejobs')
    .find({ _id: { $in: jobIds } }, {
      projection: { _id: 1, scheduleId: 1, keyword: 1, scheduledAt: 1, status: 1, error: 1 },
    })
    .toArray();

  const map = new Map<string, JobStatus>();
  for (const row of rows) {
    map.set(String(row._id), {
      _id: String(row._id),
      scheduleId: String(row.scheduleId),
      keyword: String(row.keyword ?? ''),
      scheduledAt: String(row.scheduledAt ?? ''),
      status: String(row.status ?? ''),
      error: row.error ? String(row.error) : undefined,
    });
  }
  return map;
};

const loadDebugText = async (debugTextPath: string): Promise<string> => {
  try {
    return await fs.readFile(debugTextPath, 'utf8');
  } catch {
    return '';
  }
};

const extractTitle = (debugText: string, keyword: string): string => {
  const [, popupText = debugText] = debugText.split(/\n\n/u);
  const lines = popupText
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const candidate = lines.find((line) =>
    line.includes(keyword)
    && !line.startsWith('expected=')
    && !line.startsWith('url=')
    && !line.startsWith('title=')
    && line.length <= 140,
  );

  return candidate ?? keyword;
};

const buildCheckSummary = (verify: VerifyResult | undefined): string => {
  if (!verify) return '실확인 결과 없음';
  if (verify.error) return `실확인 실패: ${verify.error}`;

  const keywordFull = verify.keywordHits.length === verify.expectedKeywords.length;
  const timeFull = verify.timeHits.length === verify.expectedTimes.length;
  const base = [
    verify.reserveButtonText || '예약 목록',
    verify.popupTotalText || '총수 미확인',
  ].join(' / ');

  if (keywordFull && timeFull) return `${base} / 키워드·시간 확인`;
  return `${base} / 키워드 ${verify.keywordHits.length}/${verify.expectedKeywords.length}, 시간 ${verify.timeHits.length}/${verify.expectedTimes.length} 확인`;
};

const buildMode = (domainKey: string): string => {
  if (domainKey === 'brand') return '브랜드 로컬 / 오늘 3건 / 23:30-23:50';
  return '시트 보정 / 오늘 3건 / 23:30-23:50';
};

const main = async (): Promise<void> => {
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8')) as PlanShape;
  const verifyFile = JSON.parse(await fs.readFile(path.resolve(process.cwd(), verifyPath), 'utf8')) as VerifyFile;
  const verifyByAccount = new Map(verifyFile.results.map((result) => [result.accountId, result]));
  const scheduleIdByAccount = buildScheduleIdByAccount(plan);
  const jobMap = buildJobMap(plan);
  const jobIds = [...jobMap.values()].map((item) => item.jobId);

  await mongoose.connect(env.MONGO_URI);
  const jobStatuses = await loadJobStatuses(jobIds);
  await mongoose.disconnect();

  const rows: string[][] = [];
  const debugTextByAccount = new Map<string, string>();

  for (const [domainKey, accounts] of Object.entries(plan.domains)) {
    for (const account of accounts) {
      const verify = verifyByAccount.get(account.accountId);
      if (verify && !debugTextByAccount.has(account.accountId)) {
        debugTextByAccount.set(account.accountId, await loadDebugText(verify.debugTextPath));
      }
      const checkSummary = buildCheckSummary(verify);
      const debugText = debugTextByAccount.get(account.accountId) ?? '';

      for (const item of account.items) {
        const scheduleId = scheduleIdByAccount.get(account.accountId) ?? '';
        const ids = jobMap.get(`${scheduleId}:${item.keyword}:${item.scheduledAt}`);
        const jobStatus = ids ? jobStatuses.get(ids.jobId) : undefined;
        const isUiHit = verify?.keywordHits.includes(item.keyword) && verify.timeHits.includes(item.scheduledAt.slice(11, 16));
        const status = jobStatus?.status === 'failed'
          ? '실패'
          : jobStatus?.status === 'published' && isUiHit
            ? '예약'
            : jobStatus?.status === 'published'
              ? '예약'
              : '진행중';

        rows.push([
          formatScheduleDate(item.scheduledAt),
          domainNames[domainKey] ?? domainKey,
          compactName(account.blogName),
          account.accountId,
          item.keyword,
          status,
          buildMode(domainKey),
          checkSummary,
          extractTitle(debugText, item.keyword),
          formatScheduleTime(item.scheduledAt),
          ids?.scheduleId ?? '',
          ids?.jobId ?? '',
        ]);
      }
    }
  }

  const existing = await readGoogleSheetValues({
    spreadsheet: STATUS_SHEET_URL,
    gid: STATUS_SHEET_GID,
    range: 'A:L',
  });
  const startRow = findFirstEmptyRow(existing.values);
  const range = `A${startRow}:L${startRow + rows.length - 1}`;
  const result = await updateGoogleSheetValues({
    spreadsheet: STATUS_SHEET_URL,
    gid: STATUS_SHEET_GID,
    range,
    values: rows,
  });

  console.log(JSON.stringify({
    rowCount: rows.length,
    range,
    updatedRange: result.updatedRange,
    updatedRows: result.updatedRows,
  }, null, 2));
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
