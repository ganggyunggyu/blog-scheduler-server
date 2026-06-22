import { createRequire } from 'node:module';
import { createSign } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import mongoose from 'mongoose';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

process.env.DOTENV_CONFIG_QUIET = 'true';
loadDotenv({ path: path.resolve(process.cwd(), '.env'), override: false, quiet: true });
loadDotenv({ path: '/Users/ganggyunggyu/temp-image-gen/.env.local', override: false, quiet: true });
loadDotenv({ path: '/Users/ganggyunggyu/temp-image-gen/.env', override: false, quiet: true });

const tempRequire = createRequire('/Users/ganggyunggyu/temp-image-gen/package.json');
const { S3Client, ListObjectsV2Command } = tempRequire('@aws-sdk/client-s3');

const API_URL = process.env.SCHEDULER_API_URL ?? 'http://localhost:8001';
const SHEET_ID = '1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c';
const GIDS = {
  pet: '1960709235',
  eye: '633450920',
  goat: '1025121967',
};
const SHEET_TITLES = {
  [GIDS.pet]: '애견',
  [GIDS.eye]: '안과',
  [GIDS.goat]: '흑염소 신규',
};
const SCHEDULE_DATE = '2026-06-22';
const PAST_SLOTS = ['22:01', '22:02', '22:03'];
const execute = process.argv.includes('--execute');

const targets = [
  { accountId: 'b6x2k9w3', blogId: 'b6x2k9w3', blogName: 'b6x2k9w3', domain: 'pet', desired: 2 },
  { accountId: 'k7d9x2m4', blogId: 'k7d9x2m4', blogName: '강아지강하지 1', domain: 'pet', desired: 2 },
  { accountId: 'fail5644', blogId: 'fail5644', blogName: '고구마스틱2', domain: 'pet', desired: 2 },
  { accountId: 'loand3324', blogId: 'loand3324', blogName: '라우드 2', domain: 'pet', desired: 2 },
  { accountId: 'compare14310', blogId: 'compare14310', blogName: '룰루랄라 2', domain: 'pet', desired: 2 },
  { accountId: 'ghostrush7', blogId: 'ghostrush7', blogName: '실눈캐', domain: 'pet', desired: 2 },
  { accountId: '8ua1womn', blogId: '8ua1womn', blogName: '8ua1womn', domain: 'pet', desired: 2 },
  { accountId: 'n7c3w8z2', blogId: 'n7c3w8z2', blogName: '고양이밥 1', domain: 'pet', desired: 2 },
  { accountId: 'respawnking9', blogId: 'respawnking9', blogName: '리스팩식스팩 1', domain: 'pet', desired: 2 },
  { accountId: 'ahffkdlek12', blogId: 'ahffkdlek12', blogName: '바삭바삭해 1', domain: 'pet', desired: 2 },
  { accountId: 'ahsxkfldk12', blogId: 'ahsxkfldk12', blogName: '쉽고간단하게', domain: 'pet', desired: 2 },
  { accountId: 'ahfflwl123', blogId: 'ahfflwl123', blogName: '햄부기', domain: 'pet', desired: 2 },
  { accountId: 'ghhoy', blogId: 'ghhoy', blogName: '탐험기 - 교체', domain: 'eye', desired: 3 },
  { accountId: 'pixelninja3', blogId: 'pixelninja3', blogName: '건강박사석사 1', domain: 'goat', desired: 2 },
  { accountId: 'eghfsa5478', blogId: 'eghfsa5478', blogName: '오세아니야 1', domain: 'goat', desired: 2 },
];

const blockedStatic = [
  {
    accountId: 'pwg7r3sl',
    blogId: 'pwg7r3sl',
    blogName: '오리의 다락방',
    domain: 'legal',
    desired: 2,
    reason: 'keyword_sheet_tab_missing',
    detail: '미노출 시트 탭은 종합/흑염소 신규/흑염소 구/추상의구체화/윤슬/안과/애견뿐임',
  },
  {
    accountId: 'rqr1io45',
    blogId: 'rqr1io45',
    blogName: '알리바바 신규5',
    domain: 'alibaba',
    desired: 3,
    reason: 'naver_protection_and_disabled_account',
    detail: 'DB isEnabled=false, 오늘 3개 job 모두 보호조치 로그인 실패',
  },
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

const encodeBase64Url = (value) => Buffer.from(value).toString('base64url');

const buildGoogleJwt = () => {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !privateKeyRaw) return '';

  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = encodeBase64Url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKeyRaw.replace(/\\n/g, '\n').trim()).toString('base64url');
  return `${unsigned}.${signature}`;
};

