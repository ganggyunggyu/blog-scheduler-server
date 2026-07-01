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

const SCHEDULE_DATE = '2026-07-01';
const SCHEDULE_MODE = '2';
const PET_GID = '1960709235';
const SHEET_ID = '1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c';
const API_URL = process.env.SCHEDULER_API_URL ?? 'http://localhost:8001';
const EXECUTE = process.argv.includes('--execute');
const OUT_PATH = path.resolve(process.cwd(), `outputs/pet-autopublish-${SCHEDULE_DATE}.json`);
const PET_CATEGORIES = ['서리펫', '도그마루 글밥'];

const s3Client = new S3Client({
  region: process.env.AWS_S3_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

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

const fetchSheetRows = async () => {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${PET_GID}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cache-Control': 'no-cache',
    },
  });
  if (!response.ok) throw new Error(`sheet fetch failed: ${response.status}`);
  return parseCsv(await response.text());
};

const extractSheetKeywords = (rows) => {
  const preferred = [];
  const fallback = [];
  const seen = new Set();

  for (const [index, row] of rows.entries()) {
    if (index === 0) continue;
    const keyword = row[0]?.trim() ?? '';
    const exposed = row[3]?.trim() ?? '';
    const newLogic = row[6]?.trim().toLowerCase() ?? '';
    if (!keyword || keyword.startsWith('키워드 ') || seen.has(keyword)) continue;
    if (newLogic && newLogic !== 'o') continue;
    seen.add(keyword);
    const candidate = { keyword, exposed, newLogic };
    if (!exposed || exposed.toLowerCase() !== 'o') {
      preferred.push(candidate);
    } else {
      fallback.push(candidate);
    }
  }

  return [...preferred, ...fallback];
};

const normalize = (value) => value.normalize('NFC').replace(/\s+/g, '').toLowerCase().trim();

const stripFolderSuffix = (value) => value.replace(/^_used_/u, '').replace(/_\d+$/u, '');

const folderMatches = (keyword, folder) => {
  const normalizedKeyword = normalize(keyword);
  const normalizedFolder = normalize(folder);
  const normalizedBase = normalize(stripFolderSuffix(folder));
  return normalizedKeyword === normalizedFolder
    || normalizedKeyword === normalizedBase
    || normalizedKeyword.includes(normalizedFolder)
    || normalizedKeyword.includes(normalizedBase);
};

const listS3Folders = async (prefix) => {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return [];

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

const countS3Images = async (prefix) => {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return 0;

  const response = await s3Client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
    MaxKeys: 1000,
  }));
  const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
  return (response.Contents ?? []).filter((item) => {
    const key = item.Key ?? '';
    return extensions.some((extension) => key.toLowerCase().endsWith(extension));
  }).length;
};

const categorizePetKeyword = (keyword) => {
  const normalized = normalize(keyword);
  const infoTokens = ['분양', '무료분양', '입양', '유기', '보호', '센터', '조건', '펫샵', '파양'];
  const catTokens = [
    '고양이', '코숏', '묘', '코리안숏헤어', '숏헤어', '브리티쉬', '스코티시',
    '폴드', '렉돌', '랙돌', '러시안블루', '앙고라', '샴', '아비시니안',
    '먼치킨', '메인쿤', '페르시안', '스핑크스', '쇼트헤어', '뱅갈', '친칠라',
    '터키시', '노르웨이',
  ];
  const isInfo = infoTokens.some((token) => normalized.includes(normalize(token)));
  const isCat = catTokens.some((token) => normalized.includes(normalize(token)));
  if (isInfo) return isCat ? '고양이분양정보' : '강아지분양정보';
  return isCat ? '고양이품종' : '강아지품종';
};

const loadPetAccounts = async (db) => db.collection('blogaccounts')
  .find(
    {
      category: { $in: PET_CATEGORIES },
      $or: [{ isEnabled: true }, { isEnabled: { $exists: false } }],
      status: { $ne: 'disabled' },
    },
    { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, category: 1, status: 1, note: 1 } },
  )
  .sort({ category: 1, nickname: 1 })
  .toArray();

