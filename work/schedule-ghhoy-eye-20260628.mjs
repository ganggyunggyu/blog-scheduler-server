import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';

const EXECUTE = process.argv.includes('--execute');
const SCHEDULE_DATE = '2026-06-28';
const ACCOUNT_ID = 'ghhoy';
const BLOG_ID = 'ghhoy';
const BLOG_NAME = '탐험기-교체';
const SCHEDULER_API_URL = process.env.SCHEDULER_API_URL ?? 'http://localhost:8001';
const SHEET_ID = '1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c';
const EYE_SHEET_GID = '633450920';
const USED_KEYWORD_LOG_PATH = path.resolve('memory/project_used_keywords.md');
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

const normalizeKeyword = (keyword) => keyword.replace(/\s+/g, '').toLowerCase();

const getEyeRoot = (keyword) => {
  const normalized = normalizeKeyword(keyword);
  return EYE_ROOTS.find((root) => normalized.includes(root)) ?? normalized;
};

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

const formatKst = (date) => `${kstFormatter.format(date).replace(' ', 'T')}+09:00`;

const atKst = (time) => formatKst(new Date(`${SCHEDULE_DATE}T${time}:00+09:00`));

const buildRedis = () => new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

const loadRuntimePassword = async (redis) => {
  for (const queueName of [`generate_${ACCOUNT_ID}`, `publish_${ACCOUNT_ID}`]) {
    const queue = new Queue(queueName, { connection: redis });
    try {
      const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'completed', 'failed'], 0, 300, false);
      const job = jobs.find((item) => item.data?.account?.id === ACCOUNT_ID && item.data?.account?.password);
      if (job?.data?.account?.password) {
        return { password: job.data.account.password, source: queueName };
      }
    } finally {
      await queue.close().catch(() => undefined);
    }
  }
  return { password: '', source: '' };
};

