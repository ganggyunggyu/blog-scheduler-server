import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import mongoose from 'mongoose';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

process.env.DOTENV_CONFIG_QUIET = 'true';
loadDotenv({ path: path.resolve(process.cwd(), '.env'), override: false, quiet: true });
loadDotenv({ path: '/Users/ganggyunggyu/temp-image-gen/.env.local', override: false, quiet: true });

const tempRequire = createRequire('/Users/ganggyunggyu/temp-image-gen/package.json');
const { S3Client, ListObjectsV2Command } = tempRequire('@aws-sdk/client-s3');

const API_URL = process.env.SCHEDULER_API_URL ?? 'http://localhost:8001';
const SCHEDULE_DATE = '2026-06-18';
const SHEET_ID = '1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c';
const PET_GID = '1960709235';
const EYE_GID = '633450920';
const PAST_SLOTS = ['22:01', '22:02', '22:03'];

const petTargets = [
  { accountId: 'b6x2k9w3', blogId: 'b6x2k9w3', blogName: '웅이', count: 2 },
  { accountId: 'loand3324', blogId: 'loand3324', blogName: '라우드', count: 2 },
  { accountId: '8ua1womn', blogId: '8ua1womn', blogName: '세월', count: 2 },
];

const eyeTargets = [
  { accountId: 'ghhoy', blogId: 'ghhoy', blogName: '탐험기 - 교체', count: 3 },
];

const blockedTargets = [
  { accountId: 'pwg7r3sl', blogId: 'pwg7r3sl', blogName: '오리의 다락방', domain: '법률', count: 2 },
];

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
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

const normalize = (value) => value.normalize('NFC').replace(/\s+/g, '').toLowerCase().trim();
const stripFolderSuffix = (value) => value.replace(/^_used_/u, '').replace(/_\d+$/u, '');

const fetchSheetKeywords = async (gid) => {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) {
    throw new Error(`sheet fetch failed gid=${gid} status=${response.status}`);
  }

  const rows = parseCsv(await response.text());
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
    fallback.push(keyword);
    if (!exposed || exposed.toLowerCase() !== 'o') {
      preferred.push(keyword);
    }
  }

  return preferred.length > 0 ? preferred : fallback;
};

const petInfoTokens = ['분양', '무료분양', '입양', '유기', '보호', '센터', '조건', '펫샵', '파양'];
const petCatTokens = [
  '고양이', '코숏', '묘', '코리안숏헤어', '숏헤어', '브리티쉬', '스코티시',
  '폴드', '렉돌', '랙돌', '러시안블루', '앙고라', '샴', '아비시니안',
  '먼치킨', '메인쿤', '페르시안', '스핑크스', '쇼트헤어', '뱅갈', '친칠라',
  '터키시', '노르웨이',
];

const categorizePetKeyword = (keyword) => {
  const normalized = normalize(keyword);
  const isInfo = petInfoTokens.some((token) => normalized.includes(normalize(token)));
  const isCat = petCatTokens.some((token) => normalized.includes(normalize(token)));
  if (isInfo) return isCat ? '고양이분양정보' : '강아지분양정보';
  return isCat ? '고양이품종' : '강아지품종';
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
  if (!bucket) return [];

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
  if (!bucket) return 0;
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
  const response = await s3Client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
    MaxKeys: 1000,
  }));
  return (response.Contents ?? []).filter((item) => {
    const key = item.Key ?? '';
    return imageExtensions.some((extension) => key.toLowerCase().endsWith(extension));
  }).length;
};

const folderMatches = (keyword, folder) => {
  const normalizedKeyword = normalize(keyword);
  const normalizedFolder = normalize(folder);
  const normalizedBase = normalize(stripFolderSuffix(folder));
  return normalizedKeyword === normalizedFolder
    || normalizedKeyword === normalizedBase
    || normalizedKeyword.includes(normalizedFolder)
    || normalizedKeyword.includes(normalizedBase);
};

