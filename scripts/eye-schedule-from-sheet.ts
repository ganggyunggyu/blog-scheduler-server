import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import type { ScheduleMode } from '../src/services/schedule.service.js';

const SHEET_ID = '1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c';
const EYE_SHEET_GID = '633450920';
const EYE_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${EYE_SHEET_GID}`;
const SCHEDULER_API_URL = process.env.SCHEDULER_API_URL ?? 'http://localhost:8001';
const FINAL_BRAND_ROOT = '/Users/ganggyunggyu/Downloads/2_브랜드블로그_최종';
const BRAND_ACCOUNT_ID = 'adplan3th';
const BRAND_ACCOUNT_BLOG_ID = 'adplan3th';
const BRAND_PASSWORD_ENV = 'NAVER_BRAND_PASSWORD';
const DEFAULT_MODE: ScheduleMode = '3';
const ACCOUNT_STAGGER_MINUTES = 5;
const DEFAULT_SLOT_TIMES: Record<ScheduleMode, string[]> = {
  '1': ['11:00'],
  '2': ['10:00', '15:00'],
  '3': ['09:00', '13:00', '17:00'],
  '2121': ['10:00', '15:00'],
};
const DEFAULT_GENERAL_CATEGORIES = ['안과', '에스앤비안과', '에스앤비안과-백업'];
const GENERAL_ACCOUNT_ORDER = ['nes1p2kx', 'mh8j62wm', 'h9ag469z', 'dq1h3bjy', 'hagyga', 'geenl', 'ghhoy'];
const EYE_ROOTS = [
  '스마일라식',
  '투데이라섹',
  '렌즈삽입술',
  '백내장',
  '안구건조증',
  '녹내장',
  '스마일라섹',
  '결막모반',
  '비문증',
  '노안',
  '난시',
  '라섹',
  '라식',
  'ipl',
];

interface CliOptions {
  scheduleDate: string;
  scheduleMode: ScheduleMode;
  execute: boolean;
  includeGeneral: boolean;
  includeBrand: boolean;
  strictCredentials: boolean;
  strictBrandPassword: boolean;
}

interface AccountRecord {
  accountId?: string;
  blogId?: string;
  nickname?: string;
  category?: string;
  isEnabled?: boolean;
  status?: string;
}

interface CredentialRecord {
  accountId?: string;
  blogId?: string;
  nickname?: string;
  password?: string;
}

interface ResolvedAccount {
  accountId: string;
  password: string;
  blogId: string;
  displayName: string;
  category?: string;
}

interface MissingCredential {
  accountId: string;
  displayName: string;
  category?: string;
}

interface BrandItem {
  month: string;
  order: number;
  keyword: string;
  title: string;
  manuscriptPath: string;
  slidePaths: string[];
}

interface QueueItem {
  keyword: string;
  scheduledAt: string;
  slot: number;
}

interface ScheduleQueue {
  account: {
    id: string;
    password: string;
    blogId?: string;
  };
  blog_name?: string;
  keywords: string[];
  items: QueueItem[];
  manuscripts?: Array<{ title: string; content: string }>;
  multi_images?: Array<{ slide: string[] }>;
}

const getKstToday = (): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  let scheduleDate = getKstToday();
  let scheduleMode: ScheduleMode = DEFAULT_MODE;
  let execute = false;
  let includeGeneral = true;
  let includeBrand = true;
  let strictCredentials = false;
  let strictBrandPassword = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--date') {
      scheduleDate = args[index + 1] ?? scheduleDate;
      index += 1;
      continue;
    }
    if (token === '--mode') {
      const value = args[index + 1];
      if (value === '1' || value === '2' || value === '3' || value === '2121') {
        scheduleMode = value;
      }
      index += 1;
      continue;
    }
    if (token === '--execute') {
      execute = true;
      continue;
    }
    if (token === '--general-only') {
      includeGeneral = true;
      includeBrand = false;
      continue;
    }
    if (token === '--brand-only') {
      includeGeneral = false;
      includeBrand = true;
      continue;
    }
    if (token === '--strict-credentials') {
      strictCredentials = true;
      continue;
    }
    if (token === '--strict-brand-password') {
      strictBrandPassword = true;
    }
  }

  return {
    scheduleDate,
    scheduleMode,
    execute,
    includeGeneral,
    includeBrand,
    strictCredentials,
    strictBrandPassword,
  };
};

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }
      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }
    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows;
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRandom = (seedValue: string): (() => number) => {
  let seed = hashString(seedValue) || 1;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
};

const shuffle = <T>(items: T[], seedValue: string): T[] => {
  const random = createSeededRandom(seedValue);
  const copied = [...items];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
};

const normalizeKeyword = (keyword: string): string =>
  keyword.replace(/\s+/g, '').toLowerCase();

const getEyeRoot = (keyword: string): string => {
  const normalized = normalizeKeyword(keyword);
  const explicitRoot = EYE_ROOTS.find((root) => normalized.includes(root));
  return explicitRoot ?? normalized;
};

const fetchEyeSheetKeywords = async (): Promise<string[]> => {
  const response = await fetch(EYE_SHEET_CSV_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cache-Control': 'no-cache',
    },
  });
  if (!response.ok) {
    throw new Error(`안과 키워드 시트 조회 실패: ${response.status}`);
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
    if (!keyword || keyword.startsWith('키워드 ')) {
      continue;
    }
    if (exposed || newLogic !== 'o' || seen.has(keyword)) {
      continue;
    }
    seen.add(keyword);
    keywords.push(keyword);
  }
  return keywords;
};

const normalizeDisplayName = (nickname: string | undefined, accountId: string): string =>
  (nickname?.trim() || accountId).replace(/\s+/g, '');

const sortAccounts = (accounts: ResolvedAccount[]): ResolvedAccount[] => {
  const orderMap = new Map(GENERAL_ACCOUNT_ORDER.map((accountId, index) => [accountId, index]));
  return [...accounts].sort((left, right) => {
    const leftIndex = orderMap.get(left.accountId) ?? 999;
    const rightIndex = orderMap.get(right.accountId) ?? 999;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.displayName.localeCompare(right.displayName, 'ko');
  });
};

const loadGeneralAccounts = async (
  strictCredentials: boolean,
): Promise<{ accounts: ResolvedAccount[]; missing: MissingCredential[] }> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not ready');
  }

  const accountRows = await db.collection<AccountRecord>('blogaccounts')
    .find(
      {
        category: { $in: DEFAULT_GENERAL_CATEGORIES },
        $or: [{ isEnabled: true }, { isEnabled: { $exists: false } }],
        status: { $ne: 'disabled' },
      },
      { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, category: 1 } },
    )
    .toArray();

  const accountIds = accountRows.map((account) => account.accountId).filter((accountId): accountId is string => Boolean(accountId));
  const credentialRows = await mongoose.connection.useDb('cafe-bot')
    .collection<CredentialRecord>('accounts')
    .find(
      { accountId: { $in: accountIds } },
      { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, password: 1 } },
    )
    .toArray();
  const credentials = new Map(credentialRows.map((credential) => [credential.accountId, credential]));

  const accounts: ResolvedAccount[] = [];
  const missing: MissingCredential[] = [];
  for (const account of accountRows) {
    if (!account.accountId) {
      continue;
    }
    const credential = credentials.get(account.accountId);
    const displayName = normalizeDisplayName(account.nickname ?? credential?.nickname, account.accountId);
    if (!credential?.password) {
      missing.push({ accountId: account.accountId, displayName, category: account.category });
      continue;
    }
    accounts.push({
      accountId: account.accountId,
      password: credential.password,
      blogId: account.blogId || credential.blogId || account.accountId,
      displayName,
      category: account.category,
    });
  }

  if (strictCredentials && missing.length > 0) {
    throw new Error(`안과 계정 비밀번호 없음: ${missing.map((account) => account.accountId).join(', ')}`);
  }

  return { accounts: sortAccounts(accounts), missing };
};

const assignDiversifiedKeywords = (
  accounts: ResolvedAccount[],
  keywords: string[],
  perAccount: number,
): Map<string, string[]> => {
  const assigned = new Map(accounts.map((account) => [account.accountId, [] as string[]]));
  const rootSets = new Map(accounts.map((account) => [account.accountId, new Set<string>()]));
  const remaining = [...keywords];

  for (let round = 0; round < perAccount; round += 1) {
    for (const account of accounts) {
      const usedRoots = rootSets.get(account.accountId);
      if (!usedRoots) {
        throw new Error(`root set missing: ${account.accountId}`);
      }

      const keywordIndex = remaining.findIndex((keyword) => !usedRoots.has(getEyeRoot(keyword)));
      if (keywordIndex < 0) {
        throw new Error(`안과 키워드 부족: ${account.displayName}`);
      }

      const [keyword] = remaining.splice(keywordIndex, 1);
      assigned.get(account.accountId)?.push(keyword);
      usedRoots.add(getEyeRoot(keyword));
    }
  }

  return assigned;
};

const kstFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const formatKstDate = (date: Date): string =>
  `${kstFormatter.format(date).replace(' ', 'T')}+09:00`;

const buildKstDateTime = (date: string, time: string, addMinutes: number): Date => {
  const base = new Date(`${date}T${time}:00+09:00`);
  return new Date(base.getTime() + addMinutes * 60_000);
};

const toQueueItems = (
  keywords: string[],
  scheduleDate: string,
  scheduleMode: ScheduleMode,
  staggerMinutes: number,
): QueueItem[] => {
  const slotTimes = DEFAULT_SLOT_TIMES[scheduleMode];
  if (keywords.length > slotTimes.length) {
    throw new Error(`고정 슬롯 부족: keywords=${keywords.length}, slots=${slotTimes.length}`);
  }

  return keywords.map((keyword, index) => ({
    keyword,
    scheduledAt: formatKstDate(buildKstDateTime(scheduleDate, slotTimes[index], staggerMinutes)),
    slot: index + 1,
  }));
};

const buildGeneralQueues = (
  accounts: ResolvedAccount[],
  assignedKeywords: Map<string, string[]>,
  scheduleDate: string,
  scheduleMode: ScheduleMode,
): ScheduleQueue[] =>
  accounts.map((account, accountIndex) => {
    const keywords = assignedKeywords.get(account.accountId) ?? [];
    return {
      account: {
        id: account.accountId,
        password: account.password,
        blogId: account.blogId,
      },
      blog_name: account.displayName,
      keywords,
      items: toQueueItems(keywords, scheduleDate, scheduleMode, accountIndex * ACCOUNT_STAGGER_MINUTES),
    };
  });

const findMobileManuscript = async (dir: string): Promise<string> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const matched = entries.find((entry) => {
    const name = entry.name.normalize('NFC');
    return entry.isFile() && name.startsWith('[모바일발행]') && name.endsWith('.txt');
  });
  if (!matched) {
    throw new Error(`모바일발행 원고 없음: ${dir}`);
  }
  return path.join(dir, matched.name);
};

const findSlidePaths = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const slideDir = entries.find((entry) => entry.isDirectory() && entry.name.normalize('NFC').endsWith('_slides'));
  if (!slideDir) {
    throw new Error(`slides 폴더 없음: ${dir}`);
  }

  const slideRoot = path.join(dir, slideDir.name);
  const slides = (await fs.readdir(slideRoot))
    .filter((name) => /^slide_\d{2}\.png$/u.test(name.normalize('NFC')))
    .sort((left, right) => left.normalize('NFC').localeCompare(right.normalize('NFC')))
    .map((name) => path.join(slideRoot, name));

  if (slides.length !== 6) {
    throw new Error(`브랜드 슬라이드 6장 필요: ${dir}, actual=${slides.length}`);
  }
  return slides;
};

const loadBrandItems = async (): Promise<BrandItem[]> => {
  const monthEntries = await fs.readdir(FINAL_BRAND_ROOT, { withFileTypes: true });
  const monthDirs = monthEntries
    .filter((entry) => entry.isDirectory() && /^\d+월$/u.test(entry.name.normalize('NFC')))
    .sort((left, right) => Number.parseInt(left.name, 10) - Number.parseInt(right.name, 10));
  const items: BrandItem[] = [];

  for (const monthDir of monthDirs) {
    const monthPath = path.join(FINAL_BRAND_ROOT, monthDir.name);
    const postDirs = (await fs.readdir(monthPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d+\./u.test(entry.name.normalize('NFC')))
      .sort((left, right) => Number.parseInt(left.name, 10) - Number.parseInt(right.name, 10));

    for (const postDir of postDirs) {
      const order = Number.parseInt(postDir.name, 10);
      const postPath = path.join(monthPath, postDir.name);
      const manuscriptPath = await findMobileManuscript(postPath);
      const content = await fs.readFile(manuscriptPath, 'utf8');
      const title = content.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
      if (!title) {
        throw new Error(`브랜드 제목 없음: ${manuscriptPath}`);
      }
      const keyword = postDir.name.normalize('NFC').replace(/^\d+\./u, '').trim();
      items.push({
        month: monthDir.name.normalize('NFC'),
        order,
        keyword,
        title,
        manuscriptPath,
        slidePaths: await findSlidePaths(postPath),
      });
    }
  }

  return items;
};

const loadUsedBrandKeywords = async (): Promise<Set<string>> => {
  const jobs = await mongoose.connection.db?.collection('schedulejobs')
    .aggregate([
      {
        $lookup: {
          from: 'schedules',
          localField: 'scheduleId',
          foreignField: '_id',
          as: 'schedule',
        },
      },
      { $unwind: '$schedule' },
      {
        $match: {
          'schedule.accountId': BRAND_ACCOUNT_ID,
          status: { $ne: 'cancelled' },
        },
      },
      { $project: { keyword: 1 } },
    ])
    .toArray();

  return new Set((jobs ?? []).map((job) => String(job.keyword ?? '')).filter(Boolean));
};

const extractPostListJson = (text: string): unknown[] => {
  const marker = '"postList":[';
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) {
    return [];
  }

  const start = text.indexOf('[', markerIndex);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, index + 1)) as unknown[];
      }
    }
  }

  return [];
};

const decodeNaverTitle = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  try {
    return decodeURIComponent(value.replace(/\+/g, ' ')).trim();
  } catch {
    return value.trim();
  }
};

const fetchRecentNaverTitles = async (blogId: string, pages: number): Promise<Set<string>> => {
  const titles = new Set<string>();
  for (let page = 1; page <= pages; page += 1) {
    const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=${page}&categoryNo=0&parentCategoryNo=&countPerPage=5`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: `https://blog.naver.com/${blogId}`,
      },
    });
    if (!response.ok) {
      continue;
    }
    for (const rawPost of extractPostListJson(await response.text())) {
      if (!rawPost || typeof rawPost !== 'object') {
        continue;
      }
      const title = decodeNaverTitle((rawPost as { title?: unknown }).title);
      if (title) {
        titles.add(title);
      }
    }
  }
  return titles;
};

