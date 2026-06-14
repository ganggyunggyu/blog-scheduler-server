import 'dotenv/config';
import mongoose from 'mongoose';

const EXECUTE = process.argv.includes('--execute');
const SCHEDULER_API_URL = process.env.SCHEDULER_API_URL ?? 'http://localhost:8001';
const SHEET_ID = '1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c';
const SHEET_GIDS = {
  goat: '1025121967',
  yoonseul: '1449378227',
  chusang: '1729073770',
};

const GOAT_ORDER = [
  'regular14631',
  'pixelninja3',
  'ahffkekd12',
  'dhtksk1p',
  'eghfsa5478',
  'q9v3m7a2',
  'laghunter8',
];
const DESIGNATED_ORDER = ['tinyfish183', 'orangeswan630', 'bigfish773'];
const ALIBABA_ORDER = ['crvfwy7062', 'mad1651', 'heavymouse448', 'weed3122', 'individual14144'];
const ALIBABA_GROUP_135 = new Set(['crvfwy7062', 'heavymouse448']);
const ALIBABA_KEYWORDS_135 = ['해외직구관세기준', '해외직구관세', '국제배송조회'];
const ALIBABA_KEYWORDS_246 = ['타오바오', '1688', '타오바오 직구방법'];

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
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1;
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.map((row) => row.map((cell) => cell.trim()));
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

const isColdGroup = (keyword) => /수족냉증|손발|손끝/.test(normalizeKeyword(keyword));

const selectDiverseGoatKeywords = (keywords, needed) => {
  const pool = shuffle(keywords, 'goat-makeup-20260613-20260614')
    .sort((left, right) => Number(isColdGroup(left)) - Number(isColdGroup(right)));
  const selected = [];
  const usedRoots = new Set();

  for (const keyword of pool) {
    const root = getRoot(keyword);
    if (usedRoots.has(root)) continue;
    selected.push(keyword);
    usedRoots.add(root);
    if (selected.length === needed) return selected;
  }

  for (const keyword of pool) {
    if (selected.includes(keyword)) continue;
    selected.push(keyword);
    if (selected.length === needed) return selected;
  }

  throw new Error(`흑염소 키워드 부족: ${selected.length} < ${needed}`);
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
    throw new Error(`시트 조회 실패 gid=${gid}: ${response.status}`);
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

const normalizeDisplayName = (nickname, accountId) => {
  const compact = (nickname || accountId).replace(/\s+/g, '');
  if (compact === '미식가2') return '미식가2';
  if (compact === '비밀의정원') return '비밀의정원';
  if (compact.startsWith('빨간모자앤')) return '빨간모자앤';
  return compact;
};

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
      { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, category: 1, isEnabled: 1 } },
    )
    .toArray();

  const ids = accountRows.map((account) => account.accountId).filter(Boolean);
  const credentialRows = await cafeDb.collection('accounts')
    .find(
      {
        accountId: { $in: ids },
        isActive: { $ne: false },
      },
      { projection: { _id: 0, accountId: 1, password: 1, blogId: 1, nickname: 1 } },
    )
    .toArray();
  const credentials = new Map(credentialRows.map((account) => [account.accountId, account]));

  const missing = ids.filter((accountId) => !credentials.get(accountId)?.password);
  if (missing.length > 0) {
    throw new Error(`${category} 계정 비밀번호 없음: ${missing.join(', ')}`);
  }

  const resolved = accountRows.map((account) => {
    const credential = credentials.get(account.accountId);
    return {
      accountId: account.accountId,
      password: credential.password,
      blogId: account.blogId || credential.blogId || account.accountId,
      displayName: normalizeDisplayName(account.nickname || credential.nickname, account.accountId),
      category: account.category,
    };
  });

  return sortByOrder(resolved, order);
};

