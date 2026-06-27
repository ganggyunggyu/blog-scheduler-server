import 'dotenv/config';
import mongoose from 'mongoose';

const EXECUTE = process.argv.includes('--execute');
const SCHEDULE_DATE = '2026-06-28';
const SCHEDULER_API_URL = process.env.SCHEDULER_API_URL ?? 'http://localhost:8001';
const SHEET_ID = '1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c';
const DESIGNATED_GIDS = {
  '윤슬': '1449378227',
  '추상의구체화': '1729073770',
};

const ALIBABA_ORDER = ['crvfwy7062', 'mad1651', 'heavymouse448', 'weed3122', 'individual14144'];
const DESIGNATED_ORDER = ['tinyfish183', 'orangeswan630', 'bigfish773'];

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

const atKst = (date, time, addMinutes = 0) => {
  const base = new Date(`${date}T${time}:00+09:00`);
  return formatKst(new Date(base.getTime() + addMinutes * 60_000));
};

const normalizeDisplayName = (nickname, accountId) => (nickname || accountId).replace(/\s+/g, '');

const sortByOrder = (accounts, order) => {
  const orderMap = new Map(order.map((accountId, index) => [accountId, index]));
  return [...accounts].sort((left, right) => {
    const leftIndex = orderMap.get(left.accountId) ?? 999;
    const rightIndex = orderMap.get(right.accountId) ?? 999;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.displayName.localeCompare(right.displayName, 'ko');
  });
};

const loadAccounts = async (category, order) => {
  const db = mongoose.connection.db;
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  if (!db) throw new Error('MongoDB connection is not ready');

  const accountRows = await db.collection('blogaccounts')
    .find(
      {
        category,
        $or: [{ isEnabled: true }, { isEnabled: { $exists: false } }],
        status: { $ne: 'disabled' },
      },
      { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, category: 1 } },
    )
    .toArray();

  const ids = accountRows.map((account) => account.accountId).filter(Boolean);
  const credentialRows = await cafeDb.collection('accounts')
    .find(
      { accountId: { $in: ids }, isActive: { $ne: false } },
      { projection: { _id: 0, accountId: 1, password: 1, blogId: 1, nickname: 1 } },
    )
    .toArray();
  const credentials = new Map(credentialRows.map((account) => [account.accountId, account]));
  const missing = ids.filter((accountId) => !credentials.get(accountId)?.password);
  const accounts = accountRows
    .filter((account) => credentials.get(account.accountId)?.password)
    .map((account) => {
      const credential = credentials.get(account.accountId);
      return {
        accountId: account.accountId,
        password: credential.password,
        blogId: account.blogId || credential.blogId || account.accountId,
        displayName: normalizeDisplayName(account.nickname || credential.nickname, account.accountId),
        category: account.category,
      };
    });

  return { accounts: sortByOrder(accounts, order), missing };
};

const countTodayExecutableJobs = async (accountIds) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');

  const schedules = await db.collection('schedules')
    .find(
      { accountId: { $in: accountIds }, scheduleDate: SCHEDULE_DATE, status: { $ne: 'cancelled' } },
      { projection: { _id: 1, accountId: 1 } },
    )
    .toArray();
  const scheduleToAccount = new Map(schedules.map((schedule) => [String(schedule._id), schedule.accountId]));
  const counts = new Map(accountIds.map((accountId) => [accountId, 0]));
  if (schedules.length === 0) return counts;

  const jobs = await db.collection('schedulejobs')
    .find(
      {
        scheduleId: { $in: schedules.map((schedule) => schedule._id) },
        scheduledAt: { $regex: `^${SCHEDULE_DATE}` },
        status: { $in: ['pending', 'generating', 'generated', 'publishing', 'published'] },
      },
      { projection: { scheduleId: 1 } },
    )
    .toArray();

  for (const job of jobs) {
    const accountId = scheduleToAccount.get(String(job.scheduleId));
    if (!accountId) continue;
    counts.set(accountId, (counts.get(accountId) ?? 0) + 1);
  }

  return counts;
};

const fetchSheetKeywords = async (gid) => {
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

  const rows = parseCsv(await response.text());
  const keywords = [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    if (index === 0) continue;
    const keyword = row[0]?.trim() ?? '';
    const exposed = row[3]?.trim() ?? '';
    const newLogic = row[6]?.trim().toLowerCase() ?? '';
    if (!keyword || keyword.startsWith('키워드 ')) continue;
    if (exposed) continue;
    if (newLogic !== 'o') continue;
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
  }

  return keywords;
};

const loadExistingKeywords = async (accountIds) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');

  const schedules = await db.collection('schedules')
    .find(
      { accountId: { $in: accountIds }, status: { $ne: 'cancelled' } },
      { projection: { _id: 1 } },
    )
    .toArray();
  if (schedules.length === 0) return new Set();

  const jobs = await db.collection('schedulejobs')
    .find(
      { scheduleId: { $in: schedules.map((schedule) => schedule._id) }, status: { $ne: 'cancelled' } },
      { projection: { _id: 0, keyword: 1 } },
    )
    .toArray();

  return new Set(jobs.map((job) => job.keyword).filter(Boolean));
};

