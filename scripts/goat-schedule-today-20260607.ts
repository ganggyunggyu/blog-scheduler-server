import 'dotenv/config';
import mongoose from 'mongoose';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';
import { buildScheduleGenerateJobId } from '../src/services/schedule-idempotency.service.js';
import { calculateSchedule, formatKst } from '../src/services/schedule.service.js';
import { getGenerateQueue, getPublishQueue, closeAllQueues } from '../src/queues/queue-manager.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const SHEET_GID = '1025121967';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const SCHEDULE_DATE = '2026-06-07';
const SCHEDULE_MODE = '2';
const POSTS_PER_ACCOUNT = 2;
const SERVICE = 'goat-today-20260607';
const REF = 'strict-root-unique';
const IMAGE_COUNT = 5;
const DELAY_BETWEEN_POSTS_SECONDS = 180;
const MONITOR_INTERVAL_MS = 30_000;
const MONITOR_TIMEOUT_MS = 4 * 60 * 60 * 1000;

interface AccountRecord {
  accountId: string;
  password: string;
  nickname?: string;
  blogId?: string;
}

interface BlogAccountRecord {
  accountId: string;
  nickname?: string;
  blogId?: string;
  category?: string;
  isEnabled?: boolean;
}

interface ResolvedAccount {
  id: string;
  password: string;
  blogId: string;
  displayName: string;
}

const ACCOUNT_ORDER = ['빨간모자앤', '건강박사석사1', '긍정이백퍼1', '도도1', '소원1', '오세아니야1', '포비1'];
const FORBIDDEN_ROOTS = ['수족냉증', '손발', '손끝'];

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows;
};

const normalizeDisplayName = (nickname: string): string => {
  const compact = nickname.replace(/\s+/g, '');
  if (compact.startsWith('빨간모자앤')) {
    return '빨간모자앤';
  }
  return compact;
};

const normalizeKeyword = (keyword: string): string =>
  keyword.replace(/\s+/g, '').toLowerCase();

const rootOf = (keyword: string): string => {
  const normalized = normalizeKeyword(keyword);
  const roots = [
    '비타민b12',
    '십전대보탕',
    '보중익기탕',
    '레이노증후군',
    '당화혈색소',
    '중성지방',
    '고콜레스테롤',
    '콜레스테롤',
    '혈액순환',
    '소양인',
    '소음인',
    '임산부',
    '흑염소',
    '염소',
    '관절',
    '빈혈',
    '당뇨',
    '고혈압',
    '간수치',
    '숙취',
    '면역력',
    '감초',
    '키성장',
    '공진단',
    '녹용',
    '황기',
    '백출',
    '복령',
    '영지버섯',
    '기력',
    '만성피로',
    '골밀도',
    '눈떨림',
  ];
  return roots.find((root) => normalized.includes(root)) ?? normalized.slice(0, 5);
};

const isAllowed = (keyword: string): boolean => {
  const normalized = normalizeKeyword(keyword);
  return !FORBIDDEN_ROOTS.some((root) => normalized.includes(root));
};

const fetchSheetKeywords = async (): Promise<string[]> => {
  const response = await fetch(SHEET_CSV_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cache-Control': 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`sheet fetch failed: ${response.status}`);
  }

  const rows = parseCsv(await response.text());
  const keywords: string[] = [];
  const seen = new Set<string>();

  for (const [index, row] of rows.entries()) {
    if (index === 0) {
      continue;
    }
    const keyword = row[0]?.trim() ?? '';
    const exposed = row[3]?.trim() ?? '';
    const newLogic = row[6]?.trim().toLowerCase() ?? '';
    if (!keyword || keyword.startsWith('키워드 ') || exposed || newLogic !== 'o' || seen.has(keyword) || !isAllowed(keyword)) {
      continue;
    }
    seen.add(keyword);
    keywords.push(keyword);
  }

  return keywords;
};

const loadAccounts = async (): Promise<ResolvedAccount[]> => {
  const blogAccounts = await mongoose.connection
    .collection<BlogAccountRecord>('blogaccounts')
    .find(
      {
        category: '흑염소',
        $or: [
          { isEnabled: { $exists: false } },
          { isEnabled: true },
        ],
      },
      {
        projection: {
          accountId: 1,
          nickname: 1,
          blogId: 1,
        },
      },
    )
    .toArray();

  const credentialRecords = await mongoose.connection
    .useDb('cafe-bot')
    .collection<AccountRecord>('accounts')
    .find(
      {
        accountId: { $in: blogAccounts.map((account) => account.accountId).filter(Boolean) },
      },
      {
        projection: {
          accountId: 1,
          password: 1,
        },
      },
    )
    .toArray();
  const passwords = new Map(credentialRecords.map((record) => [record.accountId, record.password]));

  return blogAccounts
    .filter((record) => record.accountId && passwords.has(record.accountId))
    .map((record) => ({
      id: record.accountId,
      password: passwords.get(record.accountId)!,
      blogId: record.blogId || record.accountId,
      displayName: normalizeDisplayName(record.nickname?.trim() || record.accountId),
    }))
    .sort((left, right) => {
      const leftIndex = ACCOUNT_ORDER.indexOf(left.displayName);
      const rightIndex = ACCOUNT_ORDER.indexOf(right.displayName);
      if (leftIndex === -1 && rightIndex === -1) {
        return left.displayName.localeCompare(right.displayName, 'ko');
      }
      if (leftIndex === -1) {
        return 1;
      }
      if (rightIndex === -1) {
        return -1;
      }
      return leftIndex - rightIndex;
    });
};