const loadCredentials = async (cafeDb, accountIds) => {
  const rows = await cafeDb.collection('accounts')
    .find(
      { accountId: { $in: accountIds } },
      { projection: { _id: 0, accountId: 1, password: 1, blogId: 1, nickname: 1 } },
    )
    .toArray();
  return new Map(rows.filter((row) => row.accountId && row.password).map((row) => [row.accountId, row]));
};

const loadExistingKeywords = async (db, accountIds) => {
  const schedules = await db.collection('schedules')
    .find(
      { accountId: { $in: accountIds }, status: { $ne: 'cancelled' } },
      { projection: { _id: 1 } },
    )
    .toArray();
  if (schedules.length === 0) return new Set();

  const jobs = await db.collection('schedulejobs')
    .find(
      { scheduleId: { $in: schedules.map((schedule) => schedule._id) }, status: { $nin: ['cancelled', 'failed'] } },
      { projection: { _id: 0, keyword: 1 } },
    )
    .toArray();
  return new Set(jobs.map((job) => job.keyword).filter(Boolean));
};

const loadTodayGoodCounts = async (db, accountIds) => {
  const rows = await db.collection('schedules').aggregate([
    { $match: { accountId: { $in: accountIds }, scheduleDate: SCHEDULE_DATE, status: { $ne: 'cancelled' } } },
    { $lookup: { from: 'schedulejobs', localField: '_id', foreignField: 'scheduleId', as: 'jobs' } },
    { $unwind: '$jobs' },
    { $match: { 'jobs.status': { $nin: ['failed', 'cancelled'] } } },
    { $group: { _id: '$accountId', count: { $sum: 1 }, keywords: { $push: '$jobs.keyword' } } },
  ]).toArray();
  return new Map(rows.map((row) => [row._id, { count: row.count, keywords: row.keywords ?? [] }]));
};

const selectKeywordsForAccount = async ({ account, candidates, usedKeywords, needed }) => {
  const folders = await listS3Folders(`product-images/${account.blogId || account.accountId}`);
  const selected = [];
  const rejected = [];
  const ordered = [
    ...candidates.filter((candidate) => !usedKeywords.has(candidate.keyword)),
    ...candidates.filter((candidate) => usedKeywords.has(candidate.keyword)),
  ];

  for (const candidate of ordered) {
    if (selected.some((item) => item.keyword === candidate.keyword)) continue;
    const matchedFolder = folders.find((folder) => folderMatches(candidate.keyword, folder));
    if (!matchedFolder) {
      if (rejected.length < 20) rejected.push({ keyword: candidate.keyword, reason: 'no_s3_folder' });
      continue;
    }

    const base = `product-images/${account.blogId || account.accountId}/${matchedFolder}`;
    const libraryCount = await countS3Images(`${base}/라이브러리제외`)
      + await countS3Images(`${base}/라이브러리제외이미지`);
    if (libraryCount <= 0) {
      if (rejected.length < 20) rejected.push({ keyword: candidate.keyword, folder: matchedFolder, reason: 'no_exclude_library_image' });
      continue;
    }

    usedKeywords.add(candidate.keyword);
    selected.push({
      keyword: candidate.keyword,
      category: categorizePetKeyword(candidate.keyword),
      folder: matchedFolder,
      libraryCount,
    });

    if (selected.length >= needed) break;
  }

  return { selected, folders: folders.length, rejected };
};

