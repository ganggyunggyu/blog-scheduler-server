import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { Redis as IORedis } from 'ioredis';

const SCHEDULE_DATE = '2026-06-28';
const SCHEDULE_MODE = '2';
const SHEET_ID = '1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c';
const PET_GID = '1960709235';
const GOAT_GID = '1025121967';
const SCHEDULER_API_URL = process.env.SCHEDULER_API_URL ?? 'http://localhost:8001';
const EXECUTE = process.argv.includes('--execute');
const OUT_PATH = path.resolve(process.cwd(), `outputs/sunday-pet-goat-schedule-${SCHEDULE_DATE}.json`);

const PET_CATEGORIES = ['서리펫', '도그마루 글밥'];
const PET_BLOCKED = new Set(['b6x2k9w3', '8ua1womn', 'loand3324']);
const GOAT_ORDER = [
  'regular14631',
  'pixelninja3',
  'ahffkekd12',
  'dhtksk1p',
  'eghfsa5478',
  'q9v3m7a2',
  'laghunter8',
];

const MAIN_KEYWORD_ROOTS = [
  '비타민b12',
  '십전대보탕',
  '보중익기탕',
  '레이노증후군',
  '당화혈색소',
  '중성지방',
  '수족냉증',
  '혈액순환',
  '소양인',
  '소음인',
  '임산부',
  '임신초기',
  '임신',
  '흑염소진액',
  '흑염소',
  '염소즙',
  '관절',
  '빈혈',
  '손발',
  '손끝',
  '당뇨',
  '간수치',
  '숙취',
  '면역력',
  '입맛',
  '감초',
  '키성장',
  '뼈',
  '위',
  '눈떨림',
  '콜레스테롤',
  '고콜레스테롤',
  '마그네슘',
];

const ROOT_SUFFIXES = [
  '에좋은영양제',
  '에좋은음식',
  '에좋은식품',
  '좋은영양제',
  '좋은음식',
  '좋은식품',
  '좋은차',
  '영양제',
  '효능부작용',
  '효능',
  '효과',
  '복용법',
  '먹는법',
  '부작용',
  '정상수치',
  '낮추는법',
  '낮추기',
  '수치',
  '원인',
  '치료음식',
  '음식추천',
  '추천',
  '선물',
  '방법',
  '특징',
  '식단',
  '음식',
];

const normalizeKeyword = (keyword) => keyword.replace(/\s+/g, '').toLowerCase();

const getRoot = (keyword) => {
  const normalized = normalizeKeyword(keyword);
  const explicitRoot = MAIN_KEYWORD_ROOTS.find((root) => normalized.includes(root));
  if (explicitRoot) return explicitRoot;

  let root = normalized;
  for (const suffix of ROOT_SUFFIXES) {
    if (root.endsWith(suffix) && root.length > suffix.length) {
      root = root.slice(0, -suffix.length);
      break;
    }
  }
  return root || normalized;
};

const isColdRoot = (keyword) => /수족냉증|손발|손끝/.test(normalizeKeyword(keyword));

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRandom = (seedValue) => {
  let seed = hashString(seedValue) || 1;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
};

const shuffle = (items, seedValue) => {
  const random = createSeededRandom(seedValue);
  const copied = [...items];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
};

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
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
      if (char === '\r' && nextChar === '\n') index += 1;
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

const fetchSheetRows = async (gid) => {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cache-Control': 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`sheet fetch failed gid=${gid}: ${response.status}`);
  }

  return parseCsv(await response.text());
};

const extractSheetKeywords = (rows) => {
  const unexposed = [];
  const fallback = [];
  const seen = new Set();

  for (const [index, row] of rows.entries()) {
    if (index === 0) continue;
    const keyword = row[0]?.trim() ?? '';
    const exposed = row[3]?.trim() ?? '';
    const newLogic = row[6]?.trim().toLowerCase() ?? '';
    if (!keyword || keyword.startsWith('키워드 ') || seen.has(keyword)) continue;
    if (newLogic !== 'o') continue;
    seen.add(keyword);
    if (exposed) {
      fallback.push(keyword);
    } else {
      unexposed.push(keyword);
    }
  }

  return { unexposed, fallback, all: [...unexposed, ...fallback] };
};