const loadExistingKeywords = async (accountIds) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');

  const schedules = await db.collection('schedules')
    .find(
      {
        accountId: { $in: accountIds },
        status: { $ne: 'cancelled' },
      },
      { projection: { _id: 1, accountId: 1 } },
    )
    .toArray();

  if (schedules.length === 0) return new Set();

  const jobs = await db.collection('schedulejobs')
    .find(
      {
        scheduleId: { $in: schedules.map((schedule) => schedule._id) },
        status: { $ne: 'cancelled' },
      },
      { projection: { keyword: 1 } },
    )
    .toArray();

  return new Set(jobs.map((job) => job.keyword).filter(Boolean));
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

const buildTwoSlotQueues = (accounts, keywordsByAccount, firstSlot, secondSlot, staggerMinutes) =>
  accounts.map((account, accountIndex) => {
    const keywords = keywordsByAccount.get(account.accountId) ?? [];
    if (keywords.length !== 2) {
      throw new Error(`${account.accountId} 키워드 2개가 필요함: ${keywords.length}`);
    }

    return {
      account: {
        id: account.accountId,
        password: account.password,
        blogId: account.blogId,
      },
      blog_name: account.displayName,
      keywords,
      items: [
        {
          keyword: keywords[0],
          scheduledAt: atKst(firstSlot.date, firstSlot.time, accountIndex * staggerMinutes),
          slot: 1,
        },
        {
          keyword: keywords[1],
          scheduledAt: atKst(secondSlot.date, secondSlot.time, accountIndex * staggerMinutes),
          slot: 2,
        },
      ],
    };
  });