const callAutoSchedule = async (body) => {
  const response = await fetch(`${API_URL}/bot/auto-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success !== true) {
    throw new Error(`pet auto-schedule failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
};

const sanitizeSubmission = (json) => ({
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
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const db = mongoose.connection.db;
    const cafeDb = mongoose.connection.useDb('cafe-bot');
    const [rows, accounts] = await Promise.all([
      fetchSheetRows(),
      loadPetAccounts(db),
    ]);
    const accountIds = accounts.map((account) => account.accountId);
    const [credentials, existingKeywords, todayGoodCounts] = await Promise.all([
      loadCredentials(cafeDb, accountIds),
      loadExistingKeywords(db, accountIds),
      loadTodayGoodCounts(db, accountIds),
    ]);
    const candidates = extractSheetKeywords(rows);
    const usedKeywords = new Set(existingKeywords);
    const queues = [];
    const blocked = [];

    for (const account of accounts) {
      const todayGood = todayGoodCounts.get(account.accountId) ?? { count: 0, keywords: [] };
      const needed = Math.max(0, 2 - todayGood.count);
      if (needed === 0) continue;

      if (account.status === 'credential_error') {
        blocked.push({ accountId: account.accountId, blogId: account.blogId, nickname: account.nickname, category: account.category, reason: 'credential_error', currentGoodCount: todayGood.count });
        continue;
      }

      const credential = credentials.get(account.accountId);
      if (!credential?.password) {
        blocked.push({ accountId: account.accountId, blogId: account.blogId, nickname: account.nickname, category: account.category, reason: 'missing_runtime_password', currentGoodCount: todayGood.count });
        continue;
      }

      const selectedResult = await selectKeywordsForAccount({
        account,
        candidates,
        usedKeywords,
        needed,
      });

      if (selectedResult.selected.length < needed) {
        blocked.push({
          accountId: account.accountId,
          blogId: account.blogId,
          nickname: account.nickname,
          category: account.category,
          reason: 'insufficient_s3_backed_keywords',
          currentGoodCount: todayGood.count,
          needed,
          selected: selectedResult.selected.length,
          folders: selectedResult.folders,
          rejected: selectedResult.rejected,
        });
      }

      if (selectedResult.selected.length === 0) continue;

      queues.push({
        account: {
          id: account.accountId,
          password: credential.password,
          blogId: account.blogId || credential.blogId || account.accountId,
        },
        blog_name: (account.nickname || credential.nickname || account.accountId).replace(/\s+/g, ''),
        keywords: selectedResult.selected.map((item) => `${item.keyword}:${item.category}`),
        debug: {
          category: account.category,
          currentGoodCount: todayGood.count,
          selected: selectedResult.selected,
          s3FolderCount: selectedResult.folders,
        },
      });
    }

    const body = {
      queues: queues.map(({ debug, ...queue }) => queue),
      schedule_date: SCHEDULE_DATE,
      schedule_mode: SCHEDULE_MODE,
      service: 'pet-sheet-daily',
      ref: `pet-sheet-${PET_GID}-${SCHEDULE_DATE}-two-per-account-${Date.now()}`,
      generate_images: true,
      image_count: 5,
      image_source: 'product',
      manuscript_type: 'pet',
      delay_between_posts: 10,
      keyword_category: '애견',
    };

    const submission = EXECUTE && queues.length > 0
      ? sanitizeSubmission(await callAutoSchedule(body))
      : {};

    const report = {
      generatedAt: new Date().toISOString(),
      executed: EXECUTE,
      scheduleDate: SCHEDULE_DATE,
      scheduleMode: SCHEDULE_MODE,
      sheet: { id: SHEET_ID, gid: PET_GID, sourceRows: rows.length, candidateCount: candidates.length },
      accounts: { total: accounts.length, queued: queues.length, blocked: blocked.length },
      queues: queues.map((queue) => ({
        accountId: queue.account.id,
        blogId: queue.account.blogId,
        blogName: queue.blog_name,
        keywords: queue.debug.selected.map((item) => ({
          keyword: item.keyword,
          category: item.category,
          folder: item.folder,
          libraryCount: item.libraryCount,
        })),
        currentGoodCount: queue.debug.currentGoodCount,
      })),
      blocked,
      submission,
    };

    await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
    await fs.writeFile(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');

    console.log(JSON.stringify({
      output: OUT_PATH,
      executed: EXECUTE,
      scheduleDate: SCHEDULE_DATE,
      queuedAccounts: report.accounts.queued,
      queuedJobs: report.queues.reduce((sum, queue) => sum + queue.keywords.length, 0),
      blocked: blocked.map(({ accountId, nickname, reason, needed, selected }) => ({
        accountId,
        nickname,
        reason,
        needed,
        selected,
      })),
      submission: submission.totalJobs !== undefined
        ? { totalJobs: submission.totalJobs, scheduleCount: submission.schedules.length }
        : {},
    }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