const sortByOrder = (accounts, order) => {
  const orderMap = new Map(order.map((accountId, index) => [accountId, index]));
  return [...accounts].sort((left, right) => {
    const leftIndex = orderMap.get(left.accountId) ?? 999;
    const rightIndex = orderMap.get(right.accountId) ?? 999;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return (left.nickname || left.accountId).localeCompare(right.nickname || right.accountId, 'ko');
  });
};

const loadBlogAccounts = async (db, categoryFilter, order = []) => {
  const query = Array.isArray(categoryFilter)
    ? { category: { $in: categoryFilter } }
    : { category: categoryFilter };

  const accounts = await db.collection('blogaccounts')
    .find(
      {
        ...query,
        $or: [{ isEnabled: true }, { isEnabled: { $exists: false } }],
        status: { $ne: 'disabled' },
      },
      { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, category: 1, status: 1, note: 1 } },
    )
    .toArray();

  return order.length > 0
    ? sortByOrder(accounts, order)
    : accounts.sort((left, right) => `${left.category}:${left.nickname || left.accountId}`.localeCompare(`${right.category}:${right.nickname || right.accountId}`, 'ko'));
};

const loadCafeCredentials = async (cafeDb, accountIds) => {
  const rows = await cafeDb.collection('accounts')
    .find(
      {
        accountId: { $in: accountIds },
        isActive: { $ne: false },
      },
      { projection: { _id: 0, accountId: 1, password: 1, blogId: 1, nickname: 1 } },
    )
    .toArray();

  return new Map(rows.filter((row) => row.accountId && row.password).map((row) => [row.accountId, row]));
};

const makeRedis = () => new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
  db: Number(process.env.REDIS_DB || 0),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

const loadRedisPasswords = async (accountIds) => {
  const redis = makeRedis();
  const accountSet = new Set(accountIds);
  const found = new Map();

  try {
    const keys = await redis.keys('bull:generate_*:*');
    for (const key of keys) {
      if (key.endsWith(':events') || key.endsWith(':meta') || key.endsWith(':id')) continue;
      const type = await redis.type(key);
      if (type !== 'hash') continue;
      const raw = await redis.hget(key, 'data');
      if (!raw) continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      const account = parsed?.account;
      const id = account?.id;
      if (id && accountSet.has(id) && account?.password && !found.has(id)) {
        found.set(id, {
          accountId: id,
          password: account.password,
          blogId: account.blogId,
        });
      }
    }
  } finally {
    await redis.quit().catch(() => undefined);
  }

  return found;
};

const loadUsedKeywords = async (db, accountIds) => {
  const schedules = await db.collection('schedules')
    .find(
      {
        accountId: { $in: accountIds },
        status: { $ne: 'cancelled' },
      },
      { projection: { _id: 1 } },
    )
    .toArray();

  if (schedules.length === 0) return new Set();

  const jobs = await db.collection('schedulejobs')
    .find(
      {
        scheduleId: { $in: schedules.map((schedule) => schedule._id) },
        status: { $nin: ['cancelled', 'failed'] },
      },
      { projection: { _id: 0, keyword: 1 } },
    )
    .toArray();

  return new Set(jobs.map((job) => job.keyword).filter(Boolean));
};

const selectKeywords = ({ pools, needed, usedKeywords, seed, diverse }) => {
  const firstPass = [...pools.unexposed, ...pools.fallback].filter((keyword) => !usedKeywords.has(keyword));
  const secondPass = [...pools.unexposed, ...pools.fallback].filter((keyword) => usedKeywords.has(keyword));
  const pool = shuffle([...firstPass, ...secondPass], seed);
  const selected = [];
  const usedRoots = new Set();

  if (diverse) {
    const sorted = pool.sort((left, right) => Number(isColdRoot(left)) - Number(isColdRoot(right)));
    for (const keyword of sorted) {
      const root = getRoot(keyword);
      if (usedRoots.has(root)) continue;
      selected.push(keyword);
      usedRoots.add(root);
      if (selected.length === needed) return selected;
    }
    for (const keyword of sorted) {
      if (selected.includes(keyword)) continue;
      selected.push(keyword);
      if (selected.length === needed) return selected;
    }
    return selected;
  }

  for (const keyword of pool) {
    if (selected.includes(keyword)) continue;
    selected.push(keyword);
    if (selected.length === needed) return selected;
  }

  return selected;
};