let googleAccessToken = '';

const getGoogleAccessToken = async () => {
  if (googleAccessToken) return googleAccessToken;
  const assertion = buildGoogleJwt();
  if (!assertion) return '';

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`google token failed: ${response.status}`);
  }
  const json = await response.json();
  googleAccessToken = json.access_token;
  return googleAccessToken;
};

const quoteSheetTitle = (title) => `'${title.replace(/'/g, "''")}'`;

const fetchGoogleSheetRows = async (gid) => {
  const title = SHEET_TITLES[gid];
  if (!title) return [];
  const token = await getGoogleAccessToken();
  if (!token) return [];

  const range = `${quoteSheetTitle(title)}!A:H`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`google sheets failed gid=${gid} status=${response.status}`);
  }
  const json = await response.json();
  return json.values ?? [];
};

const fetchSheetCandidates = async (gid) => {
  let rows = [];
  try {
    rows = await fetchGoogleSheetRows(gid);
  } catch (error) {
    console.warn(`google sheets fetch failed gid=${gid}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (rows.length === 0) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) {
      throw new Error(`sheet fetch failed gid=${gid} status=${response.status}`);
    }
    rows = parseCsv(await response.text());
  }

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
    fallback.push({ keyword, exposed, newLogic });
    if (!exposed || exposed.toLowerCase() !== 'o') {
      preferred.push({ keyword, exposed, newLogic });
    }
  }

  return preferred.length > 0 ? preferred : fallback;
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
      const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'], 0, 1000, false);
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

const s3Client = new S3Client({
  region: process.env.AWS_S3_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

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

const folderMatches = (keyword, folder) => {
  const normalizedKeyword = normalize(keyword);
  const normalizedFolder = normalize(folder);
  const normalizedBase = normalize(stripFolderSuffix(folder));
  return normalizedKeyword === normalizedFolder
    || normalizedKeyword === normalizedBase
    || normalizedKeyword.includes(normalizedFolder)
    || normalizedKeyword.includes(normalizedBase);
};

const loadGoodCounts = async () => {
  const accountIds = targets.map((target) => target.accountId);
  const rows = await mongoose.connection.db.collection('schedules').aggregate([
    { $match: { accountId: { $in: accountIds }, scheduleDate: SCHEDULE_DATE, status: { $ne: 'cancelled' } } },
    { $lookup: { from: 'schedulejobs', localField: '_id', foreignField: 'scheduleId', as: 'jobs' } },
    { $unwind: '$jobs' },
    { $match: { 'jobs.status': { $nin: ['failed', 'cancelled'] } } },
    { $group: { _id: '$accountId', count: { $sum: 1 }, keywords: { $push: '$jobs.keyword' } } },
  ]).toArray();
  return new Map(rows.map((row) => [row._id, { count: row.count, keywords: row.keywords ?? [] }]));
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

const loadAccountRows = async () => {
  const accountIds = [...targets.map((target) => target.accountId), ...blockedStatic.map((target) => target.accountId)];
  const rows = await mongoose.connection.db.collection('blogaccounts')
    .find({ accountId: { $in: accountIds } }, {
      projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, category: 1, isEnabled: 1, status: 1, note: 1 },
    })
    .toArray();
  return new Map(rows.map((row) => [row.accountId, row]));
};

const scheduleIso = (slot) => `${SCHEDULE_DATE}T${slot}:00+09:00`;

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

const choosePetKeywords = async ({ target, candidates, usedKeywords, missing }) => {
  const folders = await listS3Folders(`product-images/${target.blogId}`);
  const selected = [];

  for (const candidate of candidates) {
    if (usedKeywords.has(candidate.keyword)) continue;
    const matchedFolder = folders.find((folder) => folderMatches(candidate.keyword, folder));
    if (!matchedFolder) continue;
    const libraryCount = await countS3Images(`product-images/${target.blogId}/${matchedFolder}/라이브러리제외`)
      + await countS3Images(`product-images/${target.blogId}/${matchedFolder}/라이브러리제외이미지`);
    if (libraryCount <= 0) continue;

    usedKeywords.add(candidate.keyword);
    selected.push({ ...candidate, folder: matchedFolder, libraryCount });
    if (selected.length >= missing) return { selected, folders: folders.length };
  }

  if (selected.length < missing) {
    for (const candidate of candidates) {
      if (usedKeywords.has(candidate.keyword)) continue;
      usedKeywords.add(candidate.keyword);
      selected.push({
        ...candidate,
        folder: '',
        libraryCount: 0,
        imageFallback: 'product-or-ai-fallback',
      });
      if (selected.length >= missing) break;
    }
  }

  return { selected, folders: folders.length };
};

const chooseGenericKeywords = ({ candidates, usedKeywords, missing }) => {
  const selected = [];
  for (const candidate of candidates) {
    if (usedKeywords.has(candidate.keyword)) continue;
    usedKeywords.add(candidate.keyword);
    selected.push(candidate);
    if (selected.length >= missing) break;
  }
  return selected;
};

const buildQueues = async ({ redis, candidatesByDomain, accountRows, goodCounts, existingKeywords }) => {
  const queuesByDomain = { pet: [], eye: [], goat: [] };
  const blocked = [];
  const usedKeywords = new Set(existingKeywords);

  for (const target of targets) {
    const accountRow = accountRows.get(target.accountId);
    const good = goodCounts.get(target.accountId) ?? { count: 0, keywords: [] };
    const missing = Math.max(0, target.desired - good.count);
    if (missing === 0) continue;

    if (accountRow?.isEnabled === false || accountRow?.status === 'disabled') {
      blocked.push({ ...target, reason: 'disabled_account', currentGoodCount: good.count });
      continue;
    }

    const credential = await loadPassword(redis, target.accountId);
    if (!credential.password) {
      blocked.push({ ...target, reason: 'missing_password', currentGoodCount: good.count });
      continue;
    }

    let selected = [];
    let debug = { credentialSource: credential.source, currentGoodCount: good.count, category: accountRow?.category };
    if (target.domain === 'pet') {
      const picked = await choosePetKeywords({
        target,
        candidates: candidatesByDomain.pet,
        usedKeywords,
        missing,
      });
      selected = picked.selected;
      debug = {
        ...debug,
        productFolders: picked.folders,
        selected: selected.map((item) => ({
          keyword: item.keyword,
          folder: item.folder,
          libraryCount: item.libraryCount,
          imageFallback: item.imageFallback,
        })),
      };
    } else {
      selected = chooseGenericKeywords({
        candidates: candidatesByDomain[target.domain],
        usedKeywords,
        missing,
      });
      debug = {
        ...debug,
        selected: selected.map((item) => ({ keyword: item.keyword })),
      };
    }

    if (selected.length < missing) {
      blocked.push({
        ...target,
        reason: 'insufficient_sheet_or_image_candidates',
        currentGoodCount: good.count,
        needed: missing,
        selected: selected.length,
      });
    }

    if (selected.length === 0) continue;

    queuesByDomain[target.domain].push({
      account: { id: target.accountId, password: credential.password, blogId: target.blogId },
      blog_name: target.blogName,
      keywords: selected.map((item) => item.keyword),
      items: selected.map((item, index) => ({
        keyword: item.keyword,
        category: target.domain === 'pet' ? categorizePetKeyword(item.keyword) : undefined,
        scheduledAt: scheduleIso(PAST_SLOTS[good.count + index] ?? PAST_SLOTS[index] ?? PAST_SLOTS.at(-1)),
        slot: good.count + index + 1,
      })),
      debug,
    });
  }

  return { queuesByDomain, blocked };
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

const summarizeSubmission = (submission) => ({
  totalJobs: submission.totalJobs,
  schedules: (submission.schedules ?? []).map((schedule) => ({
    account: schedule.account,
    reused: schedule.reused,
    totalJobs: schedule.totalJobs,
    scheduleId: schedule.scheduleId,
    jobs: schedule.jobs,
  })),
});

const submitQueues = async (queuesByDomain) => {
  const submissions = {};
  if (queuesByDomain.pet.length > 0) {
    submissions.pet = summarizeSubmission(await callAutoSchedule('pet', {
      queues: queuesByDomain.pet.map(({ debug, ...queue }) => queue),
      schedule_date: SCHEDULE_DATE,
      schedule_mode: '3',
      service: 'pet-sheet-makeup-20260622',
      ref: `pet-sheet-${GIDS.pet}-${SCHEDULE_DATE}-makeup-all-missing`,
      generate_images: true,
      image_count: 5,
      image_source: 'product',
      manuscript_type: 'pet',
      delay_between_posts: 10,
      keyword_category: '애견',
    }));
  }

  if (queuesByDomain.eye.length > 0) {
    submissions.eye = summarizeSubmission(await callAutoSchedule('eye', {
      queues: queuesByDomain.eye.map(({ debug, ...queue }) => queue),
      schedule_date: SCHEDULE_DATE,
      schedule_mode: '3',
      service: 'ophthalmology-sheet-makeup-20260622',
      ref: `eye-sheet-${GIDS.eye}-${SCHEDULE_DATE}-makeup-ghhoy`,
      generate_images: true,
      image_count: 5,
      image_source: 'product',
      manuscript_type: 'default',
      delay_between_posts: 10,
      keyword_category: '안과',
    }));
  }

  if (queuesByDomain.goat.length > 0) {
    submissions.goat = summarizeSubmission(await callAutoSchedule('goat', {
      queues: queuesByDomain.goat.map(({ debug, ...queue }) => queue),
      schedule_date: SCHEDULE_DATE,
      schedule_mode: '3',
      service: 'goat-sheet-makeup-20260622',
      ref: `goat-sheet-${GIDS.goat}-${SCHEDULE_DATE}-makeup-one-each`,
      generate_images: true,
      image_count: 5,
      image_source: 'product',
      manuscript_type: 'hanryeodamwon',
      delay_between_posts: 10,
      keyword_category: '한려담원',
    }));
  }

  return submissions;
};

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI missing');

  const redis = buildRedis();
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const [petCandidates, eyeCandidates, goatCandidates, goodCounts, existingKeywords, accountRows] = await Promise.all([
      fetchSheetCandidates(GIDS.pet),
      fetchSheetCandidates(GIDS.eye),
      fetchSheetCandidates(GIDS.goat),
      loadGoodCounts(),
      loadExistingKeywords(),
      loadAccountRows(),
    ]);

    const { queuesByDomain, blocked } = await buildQueues({
      redis,
      candidatesByDomain: { pet: petCandidates, eye: eyeCandidates, goat: goatCandidates },
      accountRows,
      goodCounts,
      existingKeywords,
    });

    const submissions = execute ? await submitQueues(queuesByDomain) : {};
    const plan = {
      generatedAt: new Date().toISOString(),
      execute,
      scheduleDate: SCHEDULE_DATE,
      slots: PAST_SLOTS,
      queues: Object.fromEntries(Object.entries(queuesByDomain).map(([domain, queues]) => [domain, sanitizeQueues(queues)])),
      blocked: [...blockedStatic, ...blocked],
      submissions,
    };

    await fs.mkdir(path.resolve(process.cwd(), 'outputs'), { recursive: true });
    const outPath = path.resolve(process.cwd(), 'outputs', `makeup-autopublish-${SCHEDULE_DATE}.json`);
    await fs.writeFile(outPath, JSON.stringify(plan, null, 2), 'utf8');

    console.log(JSON.stringify({
      outPath,
      execute,
      counts: Object.fromEntries(Object.entries(plan.queues).map(([domain, queues]) => [
        domain,
        {
          accounts: queues.length,
          jobs: queues.reduce((sum, queue) => sum + queue.items.length, 0),
        },
      ])),
      blocked: plan.blocked.map(({ accountId, blogName, domain, reason, currentGoodCount, needed, selected }) => ({
        accountId,
        blogName,
        domain,
        reason,
        currentGoodCount,
        needed,
        selected,
      })),
      submissions: Object.fromEntries(Object.entries(submissions).map(([domain, submission]) => [
        domain,
        { totalJobs: submission.totalJobs, scheduleCount: submission.schedules.length },
      ])),
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