const fetchEyeKeywords = async () => {
  const response = await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${EYE_SHEET_GID}`,
    { headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' } },
  );
  if (!response.ok) {
    throw new Error(`eye sheet fetch failed: ${response.status}`);
  }
  const rows = parseCsv(await response.text());
  const keywords = [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    if (index === 0) continue;
    const keyword = row[0]?.trim() ?? '';
    const exposed = row[3]?.trim() ?? '';
    const newLogic = row[6]?.trim().toLowerCase() ?? '';
    if (!keyword || keyword.startsWith('키워드 ')) continue;
    if (seen.has(keyword)) continue;
    if (!exposed && newLogic === 'o') {
      seen.add(keyword);
      keywords.push(keyword);
    }
  }
  return keywords;
};

const loadTodayKeywords = async () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');
  const schedules = await db.collection('schedules')
    .find({ scheduleDate: SCHEDULE_DATE, status: { $ne: 'cancelled' } }, { projection: { _id: 1 } })
    .toArray();
  const jobs = await db.collection('schedulejobs')
    .find(
      { scheduleId: { $in: schedules.map((schedule) => schedule._id) }, scheduledAt: { $regex: `^${SCHEDULE_DATE}` }, status: { $ne: 'cancelled' } },
      { projection: { _id: 0, keyword: 1 } },
    )
    .toArray();
  return new Set(jobs.map((job) => job.keyword).filter(Boolean));
};

const countToday = async () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');
  const schedules = await db.collection('schedules')
    .find({ accountId: ACCOUNT_ID, scheduleDate: SCHEDULE_DATE, status: { $ne: 'cancelled' } }, { projection: { _id: 1 } })
    .toArray();
  if (schedules.length === 0) return 0;
  return db.collection('schedulejobs')
    .countDocuments({
      scheduleId: { $in: schedules.map((schedule) => schedule._id) },
      scheduledAt: { $regex: `^${SCHEDULE_DATE}` },
      status: { $in: ['pending', 'generating', 'generated', 'publishing', 'published'] },
    });
};

const selectKeywords = async () => {
  const [sheetKeywords, todayKeywords] = await Promise.all([fetchEyeKeywords(), loadTodayKeywords()]);
  const shuffled = shuffle(
    sheetKeywords.filter((keyword) => !todayKeywords.has(keyword)),
    `ghhoy:${SCHEDULE_DATE}`,
  );
  const selected = [];
  const roots = new Set();
  for (const keyword of shuffled) {
    const root = getEyeRoot(keyword);
    if (roots.has(root)) continue;
    selected.push(keyword);
    roots.add(root);
    if (selected.length === 3) return selected;
  }
  for (const keyword of shuffled) {
    if (selected.includes(keyword)) continue;
    selected.push(keyword);
    if (selected.length === 3) return selected;
  }
  throw new Error(`ghhoy eye keywords insufficient: ${selected.length}`);
};

const recordUsedKeywords = async (keywords) => {
  await fs.mkdir(path.dirname(USED_KEYWORD_LOG_PATH), { recursive: true });
  try {
    await fs.access(USED_KEYWORD_LOG_PATH);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await fs.writeFile(USED_KEYWORD_LOG_PATH, 'date | accountId | keyword\n', 'utf8');
  }
  await fs.appendFile(
    USED_KEYWORD_LOG_PATH,
    `${keywords.map((keyword) => `${SCHEDULE_DATE} | ${ACCOUNT_ID} | ${keyword}`).join('\n')}\n`,
    'utf8',
  );
};

const callAutoSchedule = async (password, keywords) => {
  const body = {
    queues: [{
      account: { id: ACCOUNT_ID, password, blogId: BLOG_ID },
      blog_name: BLOG_NAME,
      keywords,
      items: [
        { keyword: keywords[0], scheduledAt: atKst('10:00'), slot: 1 },
        { keyword: keywords[1], scheduledAt: atKst('14:00'), slot: 2 },
        { keyword: keywords[2], scheduledAt: atKst('18:00'), slot: 3 },
      ],
    }],
    schedule_date: SCHEDULE_DATE,
    schedule_mode: '3',
    service: 'ophthalmology-sheet',
    ref: `eye-sheet-${EYE_SHEET_GID}-${SCHEDULE_DATE}-ghhoy-redis-password`,
    generate_images: true,
    image_count: 5,
    image_source: 'product',
    manuscript_type: 'default',
    delay_between_posts: 10,
    keyword_category: '안과',
  };

  console.log(`mode=${EXECUTE ? 'execute' : 'dry-run'}`);
  console.log(`schedule_date=${SCHEDULE_DATE}`);
  console.log(`account=${ACCOUNT_ID}`);
  for (const item of body.queues[0].items) {
    console.log(`  ${item.scheduledAt} | ${item.keyword}`);
  }
  if (!EXECUTE) return null;

  const response = await fetch(`${SCHEDULER_API_URL}/bot/auto-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success !== true) {
    throw new Error(`ghhoy auto-schedule failed: ${response.status} ${JSON.stringify(json)}`);
  }
  console.log(JSON.stringify({
    totalJobs: json.totalJobs,
    schedules: (json.schedules ?? []).map((schedule) => ({
      account: schedule.account,
      reused: schedule.reused,
      totalJobs: schedule.totalJobs,
      scheduleId: schedule.scheduleId,
    })),
  }, null, 2));
  await recordUsedKeywords(keywords);
  return json;
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }
  await mongoose.connect(process.env.MONGO_URI);
  const redis = buildRedis();
  try {
    const currentCount = await countToday();
    if (currentCount >= 3) {
      console.log(`ghhoy already has ${currentCount}/3 jobs`);
      return;
    }
    const credential = await loadRuntimePassword(redis);
    if (!credential.password) {
      throw new Error('ghhoy runtime password not found in Redis queues');
    }
    console.log(`password_source=${credential.source}`);
    const keywords = await selectKeywords();
    await callAutoSchedule(credential.password, keywords);
  } finally {
    await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