const assignRoundRobin = (accounts, selectedKeywords, perAccount) => {
  const byAccount = new Map(accounts.map((account) => [account.accountId, []]));

  for (let round = 0; round < perAccount; round += 1) {
    for (let index = 0; index < accounts.length; index += 1) {
      const keyword = selectedKeywords[round * accounts.length + index];
      byAccount.get(accounts[index].accountId).push(keyword);
    }
  }

  return byAccount;
};

const resolveExecutableAccounts = (accounts, credentials, redisPasswords, blockedSet = new Set()) => {
  const executable = [];
  const skipped = [];

  for (const account of accounts) {
    if (blockedSet.has(account.accountId) || account.status === 'credential_error') {
      skipped.push({
        accountId: account.accountId,
        nickname: account.nickname || account.accountId,
        category: account.category,
        reason: account.accountId === 'b6x2k9w3'
          ? 'naver_permanent_service_restriction'
          : account.accountId === '8ua1womn'
            ? 'naver_id_or_password_error'
            : 'credential_error_or_known_login_block',
      });
      continue;
    }

    const credential = credentials.get(account.accountId) || redisPasswords.get(account.accountId);
    if (!credential?.password) {
      skipped.push({
        accountId: account.accountId,
        nickname: account.nickname || account.accountId,
        category: account.category,
        reason: 'missing_runtime_password',
      });
      continue;
    }

    executable.push({
      ...account,
      password: credential.password,
      blogId: account.blogId || credential.blogId || account.accountId,
      displayName: (account.nickname || credential.nickname || account.accountId).replace(/\s+/g, ''),
    });
  }

  return { executable, skipped };
};

const buildQueues = (accounts, keywordsByAccount) => accounts.map((account) => ({
  account: {
    id: account.accountId,
    password: account.password,
    blogId: account.blogId,
  },
  blog_name: account.displayName,
  keywords: keywordsByAccount.get(account.accountId) ?? [],
}));

