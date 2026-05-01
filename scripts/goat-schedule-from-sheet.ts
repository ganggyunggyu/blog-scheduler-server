import 'dotenv/config';
import mongoose from 'mongoose';
import { calculateSchedule, formatKst } from '../src/services/schedule.service.js';

const SHEET_GID = '1025121967';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const DEFAULT_DATE = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
}).format(new Date());
const DEFAULT_MODE = '2';
const DAYS = 3;
const POSTS_PER_DAY = 2;
const ACCOUNT_ORDER = ['힘차게', '미식가2', '뽀또', '달리자', '듣는방법', '비밀의정원', '빨간모자앤', '소원'];
const SCHEDULER_API_URL = process.env.SCHEDULER_API_URL ?? 'http://localhost:8001';

interface AccountRecord {
  accountId: string;
  password: string;
  nickname?: string;
  blogId?: string;
  category?: string;
}

interface ResolvedAccount {
  id: string;
  password: string;
  blogId: string;
  displayName: string;
}

interface PreviewAccount extends ResolvedAccount {
  keywords: string[];
  items: ReturnType<typeof calculateSchedule>;
}

interface CliOptions {
  scheduleDate: string;
  scheduleMode: '1' | '2' | '3' | '2121';
  dryRun: boolean;
}

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  let scheduleDate = DEFAULT_DATE;
  let scheduleMode: CliOptions['scheduleMode'] = DEFAULT_MODE;
  let dryRun = false;

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

    if (token === '--dry-run') {
      dryRun = true;
    }
  }

  return {
    scheduleDate,
    scheduleMode,
    dryRun,
  };
};

const normalizeDisplayName = (nickname: string): string => {
  const compact = nickname.replace(/\s+/g, '');

  if (compact === '미식가2') {
    return '미식가2';
  }

  if (compact === '비밀의정원') {
    return '비밀의정원';
  }

  if (compact.startsWith('빨간모자앤')) {
    return '빨간모자앤';
  }

  return compact;
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
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }
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

const shuffleKeywords = (keywords: string[], seedValue: string): string[] => {
  const random = createSeededRandom(seedValue);
  const copied = [...keywords];

  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }

  return copied;
};

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
] as const;

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
] as const;

const normalizeKeywordForRoot = (keyword: string): string =>
  keyword.replace(/\s+/g, '').toLowerCase();

const getMainKeywordRoot = (keyword: string): string => {
  const normalized = normalizeKeywordForRoot(keyword);
  const explicitRoot = MAIN_KEYWORD_ROOTS.find((root) => normalized.includes(root));

  if (explicitRoot) {
    return explicitRoot;
  }

  let root = normalized;
  for (const suffix of ROOT_SUFFIXES) {
    if (root.endsWith(suffix) && root.length > suffix.length) {
      root = root.slice(0, -suffix.length);
      break;
    }
  }

  return root || normalized;
};

const assignDiversifiedKeywords = (
  accounts: ResolvedAccount[],
  keywords: string[],
  neededPerAccount: number,
): Array<ResolvedAccount & { keywords: string[] }> => {
  const assigned = accounts.map((account) => ({
    ...account,
    keywords: [] as string[],
    rootSet: new Set<string>(),
  }));
  const remaining = [...keywords];

  for (let round = 0; round < neededPerAccount; round += 1) {
    for (const account of assigned) {
      const keywordIndex = remaining.findIndex((keyword) => {
        const root = getMainKeywordRoot(keyword);
        return !account.rootSet.has(root);
      });

      if (keywordIndex < 0) {
        throw new Error(`not enough diversified keywords for ${account.displayName}`);
      }

      const [keyword] = remaining.splice(keywordIndex, 1);
      account.keywords.push(keyword);
      account.rootSet.add(getMainKeywordRoot(keyword));
    }
  }

  return assigned.map(({ rootSet: _rootSet, ...account }) => account);
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

    if (!keyword || keyword.startsWith('키워드 ')) {
      continue;
    }

    if (exposed) {
      continue;
    }

    if (newLogic !== 'o') {
      continue;
    }

    if (seen.has(keyword)) {
      continue;
    }

    seen.add(keyword);
    keywords.push(keyword);
  }

  return keywords;
};

