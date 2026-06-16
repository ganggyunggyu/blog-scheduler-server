import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import mongoose from 'mongoose';

process.env.DOTENV_CONFIG_QUIET = 'true';
loadDotenv({ path: path.resolve(process.cwd(), '.env'), override: false, quiet: true });
loadDotenv({ path: '/Users/ganggyunggyu/temp-image-gen/.env.local', override: false, quiet: true });
loadDotenv({ path: '/Users/ganggyunggyu/temp-image-gen/.env', override: false, quiet: true });

const tempRequire = createRequire('/Users/ganggyunggyu/temp-image-gen/package.json');
const { S3Client, ListObjectsV2Command } = tempRequire('@aws-sdk/client-s3');

const KEYWORD_SHEET_ID = '1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c';
const EYE_GID = '633450920';
const PET_GID = '1960709235';
const BRAND_ROOT = '/Users/ganggyunggyu/Downloads/2_브랜드블로그_최종';
const API_URL = process.env.SCHEDULER_API_URL ?? 'http://localhost:8001';
const TODAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const DEFAULT_SLOTS = ['23:30', '23:40', '23:50'];
const PET_CATEGORIES = ['서리펫', '도그마루 글밥'];
const EYE_CATEGORIES = ['안과', '에스앤비안과', '에스앤비안과-백업'];
const EYE_ORDER = ['nes1p2kx', 'mh8j62wm', 'h9ag469z', 'dq1h3bjy', 'hagyga', 'geenl', 'ghhoy'];
const PET_ORDER = [
  'b6x2k9w3',
  'k7d9x2m4',
  'fail5644',
  'loand3324',
  'compare14310',
  'ghostrush7',
  '8ua1womn',
  'n7c3w8z2',
  'respawnking9',
  'ahffkdlek12',
  'ahsxkfldk12',
  'ahfflwl123',
];

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArg = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

const execute = hasFlag('--execute');
const scheduleDate = getArg('--date', TODAY);
const slots = getArg('--slots', DEFAULT_SLOTS.join(',')).split(',').map((slot) => slot.trim()).filter(Boolean);
const includeEye = !hasFlag('--pet-only') && !hasFlag('--brand-only');
const includePet = !hasFlag('--eye-only') && !hasFlag('--brand-only');
const includeBrand = !hasFlag('--eye-only') && !hasFlag('--pet-only') && !hasFlag('--no-brand');
const perAccount = Math.min(3, slots.length);