const assignKeywords = (accounts: ResolvedAccount[], keywords: string[]): Array<ResolvedAccount & { keywords: string[] }> => {
  const usedGlobalRoots = new Set<string>();
  const remaining = [...keywords];

  return accounts.map((account) => {
    const picked: string[] = [];
    const accountRoots = new Set<string>();

    while (picked.length < POSTS_PER_ACCOUNT) {
      const index = remaining.findIndex((keyword) => {
        const root = rootOf(keyword);
        return !usedGlobalRoots.has(root) && !accountRoots.has(root);
      });
      if (index < 0) {
        throw new Error(`not enough diversified keywords for ${account.displayName}`);
      }
      const [keyword] = remaining.splice(index, 1);
      const root = rootOf(keyword);
      picked.push(keyword);
      accountRoots.add(root);
      usedGlobalRoots.add(root);
    }

    return {
      ...account,
      keywords: picked,
    };
  });
};

const enqueueAccount = async (
  account: ResolvedAccount & { items: ReturnType<typeof calculateSchedule> },
): Promise<string> => {
  const existing = await ScheduleModel.findOne({
    accountId: account.id,
    service: SERVICE,
    ref: REF,
    scheduleDate: SCHEDULE_DATE,
    status: { $ne: 'cancelled' },
  }).sort({ createdAt: -1 });
  const generateQueue = getGenerateQueue(account.id);
  getPublishQueue(account.id);

  const schedule = existing ?? await ScheduleModel.create({
    accountId: account.id,
    service: SERVICE,
    ref: REF,
    scheduleDate: SCHEDULE_DATE,
    scheduleMode: SCHEDULE_MODE,
    generateImages: true,
    imageCount: IMAGE_COUNT,
    delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
    totalJobs: account.items.length,
    status: 'pending',
  });

  for (const item of account.items) {
    const calculatedScheduledAt = formatKst(item.scheduledAt);
    let scheduleJob = await ScheduleJobModel.findOne({
      scheduleId: schedule._id,
      keyword: item.keyword,
      status: { $ne: 'cancelled' },
    });

    if (!scheduleJob) {
      scheduleJob = await ScheduleJobModel.create({
        scheduleId: schedule._id,
        keyword: item.keyword,
        category: item.category,
        scheduledAt: calculatedScheduledAt,
        slot: item.slot,
        status: 'pending',
      });
    }

    const scheduledAt = scheduleJob.scheduledAt || calculatedScheduledAt;

    if (scheduleJob.status === 'published' || scheduleJob.status === 'publishing' || scheduleJob.status === 'generated' || scheduleJob.status === 'generating') {
      console.log(`[skip] ${account.displayName} ${scheduleJob.status} ${item.keyword}`);
      continue;
    }

    const generateJob = await generateQueue.add('generate', {
      scheduleId: String(schedule._id),
      scheduleJobId: String(scheduleJob._id),
      keyword: item.keyword,
      category: item.category,
      account: {
        id: account.id,
        password: account.password,
        blogId: account.blogId,
      },
      service: SERVICE,
      ref: REF,
      generateImages: true,
      imageCount: IMAGE_COUNT,
      imageSource: 'product',
      manuscriptType: 'hanryeodamwon',
      delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
      scheduledAt,
      keywordCategory: '한려담원',
      blogName: account.displayName,
    }, {
      jobId: buildScheduleGenerateJobId(String(scheduleJob._id)),
    });

    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, {
      generateJobId: String(generateJob.id),
      status: 'pending',
    });
    console.log(`[queued] ${account.displayName} ${scheduledAt} ${item.keyword}`);
  }

  return String(schedule._id);
};

const summarize = async (scheduleIds: string[]): Promise<{ done: boolean; text: string }> => {
  const jobs = await ScheduleJobModel.find(
    { scheduleId: { $in: scheduleIds } },
    { status: 1 },
  );
  const counts = new Map<string, number>();
  for (const job of jobs) {
    counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  }
  const total = jobs.length;
  const published = counts.get('published') ?? 0;
  const failed = counts.get('failed') ?? 0;
  const pending = counts.get('pending') ?? 0;
  const generating = counts.get('generating') ?? 0;
  const generated = counts.get('generated') ?? 0;
  const publishing = counts.get('publishing') ?? 0;

  return {
    done: total > 0 && published + failed >= total,
    text: `total=${total} published=${published} failed=${failed} pending=${pending} generating=${generating} generated=${generated} publishing=${publishing}`,
  };
};

const waitForCompletion = async (scheduleIds: string[]): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MONITOR_TIMEOUT_MS) {
    const summary = await summarize(scheduleIds);
    console.log(`[monitor] ${summary.text}`);
    if (summary.done) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, MONITOR_INTERVAL_MS);
    });
  }
  throw new Error('monitor timeout');
};

const main = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URI ?? '');

  try {
    const accounts = await loadAccounts();
    const keywords = await fetchSheetKeywords();
    const assigned = assignKeywords(accounts, keywords);
    const previews = assigned.map((account) => ({
      ...account,
      items: calculateSchedule(account.keywords, SCHEDULE_DATE, SCHEDULE_MODE),
    }));

    console.log('=== goat today schedule plan ===');
    console.log(`schedule_date=${SCHEDULE_DATE}`);
    console.log(`schedule_mode=${SCHEDULE_MODE}`);
    console.log(`accounts=${previews.length}`);
    console.log(`keywords=${previews.reduce((sum, preview) => sum + preview.keywords.length, 0)}`);
    for (const preview of previews) {
      console.log(`\n[${preview.displayName}] ${preview.id}`);
      for (const item of preview.items) {
        console.log(`  ${formatKst(item.scheduledAt)} | ${item.keyword}`);
      }
    }

    const scheduleIds: string[] = [];
    for (const preview of previews) {
      scheduleIds.push(await enqueueAccount(preview));
    }
    await waitForCompletion(scheduleIds);
  } finally {
    await closeAllQueues().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