const loadAlibabaNextKeywords = async () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');

  const plans = await db.collection('blogkeywordplans')
    .find(
      { domain: 'alibaba', groupLabel: '1/3/5' },
      { projection: { _id: 0, scheduleDate: 1, keywords: 1 } },
    )
    .sort({ scheduleDate: 1 })
    .toArray();
  if (plans.length === 0) {
    throw new Error('alibaba keyword plans are empty');
  }

  const schedules = await db.collection('schedules')
    .find(
      { accountId: { $in: ALIBABA_ORDER }, service: 'alibaba', status: { $ne: 'cancelled' } },
      { projection: { _id: 1, scheduleDate: 1, createdAt: 1 } },
    )
    .sort({ scheduleDate: -1, createdAt: -1 })
    .limit(10)
    .toArray();
  const jobs = schedules.length > 0
    ? await db.collection('schedulejobs')
      .find(
        { scheduleId: { $in: schedules.map((schedule) => schedule._id) }, status: { $ne: 'cancelled' } },
        { projection: { _id: 0, scheduleId: 1, keyword: 1, slot: 1 } },
      )
      .sort({ slot: 1 })
      .toArray()
    : [];

  const firstSchedule = schedules[0];
  const latestKeywords = firstSchedule
    ? jobs
      .filter((job) => String(job.scheduleId) === String(firstSchedule._id))
      .map((job) => job.keyword)
    : [];
  const latestKey = latestKeywords.join('|');
  const latestPlanIndex = plans.findIndex((plan) => plan.keywords.join('|') === latestKey);
  const nextPlan = plans[(latestPlanIndex >= 0 ? latestPlanIndex + 1 : 0) % plans.length];

  if (nextPlan.keywords.length < 3) {
    throw new Error(`alibaba next plan has insufficient keywords: ${nextPlan.scheduleDate}`);
  }

  return {
    sourceDate: nextPlan.scheduleDate,
    keywords: nextPlan.keywords.slice(0, 3),
  };
};

const assignRoundRobin = (accounts, selectedKeywords, perAccount) => {
  const byAccount = new Map(accounts.map((account) => [account.accountId, []]));
  for (let round = 0; round < perAccount; round += 1) {
    for (let accountIndex = 0; accountIndex < accounts.length; accountIndex += 1) {
      byAccount.get(accounts[accountIndex].accountId).push(selectedKeywords[round * accounts.length + accountIndex]);
    }
  }
  return byAccount;
};

const chooseSheetCandidates = (sheetKeywords, usedKeywords, needed, seedValue) => {
  const unused = shuffle(
    sheetKeywords.filter((keyword) => !usedKeywords.has(keyword)),
    `${seedValue}:unused`,
  );
  if (unused.length >= needed) {
    return { candidates: unused, resetApplied: false };
  }

  const reset = shuffle(sheetKeywords, `${seedValue}:reset`);
  if (reset.length < needed) {
    throw new Error(`키워드 부족: ${reset.length} < ${needed}`);
  }
  return { candidates: reset, resetApplied: true };
};

const buildQueues = (accounts, keywordsByAccount, slotTimes, staggerMinutes) =>
  accounts.map((account, accountIndex) => {
    const keywords = keywordsByAccount.get(account.accountId) ?? [];
    return {
      account: {
        id: account.accountId,
        password: account.password,
        blogId: account.blogId,
      },
      blog_name: account.displayName,
      keywords,
      items: keywords.map((keyword, keywordIndex) => ({
        keyword,
        scheduledAt: atKst(SCHEDULE_DATE, slotTimes[keywordIndex], accountIndex * staggerMinutes),
        slot: keywordIndex + 1,
      })),
    };
  });

const printQueues = (title, queues) => {
  console.log(`\n=== ${title} ===`);
  let count = 0;
  for (const queue of queues) {
    console.log(`[${queue.blog_name}] ${queue.account.id}`);
    for (const item of queue.items) {
      count += 1;
      console.log(`  ${item.scheduledAt} | ${item.keyword}`);
    }
  }
  console.log(`count=${count}`);
};

