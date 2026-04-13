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

    const selectedKeywords = shuffledKeywords.slice(0, neededKeywords);
    const assigned = accounts.map((account) => ({
      ...account,
      keywords: [] as string[],
    }));

    for (const [index, keyword] of selectedKeywords.entries()) {
      assigned[index % assigned.length].keywords.push(keyword);
    }

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