const loadExistingKeywords = async () => {
  const rows = await mongoose.connection.db.collection('schedules').aggregate([
    { $match: { scheduleDate: SCHEDULE_DATE, status: { $ne: 'cancelled' } } },
    { $lookup: { from: 'schedulejobs', localField: '_id', foreignField: 'scheduleId', as: 'jobs' } },
    { $unwind: '$jobs' },
    { $match: { 'jobs.status': { $nin: ['failed', 'cancelled'] } } },
    { $project: { keyword: '$jobs.keyword' } },
  ]).toArray();
  return new Set(rows.map((row) => String(row.keyword ?? '')).filter(Boolean));
};

const buildRedis = () => new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  db: Number(process.env.REDIS_DB || 0),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

const loadPassword = async (redis, accountId) => {
  const cafeAccount = await mongoose.connection.useDb('cafe-bot')
    .collection('accounts')
    .findOne({ accountId }, { projection: { _id: 0, password: 1 } });
  if (cafeAccount?.password) return { password: cafeAccount.password, source: 'cafe-bot.accounts' };

  for (const queueName of [`generate_${accountId}`, `publish_${accountId}`]) {
    const queue = new Queue(queueName, { connection: redis });
    try {
      const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'], 0, 800, false);
      for (const job of jobs) {
        const password = job.data?.account?.password;
        if (password) return { password, source: queueName };
      }
    } finally {
      await queue.close();
    }
  }

  return { password: '', source: '' };
};

const scheduleIso = (slot) => `${SCHEDULE_DATE}T${slot}:00+09:00`;

const buildPetQueues = async ({ petKeywords, existingKeywords, redis }) => {
  const queues = [];
  const blocked = [];
  const used = new Set(existingKeywords);

  for (const target of petTargets) {
    const credential = await loadPassword(redis, target.accountId);
    if (!credential.password) {
      blocked.push({ ...target, reason: 'missing_password' });
      continue;
    }

    const folders = await listS3Folders(`product-images/${target.blogId}`);
    const candidates = [];

    for (const folder of folders) {
      const libraryCount = await countS3Images(`product-images/${target.blogId}/${folder}/라이브러리제외`)
        + await countS3Images(`product-images/${target.blogId}/${folder}/라이브러리제외이미지`);
      if (libraryCount <= 0) continue;

      const sheetKeyword = petKeywords.find((keyword) => folderMatches(keyword, folder));
      const keyword = sheetKeyword ?? folder;
      if (used.has(keyword)) continue;
      candidates.push({ keyword, folder, libraryCount });
    }

    const selected = candidates.slice(0, target.count);
    for (const item of selected) used.add(item.keyword);

    if (selected.length < target.count) {
      blocked.push({
        ...target,
        reason: 'insufficient_pet_s3_keywords',
        needed: target.count,
        selected: selected.length,
      });
    }

    if (selected.length > 0) {
      queues.push({
        account: { id: target.accountId, password: credential.password, blogId: target.blogId },
        blog_name: target.blogName,
        keywords: selected.map((item) => item.keyword),
        items: selected.map((item, index) => ({
          keyword: item.keyword,
          category: categorizePetKeyword(item.keyword),
          scheduledAt: scheduleIso(PAST_SLOTS[index]),
          slot: index + 1,
        })),
        debug: {
          credentialSource: credential.source,
          productFolders: folders.length,
          selected: selected.map(({ keyword, folder, libraryCount }) => ({ keyword, folder, libraryCount })),
        },
      });
    }
  }

  return { queues, blocked };
};