const selectBrandItems = async (count: number): Promise<BrandItem[]> => {
  const [items, usedKeywords, recentTitles] = await Promise.all([
    loadBrandItems(),
    loadUsedBrandKeywords(),
    fetchRecentNaverTitles(BRAND_ACCOUNT_BLOG_ID, 20),
  ]);

  return items
    .filter((item) => !usedKeywords.has(item.keyword) && !recentTitles.has(item.title))
    .slice(0, count);
};

const buildBrandQueue = async (
  scheduleDate: string,
  scheduleMode: ScheduleMode,
  execute: boolean,
  staggerMinutes: number,
  strictBrandPassword: boolean,
): Promise<ScheduleQueue | null> => {
  const brandPassword = process.env[BRAND_PASSWORD_ENV];
  const selected = await selectBrandItems(scheduleMode === '3' ? 3 : 2);
  if (selected.length === 0) {
    return null;
  }
  if (execute && !brandPassword && strictBrandPassword) {
    throw new Error(`브랜드 계정 비밀번호 필요: ${BRAND_PASSWORD_ENV}`);
  }
  if (execute && !brandPassword) {
    console.log(`brand_skipped_missing_password=${BRAND_PASSWORD_ENV}`);
    return null;
  }

  return {
    account: {
      id: BRAND_ACCOUNT_ID,
      password: brandPassword ?? '<required>',
      blogId: BRAND_ACCOUNT_BLOG_ID,
    },
    blog_name: '에스앤비안과 브랜드',
    keywords: selected.map((item) => item.keyword),
    items: toQueueItems(selected.map((item) => item.keyword), scheduleDate, scheduleMode, staggerMinutes),
    manuscripts: await Promise.all(selected.map(async (item) => ({
      title: item.title,
      content: await fs.readFile(item.manuscriptPath, 'utf8'),
    }))),
    multi_images: selected.map((item) => ({ slide: item.slidePaths })),
  };
};