const parseCsv = (text) => {
  const rows = [];
  let currentRow = [];
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
      if (char === '\r' && nextChar === '\n') index += 1;
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

const normalize = (value) => value.normalize('NFC').replace(/\s+/g, '').toLowerCase().trim();
const stripFolderSuffix = (value) => value.replace(/^_used_/u, '').replace(/_\d+$/u, '');

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededRandom = (seedValue) => {
  let seed = hashString(seedValue) || 1;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
};

const shuffle = (items, seedValue) => {
  const random = seededRandom(seedValue);
  const copied = [...items];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
};

const fetchSheetCandidates = async (gid) => {
  const url = `https://docs.google.com/spreadsheets/d/${KEYWORD_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) {
    throw new Error(`keyword sheet failed gid=${gid}: ${response.status}`);
  }

  const rows = parseCsv(await response.text());
  const seen = new Set();
  const primary = [];
  const fallback = [];
  for (const [index, row] of rows.entries()) {
    if (index === 0) continue;
    const keyword = row[0]?.trim() ?? '';
    const exposed = row[3]?.trim() ?? '';
    const newLogic = row[6]?.trim().toLowerCase() ?? '';
    if (!keyword || keyword.startsWith('키워드 ') || seen.has(keyword)) {
      continue;
    }
    if (newLogic && newLogic !== 'o') continue;
    seen.add(keyword);
    const candidate = { keyword, topic: row[1]?.trim() ?? '' };
    fallback.push(candidate);
    if (!exposed || exposed.toLowerCase() !== 'o') {
      primary.push(candidate);
    }
  }
  return primary.length > 0 ? primary : fallback;
};

const s3Client = new S3Client({
  region: process.env.AWS_S3_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const listS3Folders = async (prefix) => {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return [];
  }

  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const folders = [];
  let continuationToken;
  do {
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: normalizedPrefix,
      Delimiter: '/',
      ContinuationToken: continuationToken,
    }));
    for (const item of response.CommonPrefixes ?? []) {
      if (!item.Prefix) continue;
      const folder = item.Prefix.replace(normalizedPrefix, '').replace('/', '');
      if (folder && !folder.startsWith('_used_')) folders.push(folder);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return folders;
};

const folderMatches = (keyword, folders) => {
  const normalizedKeyword = normalize(keyword);
  return folders.some((folder) => {
    const normalizedFolder = normalize(folder);
    const normalizedBase = normalize(stripFolderSuffix(folder));
    return normalizedKeyword === normalizedFolder
      || normalizedKeyword === normalizedBase
      || normalizedKeyword.includes(normalizedFolder)
      || normalizedKeyword.includes(normalizedBase);
  });
};

const scheduleIso = (date, slot) => `${date}T${slot}:00+09:00`;

const compareByOrder = (order) => (left, right) => {
  const leftIndex = order.indexOf(left.accountId);
  const rightIndex = order.indexOf(right.accountId);
  const safeLeft = leftIndex < 0 ? 999 : leftIndex;
  const safeRight = rightIndex < 0 ? 999 : rightIndex;
  if (safeLeft !== safeRight) return safeLeft - safeRight;
  return (left.displayName ?? left.accountId).localeCompare(right.displayName ?? right.accountId, 'ko');
};

const loadAccounts = async ({ categories, order }) => {
  const db = mongoose.connection.db;
  const accountRows = await db.collection('blogaccounts')
    .find({
      category: { $in: categories },
      $or: [{ isEnabled: true }, { isEnabled: { $exists: false } }],
      status: { $ne: 'disabled' },
    }, { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, category: 1, status: 1, note: 1 } })
    .toArray();

  const ids = accountRows.map((account) => account.accountId).filter(Boolean);
  const credentialRows = await mongoose.connection.useDb('cafe-bot')
    .collection('accounts')
    .find({ accountId: { $in: ids } }, { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, password: 1 } })
    .toArray();
  const credentials = new Map(credentialRows.map((credential) => [credential.accountId, credential]));

  const accounts = [];
  const blocked = [];
  for (const row of accountRows) {
    const accountId = row.accountId;
    if (!accountId) continue;
    const credential = credentials.get(accountId);
    const displayName = (row.nickname || credential?.nickname || accountId).replace(/\s+/g, ' ').trim();
    if (!credential?.password) {
      blocked.push({
        accountId,
        displayName,
        category: row.category,
        reason: row.status === 'credential_error' ? 'credential_error' : 'missing_password',
      });
      continue;
    }
    accounts.push({
      accountId,
      password: credential.password,
      blogId: row.blogId || credential.blogId || accountId,
      displayName,
      category: row.category,
    });
  }

  return {
    accounts: accounts.sort(compareByOrder(order)),
    blocked: blocked.sort(compareByOrder(order)),
  };
};

const loadGoodCounts = async (accountIds, date) => {
  if (accountIds.length === 0) return new Map();
  const rows = await mongoose.connection.db.collection('schedules').aggregate([
    { $match: { accountId: { $in: accountIds }, scheduleDate: date, status: { $ne: 'cancelled' } } },
    { $lookup: { from: 'schedulejobs', localField: '_id', foreignField: 'scheduleId', as: 'jobs' } },
    { $unwind: '$jobs' },
    { $match: { 'jobs.status': { $nin: ['failed', 'cancelled'] } } },
    { $group: { _id: '$accountId', count: { $sum: 1 } } },
  ]).toArray();
  return new Map(rows.map((row) => [row._id, row.count]));
};

const loadExistingKeywords = async (date) => {
  const rows = await mongoose.connection.db.collection('schedules').aggregate([
    { $match: { scheduleDate: date, status: { $ne: 'cancelled' } } },
    { $lookup: { from: 'schedulejobs', localField: '_id', foreignField: 'scheduleId', as: 'jobs' } },
    { $unwind: '$jobs' },
    { $match: { 'jobs.status': { $nin: ['failed', 'cancelled'] } } },
    { $project: { keyword: '$jobs.keyword' } },
  ]).toArray();
  return new Set(rows.map((row) => String(row.keyword ?? '')).filter(Boolean));
};

const buildQueues = async ({ domain, accounts, candidates, date, seed, goodCounts, existingKeywords }) => {
  const assignedKeywords = new Set(existingKeywords);
  const shuffled = shuffle(candidates, seed);
  const queues = [];
  const shortfalls = [];

  for (const account of accounts) {
    const goodCount = goodCounts.get(account.accountId) ?? 0;
    const missing = Math.max(0, perAccount - goodCount);
    if (missing === 0) continue;

    const folders = await listS3Folders(`product-images/${account.blogId || account.accountId}`);
    const available = shuffled
      .filter((candidate) => !assignedKeywords.has(candidate.keyword))
      .map((candidate) => ({
        ...candidate,
        hasProductFolder: folderMatches(candidate.keyword, folders),
      }))
      .sort((left, right) => Number(right.hasProductFolder) - Number(left.hasProductFolder));

    const selected = available.slice(0, missing);
    for (const item of selected) assignedKeywords.add(item.keyword);

    if (selected.length < missing) {
      shortfalls.push({
        accountId: account.accountId,
        displayName: account.displayName,
        needed: missing,
        selected: selected.length,
      });
    }

    if (selected.length > 0) {
      const selectedSlots = slots.slice(0, selected.length);
      queues.push({
        account: {
          id: account.accountId,
          password: account.password,
          blogId: account.blogId,
        },
        blog_name: account.displayName,
        keywords: selected.map((item) => item.keyword),
        items: selected.map((item, index) => ({
          keyword: item.keyword,
          scheduledAt: scheduleIso(date, selectedSlots[index]),
          slot: goodCount + index + 1,
        })),
        debug: {
          domain,
          category: account.category,
          productFolders: folders.length,
          productFolderHits: selected.filter((item) => item.hasProductFolder).length,
        },
      });
    }
  }

  return { queues, shortfalls };
};

const findMobileManuscript = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const found = entries.find((entry) => entry.isFile() && entry.name.normalize('NFC').startsWith('[모바일발행]') && entry.name.endsWith('.txt'));
  if (!found) throw new Error(`mobile manuscript missing: ${dir}`);
  return path.join(dir, found.name);
};

const findSlides = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const slideDir = entries.find((entry) => entry.isDirectory() && entry.name.normalize('NFC').endsWith('_slides'));
  if (!slideDir) throw new Error(`slides missing: ${dir}`);
  const slideRoot = path.join(dir, slideDir.name);
  const slides = (await fs.readdir(slideRoot))
    .filter((name) => /^slide_\d{2}\.png$/u.test(name.normalize('NFC')))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((name) => path.join(slideRoot, name));
  if (slides.length !== 6) throw new Error(`slides count mismatch: ${dir}, ${slides.length}`);
  return slides;
};

const loadBrandItems = async () => {
  const monthDirs = (await fs.readdir(BRAND_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+월$/u.test(entry.name.normalize('NFC')))
    .sort((left, right) => Number.parseInt(left.name, 10) - Number.parseInt(right.name, 10));
  const items = [];
  for (const monthDir of monthDirs) {
    const monthPath = path.join(BRAND_ROOT, monthDir.name);
    const postDirs = (await fs.readdir(monthPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d+\./u.test(entry.name.normalize('NFC')))
      .sort((left, right) => Number.parseInt(left.name, 10) - Number.parseInt(right.name, 10));
    for (const postDir of postDirs) {
      const postPath = path.join(monthPath, postDir.name);
      const manuscriptPath = await findMobileManuscript(postPath);
      const content = await fs.readFile(manuscriptPath, 'utf8');
      const title = content.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
      const keyword = postDir.name.normalize('NFC').replace(/^\d+\./u, '').trim();
      items.push({
        keyword,
        title: title || keyword,
        manuscriptPath,
        slidePaths: await findSlides(postPath),
      });
    }
  }
  return items;
};

const loadUsedBrandKeywords = async () => {
  const rows = await mongoose.connection.db.collection('schedules').aggregate([
    { $match: { accountId: 'adplan3th', status: { $ne: 'cancelled' } } },
    { $lookup: { from: 'schedulejobs', localField: '_id', foreignField: 'scheduleId', as: 'jobs' } },
    { $unwind: '$jobs' },
    { $match: { 'jobs.status': { $ne: 'cancelled' } } },
    { $project: { keyword: '$jobs.keyword' } },
  ]).toArray();
  return new Set(rows.map((row) => String(row.keyword ?? '')).filter(Boolean));
};

const buildBrandQueue = async (date) => {
  const password = process.env.NAVER_BRAND_PASSWORD;
  if (!password) {
    return { queue: null, blocked: { accountId: 'adplan3th', displayName: '에스앤비안과 브랜드', reason: 'missing_runtime_password' } };
  }

  const used = await loadUsedBrandKeywords();
  const items = (await loadBrandItems()).filter((item) => !used.has(item.keyword)).slice(0, perAccount);
  if (items.length === 0) {
    return { queue: null, blocked: { accountId: 'adplan3th', displayName: '에스앤비안과 브랜드', reason: 'no_unused_local_package' } };
  }
  return {
    queue: {
      account: { id: 'adplan3th', password, blogId: 'adplan3th' },
      blog_name: '에스앤비안과 브랜드',
      keywords: items.map((item) => item.keyword),
      items: items.map((item, index) => ({
        keyword: item.keyword,
        scheduledAt: scheduleIso(date, slots[index]),
        slot: index + 1,
      })),
      manuscripts: await Promise.all(items.map(async (item) => ({
        title: item.title,
        content: await fs.readFile(item.manuscriptPath, 'utf8'),
      }))),
      multi_images: items.map((item) => ({ slide: item.slidePaths })),
    },
    blocked: null,
  };
};

const sanitizeQueues = (queues) => queues.map((queue) => ({
  accountId: queue.account.id,
  blogId: queue.account.blogId,
  blogName: queue.blog_name,
  keywords: queue.keywords,
  items: queue.items,
  debug: queue.debug,
}));

const callAutoSchedule = async (label, body) => {
  const response = await fetch(`${API_URL}/bot/auto-schedule`, {
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

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI missing');
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const [eyeCandidates, petCandidates, existingKeywords] = await Promise.all([
      fetchSheetCandidates(EYE_GID),
      fetchSheetCandidates(PET_GID),
      loadExistingKeywords(scheduleDate),
    ]);

    const plan = {
      generatedAt: new Date().toISOString(),
      execute,
      scheduleDate,
      slots,
      perAccount,
      domains: {},
      blocked: {},
      submissions: {},
    };

    if (includeEye) {
      const { accounts, blocked } = await loadAccounts({ categories: EYE_CATEGORIES, order: EYE_ORDER });
      const goodCounts = await loadGoodCounts(accounts.map((account) => account.accountId), scheduleDate);
      const built = await buildQueues({
        domain: '안과',
        accounts,
        candidates: eyeCandidates,
        date: scheduleDate,
        seed: `eye-makeup:${scheduleDate}:${slots.join(',')}`,
        goodCounts,
        existingKeywords,
      });
      plan.domains.eye = sanitizeQueues(built.queues);
      plan.blocked.eye = [...blocked, ...built.shortfalls];
      if (execute && built.queues.length > 0) {
        plan.submissions.eye = await callAutoSchedule('eye', {
          queues: built.queues.map(({ debug, ...queue }) => queue),
          schedule_date: scheduleDate,
          schedule_mode: '3',
          service: 'ophthalmology-sheet-makeup',
          ref: `eye-sheet-${EYE_GID}-${scheduleDate}-makeup-${slots.join('').replace(/:/g, '')}`,
          generate_images: true,
          image_count: 5,
          image_source: 'product',
          manuscript_type: 'default',
          delay_between_posts: 10,
          keyword_category: '안과',
        });
      }
    }

    if (includePet) {
      const { accounts, blocked } = await loadAccounts({ categories: PET_CATEGORIES, order: PET_ORDER });
      const goodCounts = await loadGoodCounts(accounts.map((account) => account.accountId), scheduleDate);
      const built = await buildQueues({
        domain: '애견',
        accounts,
        candidates: petCandidates,
        date: scheduleDate,
        seed: `pet-makeup:${scheduleDate}:${slots.join(',')}`,
        goodCounts,
        existingKeywords,
      });
      plan.domains.pet = sanitizeQueues(built.queues);
      plan.blocked.pet = [...blocked, ...built.shortfalls];
      if (execute && built.queues.length > 0) {
        plan.submissions.pet = await callAutoSchedule('pet', {
          queues: built.queues.map(({ debug, ...queue }) => queue),
          schedule_date: scheduleDate,
          schedule_mode: '3',
          service: 'pet-sheet-makeup',
          ref: `pet-sheet-${PET_GID}-${scheduleDate}-makeup-${slots.join('').replace(/:/g, '')}`,
          generate_images: true,
          image_count: 5,
          image_source: 'product',
          manuscript_type: 'pet',
          delay_between_posts: 10,
          keyword_category: '애견',
        });
      }
    }

    if (includeBrand) {
      const { queue, blocked } = await buildBrandQueue(scheduleDate);
      plan.domains.brand = queue ? sanitizeQueues([queue]) : [];
      plan.blocked.brand = blocked ? [blocked] : [];
      if (execute && queue) {
        plan.submissions.brand = await callAutoSchedule('brand', {
          queues: [queue],
          schedule_date: scheduleDate,
          schedule_mode: '3',
          service: 'eye-brand-local-makeup',
          ref: `eye-brand-local-${scheduleDate}-makeup-${slots.join('').replace(/:/g, '')}`,
          generate_images: false,
          image_count: 6,
          image_source: 'local',
          manuscript_type: 'default',
          delay_between_posts: 10,
          keyword_category: '안과브랜드',
        });
      }
    }

    await fs.mkdir(path.resolve(process.cwd(), 'work'), { recursive: true });
    const outPath = path.resolve(process.cwd(), 'work', `makeup-schedule-${scheduleDate}-${Date.now()}.json`);
    await fs.writeFile(outPath, JSON.stringify(plan, null, 2), 'utf8');
    console.log(JSON.stringify({
      outPath,
      execute,
      scheduleDate,
      counts: Object.fromEntries(Object.entries(plan.domains).map(([key, queues]) => [
        key,
        {
          accounts: queues.length,
          jobs: queues.reduce((sum, queue) => sum + queue.items.length, 0),
        },
      ])),
      blocked: Object.fromEntries(Object.entries(plan.blocked).map(([key, rows]) => [key, rows])),
      submissions: Object.fromEntries(Object.entries(plan.submissions).map(([key, value]) => [
        key,
        {
          totalJobs: value.totalJobs,
          schedules: value.schedules?.map((schedule) => ({
            account: schedule.account,
            totalJobs: schedule.totalJobs,
            reused: schedule.reused,
            scheduleId: schedule.scheduleId,
          })) ?? [],
        },
      ])),
    }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