const callAutoSchedule = async (label, body) => {
  if (!EXECUTE) return { skipped: true };

  const response = await fetch(`${SCHEDULER_API_URL}/bot/auto-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok || json.success !== true) {
    throw new Error(`${label} auto-schedule failed: ${response.status} ${JSON.stringify(json)}`);
  }

  return json;
};

const sanitizeSchedules = (json) => ({
  totalJobs: json?.totalJobs ?? 0,
  schedules: (json?.schedules ?? []).map((schedule) => ({
    account: schedule.account,
    reused: schedule.reused,
    totalJobs: schedule.totalJobs,
    scheduleId: schedule.scheduleId,
    jobs: (schedule.jobs ?? []).map((job) => ({
      id: job.id,
      keyword: job.keyword,
      scheduledAt: job.scheduledAt,
      slot: job.slot,
    })),
  })),
});

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const db = mongoose.connection.db;
    const cafeDb = mongoose.connection.useDb('cafe-bot');

    const [petAccounts, goatAccounts, petRows, goatRows] = await Promise.all([
      loadBlogAccounts(db, PET_CATEGORIES),
      loadBlogAccounts(db, '흑염소', GOAT_ORDER),
      fetchSheetRows(PET_GID),
      fetchSheetRows(GOAT_GID),
    ]);

    const allAccountIds = [...petAccounts, ...goatAccounts].map((account) => account.accountId);
    const [credentials, redisPasswords, usedKeywords] = await Promise.all([
      loadCafeCredentials(cafeDb, allAccountIds),
      loadRedisPasswords(allAccountIds),
      loadUsedKeywords(db, allAccountIds),
    ]);

    const petResolved = resolveExecutableAccounts(petAccounts, credentials, redisPasswords, PET_BLOCKED);
    const goatResolved = resolveExecutableAccounts(goatAccounts, credentials, redisPasswords);
    const petPools = extractSheetKeywords(petRows);
    const goatPools = extractSheetKeywords(goatRows);

    const petNeeded = petResolved.executable.length * 2;
    const goatNeeded = goatResolved.executable.length * 2;
    const petSelected = selectKeywords({
      pools: petPools,
      needed: petNeeded,
      usedKeywords,
      seed: `pet:${SCHEDULE_DATE}:${petNeeded}`,
      diverse: false,
    });
    const goatSelected = selectKeywords({
      pools: goatPools,
      needed: goatNeeded,
      usedKeywords,
      seed: `goat:${SCHEDULE_DATE}:${goatNeeded}`,
      diverse: true,
    });

    if (petSelected.length < petNeeded) {
      throw new Error(`pet keywords not enough: ${petSelected.length} < ${petNeeded}`);
    }
    if (goatSelected.length < goatNeeded) {
      throw new Error(`goat keywords not enough: ${goatSelected.length} < ${goatNeeded}`);
    }

    const petByAccount = assignRoundRobin(petResolved.executable, petSelected, 2);
    const goatByAccount = assignRoundRobin(goatResolved.executable, goatSelected, 2);
    const petQueues = buildQueues(petResolved.executable, petByAccount);
    const goatQueues = buildQueues(goatResolved.executable, goatByAccount);

    const petBody = {
      queues: petQueues,
      schedule_date: SCHEDULE_DATE,
      schedule_mode: SCHEDULE_MODE,
      service: 'pet-sheet-sunday-20260628',
      ref: `pet-sheet-${PET_GID}-${SCHEDULE_DATE}-two-per-account-${Date.now()}`,
      generate_images: true,
      image_count: 5,
      image_source: 'product',
      manuscript_type: 'pet',
      delay_between_posts: 10,
      keyword_category: '애견',
    };
    const goatBody = {
      queues: goatQueues,
      schedule_date: SCHEDULE_DATE,
      schedule_mode: SCHEDULE_MODE,
      service: 'goat-sheet-sunday-20260628',
      ref: `goat-sheet-${GOAT_GID}-${SCHEDULE_DATE}-two-per-account-${Date.now()}`,
      generate_images: true,
      image_count: 5,
      image_source: 'product',
      manuscript_type: 'hanryeodamwon',
      delay_between_posts: 10,
      keyword_category: '한려담원',
    };

    const petResult = await callAutoSchedule('pet', petBody);
    const goatResult = await callAutoSchedule('goat', goatBody);

    const report = {
      executed: EXECUTE,
      scheduleDate: SCHEDULE_DATE,
      scheduleMode: SCHEDULE_MODE,
      pet: {
        sheetGid: PET_GID,
        sourceRows: petRows.length,
        unexposed: petPools.unexposed.length,
        fallback: petPools.fallback.length,
        accountCount: petResolved.executable.length,
        skippedAccounts: petResolved.skipped,
        queues: petQueues.map((queue) => ({
          accountId: queue.account.id,
          blogName: queue.blog_name,
          keywords: queue.keywords,
        })),
        result: sanitizeSchedules(petResult),
      },
      goat: {
        sheetGid: GOAT_GID,
        sourceRows: goatRows.length,
        unexposed: goatPools.unexposed.length,
        fallback: goatPools.fallback.length,
        accountCount: goatResolved.executable.length,
        skippedAccounts: goatResolved.skipped,
        queues: goatQueues.map((queue) => ({
          accountId: queue.account.id,
          blogName: queue.blog_name,
          keywords: queue.keywords,
          roots: queue.keywords.map(getRoot),
        })),
        result: sanitizeSchedules(goatResult),
      },
    };

    await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
    await fs.writeFile(OUT_PATH, JSON.stringify(report, null, 2));

    console.log(JSON.stringify({
      output: OUT_PATH,
      executed: EXECUTE,
      pet: {
        accounts: report.pet.accountCount,
        skipped: report.pet.skippedAccounts,
        totalJobs: report.pet.result.totalJobs,
        queues: report.pet.queues,
      },
      goat: {
        accounts: report.goat.accountCount,
        skipped: report.goat.skippedAccounts,
        totalJobs: report.goat.result.totalJobs,
        queues: report.goat.queues,
      },
    }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