const loadGoatAccounts = async (): Promise<ResolvedAccount[]> => {
  const records = await mongoose.connection
    .useDb('cafe-bot')
    .collection<AccountRecord>('accounts')
    .find(
      {
        category: '흑염소',
        $or: [{ isActive: true }, { isActive: { $exists: false } }],
      },
      {
        projection: {
          accountId: 1,
          password: 1,
          nickname: 1,
          blogId: 1,
          _id: 0,
        },
      },
    )
    .toArray();

  const resolved = records
    .filter((record) => record.accountId && record.password)
    .map((record) => ({
      id: record.accountId,
      password: record.password,
      blogId: record.blogId || record.accountId,
      displayName: normalizeDisplayName(record.nickname?.trim() || record.accountId),
    }));

  return resolved.sort((left, right) => {
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

const main = async (): Promise<void> => {
  const options = parseArgs();
  const neededPerAccount = DAYS * POSTS_PER_DAY;

  await mongoose.connect(process.env.MONGO_URI ?? '');

  try {
    const accounts = await loadGoatAccounts();
    const sheetKeywords = await fetchSheetKeywords();
    const shuffledKeywords = shuffleKeywords(
      sheetKeywords,
      `${options.scheduleDate}:${options.scheduleMode}:${SHEET_GID}:${accounts.length}`,
    );

    const neededKeywords = accounts.length * neededPerAccount;
    if (shuffledKeywords.length < neededKeywords) {
      throw new Error(`not enough keywords: ${shuffledKeywords.length} < ${neededKeywords}`);
    }

    const assigned = assignDiversifiedKeywords(accounts, shuffledKeywords, neededPerAccount);
    const selectedKeywords = assigned.flatMap((account) => account.keywords);

    const previews: PreviewAccount[] = assigned.map((account) => ({
      id: account.id,
      password: account.password,
      blogId: account.blogId,
      displayName: account.displayName,
      keywords: account.keywords,
      items: calculateSchedule(account.keywords, options.scheduleDate, options.scheduleMode),
    }));

    console.log('=== goat schedule plan ===');
    console.log(`sheet_gid=${SHEET_GID}`);
    console.log(`schedule_date=${options.scheduleDate}`);
    console.log(`schedule_mode=${options.scheduleMode}`);
    console.log(`accounts=${assigned.length}`);
    console.log(`keywords=${selectedKeywords.length}`);

    for (const preview of previews) {
      console.log(`\n[${preview.displayName}] ${preview.id}`);
      for (const item of preview.items) {
        console.log(`  ${formatKst(item.scheduledAt)} | ${item.keyword}`);
      }
    }

    if (options.dryRun) {
      return;
    }

    const response = await fetch(`${SCHEDULER_API_URL}/bot/auto-schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        queues: previews.map((preview) => ({
          account: {
            id: preview.id,
            password: preview.password,
            blogId: preview.blogId,
          },
          keywords: preview.keywords,
          items: preview.items.map((item) => ({
            keyword: item.keyword,
            category: item.category,
            scheduledAt: formatKst(item.scheduledAt),
            slot: item.slot,
          })),
          blog_name: preview.displayName,
        })),
        schedule_date: options.scheduleDate,
        schedule_mode: options.scheduleMode,
        service: 'default',
        ref: '',
        generate_images: true,
        image_count: 5,
        image_source: 'product',
        manuscript_type: 'hanryeodamwon',
        delay_between_posts: 10,
        keyword_category: '한려담원',
      }),
    });

    if (!response.ok) {
      throw new Error(`auto-schedule failed: ${response.status} ${await response.text()}`);
    }

    console.log('\n=== direct schedule result ===');
    console.log(JSON.stringify(await response.json(), null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