const printQueues = (title: string, queues: ScheduleQueue[]): void => {
  console.log(`\n=== ${title} ===`);
  let count = 0;
  for (const queue of queues) {
    console.log(`[${queue.blog_name ?? queue.account.id}] ${queue.account.id}`);
    for (const item of queue.items) {
      count += 1;
      console.log(`  ${item.scheduledAt} | ${item.keyword}`);
    }
  }
  console.log(`count=${count}`);
};

const callAutoSchedule = async (title: string, body: unknown): Promise<void> => {
  const response = await fetch(`${SCHEDULER_API_URL}/bot/auto-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || (json as { success?: boolean }).success !== true) {
    throw new Error(`${title} auto-schedule 실패: ${response.status} ${JSON.stringify(json)}`);
  }

  const result = json as {
    totalJobs?: number;
    schedules?: Array<{ account: string; reused: boolean; totalJobs: number; scheduleId: string }>;
  };
  console.log(`\n${title} submitted: totalJobs=${result.totalJobs ?? 0}`);
  for (const schedule of result.schedules ?? []) {
    console.log(`  ${schedule.account} reused=${schedule.reused} jobs=${schedule.totalJobs} scheduleId=${schedule.scheduleId}`);
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const generalQueues: ScheduleQueue[] = [];
    let missingGeneralCredentials: MissingCredential[] = [];
    if (options.includeGeneral) {
      const { accounts, missing } = await loadGeneralAccounts(options.strictCredentials);
      missingGeneralCredentials = missing;
      const sheetKeywords = await fetchEyeSheetKeywords();
      const shuffled = shuffle(
        sheetKeywords,
        `eye:${options.scheduleDate}:${options.scheduleMode}:${EYE_SHEET_GID}:${accounts.length}`,
      );
      const perAccount = options.scheduleMode === '3' ? 3 : 2;
      const needed = accounts.length * perAccount;
      if (shuffled.length < needed) {
        throw new Error(`안과 키워드 부족: ${shuffled.length} < ${needed}`);
      }
      const assigned = assignDiversifiedKeywords(accounts, shuffled, perAccount);
      generalQueues.push(...buildGeneralQueues(accounts, assigned, options.scheduleDate, options.scheduleMode));
      console.log(`sheet_gid=${EYE_SHEET_GID} candidates=${sheetKeywords.length}`);
      if (missingGeneralCredentials.length > 0) {
        console.log(`missing_credentials=${missingGeneralCredentials.map((account) => account.accountId).join(',')}`);
      }
    }

    const brandQueue = options.includeBrand
      ? await buildBrandQueue(
        options.scheduleDate,
        options.scheduleMode,
        options.execute,
        generalQueues.length * ACCOUNT_STAGGER_MINUTES,
        options.strictBrandPassword,
      )
      : null;
    const brandQueues = brandQueue ? [brandQueue] : [];

    console.log(`mode=${options.execute ? 'execute' : 'dry-run'}`);
    console.log(`schedule_date=${options.scheduleDate}`);
    console.log(`schedule_mode=${options.scheduleMode}`);
    printQueues('안과 일반', generalQueues);
    printQueues('안과 브랜드', brandQueues);

    if (!options.execute) {
      return;
    }

    if (generalQueues.length > 0) {
      await callAutoSchedule('안과 일반', {
        queues: generalQueues,
        schedule_date: options.scheduleDate,
        schedule_mode: options.scheduleMode,
        service: 'ophthalmology-sheet',
        ref: `eye-sheet-${EYE_SHEET_GID}-${options.scheduleDate}`,
        generate_images: true,
        image_count: 5,
        image_source: 'product',
        manuscript_type: 'default',
        delay_between_posts: 10,
        keyword_category: '안과',
      });
    }

    if (brandQueues.length > 0) {
      await callAutoSchedule('안과 브랜드', {
        queues: brandQueues,
        schedule_date: options.scheduleDate,
        schedule_mode: options.scheduleMode,
        service: 'eye-brand-local-auto',
        ref: `eye-brand-local-${options.scheduleDate}`,
        generate_images: false,
        image_count: 6,
        image_source: 'local',
        manuscript_type: 'default',
        delay_between_posts: 10,
        keyword_category: '안과브랜드',
      });
    }
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