const buildAlibabaQueues = (accounts) =>
  accounts.map((account, accountIndex) => {
    const keywords = ALIBABA_GROUP_135.has(account.accountId)
      ? ALIBABA_KEYWORDS_135
      : ALIBABA_KEYWORDS_246;
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
        scheduledAt: atKst('2026-06-15', ['11:00', '14:00', '17:00'][keywordIndex], accountIndex * 5),
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
  if (!EXECUTE) return null;

  const response = await fetch(`${SCHEDULER_API_URL}/bot/auto-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok || json.success !== true) {
    throw new Error(`${title} auto-schedule 실패: ${response.status} ${JSON.stringify(json)}`);
  }

  console.log(`\n${title} submitted: totalJobs=${json.totalJobs}`);
  for (const schedule of json.schedules ?? []) {
    console.log(`  ${schedule.account} reused=${schedule.reused} jobs=${schedule.totalJobs}`);
  }

  return json;
};

const assignRoundRobin = (accounts, selectedKeywords, perAccount) => {
  const byAccount = new Map(accounts.map((account) => [account.accountId, []]));

  for (let round = 0; round < perAccount; round += 1) {
    for (let accountIndex = 0; accountIndex < accounts.length; accountIndex += 1) {
      const keyword = selectedKeywords[round * accounts.length + accountIndex];
      byAccount.get(accounts[accountIndex].accountId).push(keyword);
    }
  }

  return byAccount;
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const [goatAccounts, yoonAccounts, chusangAccounts, alibabaAccounts] = await Promise.all([
      loadAccounts('흑염소', GOAT_ORDER),
      loadAccounts('윤슬', DESIGNATED_ORDER),
      loadAccounts('추상의구체화', DESIGNATED_ORDER),
      loadAccounts('알리바바', ALIBABA_ORDER),
    ]);

    const [goatSheet, yoonSheet, chusangSheet] = await Promise.all([
      fetchSheetKeywords(SHEET_GIDS.goat),
      fetchSheetKeywords(SHEET_GIDS.yoonseul),
      fetchSheetKeywords(SHEET_GIDS.chusang),
    ]);

    const goatAvailable = goatSheet;
    const yoonAvailable = yoonSheet;
    const chusangAvailable = chusangSheet;

    const goatSelected = selectDiverseGoatKeywords(goatAvailable, goatAccounts.length * 2);
    const yoonSelected = yoonAvailable.slice(0, yoonAccounts.length * 2);
    const chusangSelected = chusangAvailable.slice(0, chusangAccounts.length * 2);

    if (yoonSelected.length < yoonAccounts.length * 2) {
      throw new Error(`윤슬 키워드 부족: ${yoonSelected.length}`);
    }
    if (chusangSelected.length < chusangAccounts.length * 2) {
      throw new Error(`추상의구체화 키워드 부족: ${chusangSelected.length}`);
    }

    const goatQueues = buildTwoSlotQueues(
      goatAccounts,
      assignRoundRobin(goatAccounts, goatSelected, 2),
      { date: '2026-06-14', time: '21:20' },
      { date: '2026-06-15', time: '09:20' },
      5,
    );
    const yoonQueues = buildTwoSlotQueues(
      yoonAccounts,
      assignRoundRobin(yoonAccounts, yoonSelected, 2),
      { date: '2026-06-14', time: '22:10' },
      { date: '2026-06-15', time: '10:10' },
      10,
    );
    const chusangQueues = buildTwoSlotQueues(
      chusangAccounts,
      assignRoundRobin(chusangAccounts, chusangSelected, 2),
      { date: '2026-06-14', time: '22:20' },
      { date: '2026-06-15', time: '10:20' },
      10,
    );
    const alibabaQueues = buildAlibabaQueues(alibabaAccounts);

    console.log(`mode=${EXECUTE ? 'execute' : 'dry-run'}`);
    console.log(`accounts goat=${goatAccounts.length}, yoon=${yoonAccounts.length}, chusang=${chusangAccounts.length}, alibaba=${alibabaAccounts.length}`);
    console.log(`sheet available goat=${goatAvailable.length}/${goatSheet.length}, yoon=${yoonAvailable.length}/${yoonSheet.length}, chusang=${chusangAvailable.length}/${chusangSheet.length}`);

    printQueues('흑염소 토요일 보강', goatQueues);
    printQueues('윤슬 토요일 보강', yoonQueues);
    printQueues('추상의구체화 토요일 보강', chusangQueues);
    printQueues('알리바바 처음부터 재시작', alibabaQueues);

    await callAutoSchedule('흑염소', {
      queues: goatQueues,
      schedule_date: '2026-06-14',
      schedule_mode: '2',
      service: 'goat-saturday-makeup-20260613',
      ref: 'goat-makeup-20260613-wide-gap-20260614',
      generate_images: true,
      image_count: 5,
      image_source: 'product',
      manuscript_type: 'hanryeodamwon',
      delay_between_posts: 180,
      keyword_category: '한려담원',
    });

    await callAutoSchedule('윤슬', {
      queues: yoonQueues,
      schedule_date: '2026-06-14',
      schedule_mode: '2',
      service: 'designated-saturday-makeup-20260613',
      ref: 'yoonseul-makeup-20260613-wide-gap-20260614',
      generate_images: true,
      image_count: 5,
      image_source: 'ai',
      manuscript_type: 'default',
      delay_between_posts: 180,
      keyword_category: '윤슬',
    });

    await callAutoSchedule('추상의구체화', {
      queues: chusangQueues,
      schedule_date: '2026-06-14',
      schedule_mode: '2',
      service: 'designated-saturday-makeup-20260613',
      ref: 'chusang-makeup-20260613-wide-gap-20260614',
      generate_images: true,
      image_count: 5,
      image_source: 'ai',
      manuscript_type: 'default',
      delay_between_posts: 180,
      keyword_category: '추상의구체화',
    });

    await callAutoSchedule('알리바바', {
      queues: alibabaQueues,
      schedule_date: '2026-06-15',
      schedule_mode: '3',
      service: 'alibaba-restart-from-beginning-20260614',
      ref: 'alibaba-restart-plan-start-20260518-wide-gap-20260615',
      generate_images: true,
      image_count: 5,
      image_source: 'product',
      manuscript_type: 'alibaba',
      delay_between_posts: 180,
      keyword_category: '기타',
    });
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