const callAutoSchedule = async (title, body) => {
  if (!EXECUTE || body.queues.length === 0) return null;

  const response = await fetch(`${SCHEDULER_API_URL}/bot/auto-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success !== true) {
    throw new Error(`${title} auto-schedule failed: ${response.status} ${JSON.stringify(json)}`);
  }

  console.log(`\n${title} submitted: totalJobs=${json.totalJobs ?? 0}`);
  for (const schedule of json.schedules ?? []) {
    console.log(`  ${schedule.account} reused=${schedule.reused} jobs=${schedule.totalJobs} scheduleId=${schedule.scheduleId}`);
  }

  return json;
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const [alibabaLoaded, yoonLoaded, chusangLoaded] = await Promise.all([
      loadAccounts('알리바바', ALIBABA_ORDER),
      loadAccounts('윤슬', DESIGNATED_ORDER),
      loadAccounts('추상의구체화', DESIGNATED_ORDER),
    ]);

    const alibabaCounts = await countTodayExecutableJobs(alibabaLoaded.accounts.map((account) => account.accountId));
    const yoonCounts = await countTodayExecutableJobs(yoonLoaded.accounts.map((account) => account.accountId));
    const chusangCounts = await countTodayExecutableJobs(chusangLoaded.accounts.map((account) => account.accountId));

    const alibabaAccounts = alibabaLoaded.accounts.filter((account) => (alibabaCounts.get(account.accountId) ?? 0) < 3);
    const yoonAccounts = yoonLoaded.accounts.filter((account) => (yoonCounts.get(account.accountId) ?? 0) < 2);
    const chusangAccounts = chusangLoaded.accounts.filter((account) => (chusangCounts.get(account.accountId) ?? 0) < 2);

    const alibabaPlan = await loadAlibabaNextKeywords();
    const alibabaKeywordsByAccount = new Map(alibabaAccounts.map((account) => [account.accountId, alibabaPlan.keywords]));
    const alibabaQueues = buildQueues(alibabaAccounts, alibabaKeywordsByAccount, ['08:05', '09:05', '10:05'], 0);

    const [yoonSheet, chusangSheet, yoonUsed, chusangUsed] = await Promise.all([
      fetchSheetKeywords(DESIGNATED_GIDS['윤슬']),
      fetchSheetKeywords(DESIGNATED_GIDS['추상의구체화']),
      loadExistingKeywords(yoonLoaded.accounts.map((account) => account.accountId)),
      loadExistingKeywords(chusangLoaded.accounts.map((account) => account.accountId)),
    ]);
    const yoonSelection = chooseSheetCandidates(
      yoonSheet,
      yoonUsed,
      yoonAccounts.length * 2,
      `yoon:${SCHEDULE_DATE}`,
    );
    const chusangSelection = chooseSheetCandidates(
      chusangSheet,
      chusangUsed,
      chusangAccounts.length * 2,
      `chusang:${SCHEDULE_DATE}`,
    );

    const yoonQueues = buildQueues(
      yoonAccounts,
      assignRoundRobin(yoonAccounts, yoonSelection.candidates.slice(0, yoonAccounts.length * 2), 2),
      ['10:20', '15:20'],
      10,
    );
    const chusangQueues = buildQueues(
      chusangAccounts,
      assignRoundRobin(chusangAccounts, chusangSelection.candidates.slice(0, chusangAccounts.length * 2), 2),
      ['10:40', '15:40'],
      10,
    );

    console.log(`mode=${EXECUTE ? 'execute' : 'dry-run'}`);
    console.log(`schedule_date=${SCHEDULE_DATE}`);
    console.log(`alibaba_source_plan_date=${alibabaPlan.sourceDate}`);
    console.log(`sheet_reset_applied_yoon=${yoonSelection.resetApplied}`);
    console.log(`sheet_reset_applied_chusang=${chusangSelection.resetApplied}`);
    console.log(`missing_credentials=${[
      ...alibabaLoaded.missing.map((accountId) => `알리바바:${accountId}`),
      ...yoonLoaded.missing.map((accountId) => `윤슬:${accountId}`),
      ...chusangLoaded.missing.map((accountId) => `추상의구체화:${accountId}`),
    ].join(',') || 'none'}`);
    printQueues('알리바바 보강', alibabaQueues);
    printQueues('윤슬 보강', yoonQueues);
    printQueues('추상의구체화 보강', chusangQueues);

    await callAutoSchedule('알리바바', {
      queues: alibabaQueues,
      schedule_date: SCHEDULE_DATE,
      schedule_mode: '3',
      service: 'alibaba',
      ref: `core-daily-alibaba-cycle-${SCHEDULE_DATE}`,
      generate_images: true,
      image_count: 5,
      image_source: 'product',
      manuscript_type: 'alibaba',
      delay_between_posts: 10,
      keyword_category: '기타',
    });
    await callAutoSchedule('윤슬', {
      queues: yoonQueues,
      schedule_date: SCHEDULE_DATE,
      schedule_mode: '2',
      service: 'designated-daily',
      ref: `designated-yoonseul-${SCHEDULE_DATE}`,
      generate_images: true,
      image_count: 5,
      image_source: 'ai',
      manuscript_type: 'default',
      delay_between_posts: 10,
      keyword_category: '윤슬',
    });
    await callAutoSchedule('추상의구체화', {
      queues: chusangQueues,
      schedule_date: SCHEDULE_DATE,
      schedule_mode: '2',
      service: 'designated-daily',
      ref: `designated-chusang-${SCHEDULE_DATE}`,
      generate_images: true,
      image_count: 5,
      image_source: 'ai',
      manuscript_type: 'default',
      delay_between_posts: 10,
      keyword_category: '추상의구체화',
    });
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