const buildEyeQueues = async ({ eyeKeywords, existingKeywords, redis }) => {
  const queues = [];
  const blocked = [];
  const used = new Set(existingKeywords);

  for (const target of eyeTargets) {
    const credential = await loadPassword(redis, target.accountId);
    if (!credential.password) {
      blocked.push({ ...target, reason: 'missing_password' });
      continue;
    }

    const selected = eyeKeywords.filter((keyword) => !used.has(keyword)).slice(0, target.count);
    for (const keyword of selected) used.add(keyword);

    if (selected.length < target.count) {
      blocked.push({ ...target, reason: 'insufficient_eye_sheet_keywords', needed: target.count, selected: selected.length });
    }

    if (selected.length > 0) {
      queues.push({
        account: { id: target.accountId, password: credential.password, blogId: target.blogId },
        blog_name: target.blogName,
        keywords: selected,
        items: selected.map((keyword, index) => ({
          keyword,
          scheduledAt: scheduleIso(PAST_SLOTS[index]),
          slot: index + 1,
        })),
        debug: { credentialSource: credential.source },
      });
    }
  }

  return { queues, blocked };
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

const sanitizeSubmission = (submission) => ({
  totalJobs: submission.totalJobs,
  schedules: (submission.schedules ?? []).map((schedule) => ({
    account: schedule.account,
    reused: schedule.reused,
    totalJobs: schedule.totalJobs,
    scheduleId: schedule.scheduleId,
    jobs: schedule.jobs,
  })),
});

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI missing');

  const redis = buildRedis();
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const [petKeywords, eyeKeywords, existingKeywords] = await Promise.all([
      fetchSheetKeywords(PET_GID),
      fetchSheetKeywords(EYE_GID),
      loadExistingKeywords(),
    ]);

    const plan = {
      generatedAt: new Date().toISOString(),
      scheduleDate: SCHEDULE_DATE,
      mode: 'execute',
      blocked: {},
      queues: {},
      submissions: {},
    };

    const pet = await buildPetQueues({ petKeywords, existingKeywords, redis });
    plan.queues.pet = sanitizeQueues(pet.queues);
    plan.blocked.pet = pet.blocked;

    if (pet.queues.length > 0) {
      plan.submissions.pet = sanitizeSubmission(await callAutoSchedule('pet', {
        queues: pet.queues.map(({ debug, ...queue }) => queue),
        schedule_date: SCHEDULE_DATE,
        schedule_mode: '2',
        service: 'pet-sheet-makeup-20260618',
        ref: 'pet-sheet-makeup-20260618-redis-password-past-slots',
        generate_images: true,
        image_count: 5,
        image_source: 'product',
        manuscript_type: 'pet',
        delay_between_posts: 10,
        keyword_category: '애견',
      }));
    }

    const eye = await buildEyeQueues({ eyeKeywords, existingKeywords, redis });
    plan.queues.eye = sanitizeQueues(eye.queues);
    plan.blocked.eye = eye.blocked;

    if (eye.queues.length > 0) {
      plan.submissions.eye = sanitizeSubmission(await callAutoSchedule('eye', {
        queues: eye.queues.map(({ debug, ...queue }) => queue),
        schedule_date: SCHEDULE_DATE,
        schedule_mode: '3',
        service: 'ophthalmology-sheet-makeup-20260618',
        ref: 'eye-sheet-makeup-20260618-ghhoy-redis-password-past-slots',
        generate_images: true,
        image_count: 5,
        image_source: 'product',
        manuscript_type: 'default',
        delay_between_posts: 10,
        keyword_category: '안과기본',
      }));
    }

    for (const target of blockedTargets) {
      const credential = await loadPassword(redis, target.accountId);
      if (!credential.password) {
        plan.blocked.legal = [{ ...target, reason: 'missing_password_in_cafe_db_and_bullmq_payload' }];
      }
    }

    await fs.mkdir(path.resolve(process.cwd(), 'outputs'), { recursive: true });
    const outPath = path.resolve(process.cwd(), 'outputs', 'missing-publish-makeup-2026-06-18.json');
    await fs.writeFile(outPath, JSON.stringify(plan, null, 2), 'utf8');

    console.log(JSON.stringify({
      outPath,
      counts: Object.fromEntries(Object.entries(plan.queues).map(([key, queues]) => [
        key,
        { accounts: queues.length, jobs: queues.reduce((sum, queue) => sum + queue.items.length, 0) },
      ])),
      blocked: plan.blocked,
      submissions: plan.submissions,
    }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
