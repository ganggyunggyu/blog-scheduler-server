import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { Queue, type ConnectionOptions, type Job } from 'bullmq';
import mongoose from 'mongoose';
import { redis } from '../src/config/redis.js';
import { buildAdhocGenerateIdentity, buildSchedulePublishJobId } from '../src/services/schedule-idempotency.service.js';

const START_DATE = process.env.GOAT_MODIFY_START_DATE ?? '2026-06-15';
const SERVICE = process.env.GOAT_MODIFY_SERVICE ?? 'goat-modify-from-20260615';
const REF = process.env.GOAT_MODIFY_REF ?? 'all-public-posts-from-20260615';
const OUTPUT_DIR = path.resolve(process.cwd(), 'outputs/goat-modify-from-20260615');
const SHEET_GID = '1025121967';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const SERVER_URL = process.env.SCHEDULER_SERVER_URL ?? 'http://localhost:8001';
const IMAGE_SOURCE = 'product';
const MANUSCRIPT_TYPE = 'hanryeodamwon';
const KEYWORD_CATEGORY = '한려담원';
const IMAGE_COUNT = 5;
const DELAY_BETWEEN_POSTS = 10;
const MONITOR_INTERVAL_MS = 30_000;
const MONITOR_TIMEOUT_MS = Number(process.env.GOAT_MODIFY_TIMEOUT_MS ?? 6 * 60 * 60 * 1000);

interface AccountDoc {
  accountId: string;
  blogId: string;
  nickname: string;
}

interface RawPostRecord {
  logNo?: string | number;
  title?: string;
  addDate?: string;
}

interface TargetPost {
  accountId: string;
  blogId: string;
  nickname: string;
  logNo: string;
  link: string;
  title: string;
  addDate: string;
  date: string;
  oldKeyword?: string;
}

interface Assignment extends TargetPost {
  newKeyword: string;
  newRoot: string;
}

interface JobIds {
  generateJobId: string;
  publishJobId: string;
  generateQueueName: string;
  publishQueueName: string;
}

interface MonitorRow extends Assignment, JobIds {
  generateState: string;
  publishState: string;
  done: boolean;
  failed: boolean;
  error?: string;
}

interface VerifyRow extends Assignment {
  title: string;
  titleOk: boolean;
  keywordOk: boolean;
  brandOk: boolean;
  imageCount: number;
  verified: boolean;
}

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const PLAN_ONLY = args.includes('--plan-only') || !EXECUTE;
const VERIFY_ONLY = args.includes('--verify-only');
const LIMIT = (() => {
  const index = args.indexOf('--limit');
  if (index < 0) return Number(process.env.GOAT_MODIFY_LIMIT ?? 0);
  return Number(args[index + 1] ?? 0);
})();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const writeJson = async (filename: string, value: unknown): Promise<void> => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
};

const readJsonIfExists = async <T>(filename: string): Promise<T | null> => {
  try {
    const text = await readFile(path.join(OUTPUT_DIR, filename), 'utf-8');
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (quoted && nextChar === '"') {
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
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }
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

const normalizeText = (value: string): string =>
  value.normalize('NFC').replace(/\s+/g, '').toLowerCase();

const decodeTitle = (raw: string): string => {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    decoded = raw;
  }

  return decoded
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
};

const decodeHtml = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

const getRoot = (keyword: string): string => {
  const normalized = keyword.replace(/\s+/g, '');
  if (/임산부|임신|산모|산후|수유부|출산/.test(normalized)) return '임신임산부';
  if (/수족냉증|족냉증|손발|손가락|손저림|손목|손끝|발이차|말초신경/.test(normalized)) return '수족냉증';
  if (/흑염소|염소즙|염소효능/.test(normalized)) return '흑염소';
  if (/홍삼/.test(normalized)) return '홍삼';
  if (/동충하초/.test(normalized)) return '동충하초';
  if (/만성피로/.test(normalized)) return '만성피로';
  if (/기력|공진단|녹용|십전대보탕|경옥고/.test(normalized)) return '기력';
  if (/소음인|소양인/.test(normalized)) return '체질';
  if (/혈압/.test(normalized)) return '혈압';
  if (/혈당|당뇨|당수치|당화혈색소/.test(normalized)) return '혈당당뇨';
  if (/콜레스테롤|중성지방|고지혈증/.test(normalized)) return '콜레스테롤';
  if (/당귀|감초|도라지|익모초|백출|복령|천궁|숙지황|영지|대추|아라키돈산/.test(normalized)) return '한약재';
  if (/간에좋|간수치/.test(normalized)) return '간';
  if (/관절|무릎|뼈/.test(normalized)) return '관절뼈';
  if (/면역/.test(normalized)) return '면역';
  if (/비타민|마그네슘|칼슘|칼륨|철분|엽산|오메가3|유산균/.test(normalized)) return '영양소';
  if (/빈혈/.test(normalized)) return '빈혈';
  if (/갱년기/.test(normalized)) return '갱년기';
  if (/남성활력|정력/.test(normalized)) return '남성';
  if (/소화|위염|속쓰림/.test(normalized)) return '소화';
  if (/혈액순환/.test(normalized)) return '혈액순환';
  if (/감기|독감/.test(normalized)) return '감기';
  if (/피로/.test(normalized)) return '피로';
  return normalized.slice(0, 2);
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededRandom = (seed: string): (() => number) => {
  let state = hashString(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
};

const shuffle = <T>(items: T[], random: () => number): T[] => {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(random() * (index + 1));
    [output[index], output[nextIndex]] = [output[nextIndex], output[index]];
  }
  return output;
};

const kstParts = (date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
};

const formatDateParts = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const formatKstDate = (date: Date): string => {
  const parts = kstParts(date);
  return formatDateParts(parts.year, parts.month, parts.day);
};

const parseNaverAddDate = (addDate: string): string | null => {
  const explicit = addDate.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
  if (explicit) {
    return formatDateParts(Number(explicit[1]), Number(explicit[2]), Number(explicit[3]));
  }

  const now = new Date();
  const minute = addDate.match(/(\d+)\s*분 전/);
  if (minute) {
    return formatKstDate(new Date(now.getTime() - Number(minute[1]) * 60_000));
  }

  const hour = addDate.match(/(\d+)\s*시간 전/);
  if (hour) {
    return formatKstDate(new Date(now.getTime() - Number(hour[1]) * 60 * 60_000));
  }

  if (addDate.includes('어제')) {
    return formatKstDate(new Date(now.getTime() - 24 * 60 * 60_000));
  }

  if (addDate.includes('방금')) {
    return formatKstDate(now);
  }

  return null;
};

const extractPostArray = (text: string): RawPostRecord[] => {
  const listStart = text.indexOf('"postList":[');
  if (listStart < 0) {
    return [];
  }

  const bracketStart = text.indexOf('[', listStart);
  let depth = 0;
  let end = -1;
  let quoted = false;
  let escaped = false;

  for (let index = bracketStart; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) {
      continue;
    }
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }

  if (end < 0) {
    return [];
  }

  const parsed = JSON.parse(text.slice(bracketStart, end)) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((item): item is RawPostRecord => Boolean(item) && typeof item === 'object' && 'logNo' in item);
};

const fetchPostListPage = async (blogId: string, page: number): Promise<string> => {
  const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&viewdate=&currentPage=${page}&categoryNo=0&parentCategoryNo=&countPerPage=30`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      Referer: `https://blog.naver.com/${blogId}`,
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`post list fetch failed: blogId=${blogId} page=${page} status=${response.status}`);
  }

  return response.text();
};

const loadAccounts = async (): Promise<AccountDoc[]> => {
  const records = await mongoose.connection.db!
    .collection<AccountDoc>('blogaccounts')
    .find(
      { category: '흑염소', isEnabled: { $ne: false } },
      { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1 } },
    )
    .sort({ nickname: 1 })
    .toArray();

  return records.map((record) => ({
    accountId: record.accountId,
    blogId: record.blogId || record.accountId,
    nickname: record.nickname || record.accountId,
  }));
};

const fetchPostsSince = async (
  account: AccountDoc,
  allKeywords: string[],
): Promise<TargetPost[]> => {
  const targets: TargetPost[] = [];

  for (let page = 1; page <= 30; page += 1) {
    const text = await fetchPostListPage(account.blogId, page);
    const posts = extractPostArray(text);
    if (posts.length === 0) {
      break;
    }

    let pageHasDateInRange = false;
    for (const post of posts) {
      const addDate = String(post.addDate ?? '');
      const date = parseNaverAddDate(addDate);
      if (!date) {
        continue;
      }

      if (date >= START_DATE) {
        pageHasDateInRange = true;
        const title = decodeTitle(String(post.title ?? ''));
        const oldKeyword = matchKeyword(title, allKeywords);
        const logNo = String(post.logNo ?? '');
        targets.push({
          accountId: account.accountId,
          blogId: account.blogId,
          nickname: account.nickname,
          logNo,
          link: `https://blog.naver.com/${account.blogId}/${logNo}`,
          title,
          addDate,
          date,
          ...(oldKeyword ? { oldKeyword } : {}),
        });
      }
    }

    if (!pageHasDateInRange) {
      const datedPosts = posts
        .map((post) => parseNaverAddDate(String(post.addDate ?? '')))
        .filter((date): date is string => Boolean(date));
      if (datedPosts.some((date) => date < START_DATE)) {
        break;
      }
    }

    await sleep(250);
  }

  return targets;
};

const fetchSheetKeywords = async (): Promise<{ primary: string[]; fallback: string[]; all: string[] }> => {
  const response = await fetch(SHEET_CSV_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`sheet fetch failed: ${response.status}`);
  }

  const rows = parseCsv(await response.text());
  const primary: string[] = [];
  const fallback: string[] = [];
  const all: string[] = [];
  const seen = new Set<string>();
  const addKeyword = (keyword: string, options: { primary: boolean; fallback: boolean }): void => {
    const trimmed = keyword.trim();
    if (!trimmed || trimmed === '키워드' || trimmed.startsWith('키워드 ')) {
      return;
    }

    const normalized = normalizeText(trimmed);
    if (seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    all.push(trimmed);
    if (options.fallback) {
      fallback.push(trimmed);
    }
    if (options.primary) {
      primary.push(trimmed);
    }
  };

  const headerKeywordCell = rows[0]?.[0] ?? '';
  for (const keyword of headerKeywordCell.split(/\s+/)) {
    addKeyword(keyword, { primary: true, fallback: true });
  }

  for (const [index, row] of rows.entries()) {
    if (index === 0) {
      continue;
    }

    const keyword = row[0]?.trim() ?? '';
    const exposure = row[3]?.trim() ?? '';
    const newLogic = (row[6]?.trim() ?? '').toLowerCase();
    if (!exposure) {
      addKeyword(keyword, { primary: newLogic === 'o', fallback: true });
    } else {
      addKeyword(keyword, { primary: false, fallback: false });
    }
  }

  return { primary, fallback, all };
};

const matchKeyword = (title: string, keywords: string[]): string | null => {
  const normalizedTitle = normalizeText(title);
  return keywords.find((keyword) => normalizedTitle.includes(normalizeText(keyword))) ?? null;
};

const assignKeywords = (
  targets: TargetPost[],
  keywordPool: string[],
): Assignment[] => {
  const random = seededRandom(`${SERVICE}:${REF}:${START_DATE}`);
  const shuffled = shuffle(keywordPool, random);
  const originalByRoot = new Map<string, string[]>();
  for (const keyword of shuffled) {
    const root = getRoot(keyword);
    const values = originalByRoot.get(root) ?? [];
    values.push(keyword);
    originalByRoot.set(root, values);
  }

  let poolByRoot = new Map<string, string[]>();
  const refillPool = (): void => {
    poolByRoot = new Map(
      [...originalByRoot.entries()].map(([root, keywords]) => [root, shuffle(keywords, random)]),
    );
  };
  const hasRemainingKeywords = (): boolean =>
    [...poolByRoot.values()].some((keywords) => keywords.length > 0);
  const pickKeyword = (root: string, oldKeyword?: string): string | null => {
    const keywords = poolByRoot.get(root);
    if (!keywords || keywords.length === 0) {
      return null;
    }

    const oldNormalized = oldKeyword ? normalizeText(oldKeyword) : '';
    const index = keywords.findIndex((keyword) => normalizeText(keyword) !== oldNormalized);
    const pickIndex = index >= 0 ? index : 0;
    const [keyword] = keywords.splice(pickIndex, 1);
    return keyword ?? null;
  };
  refillPool();

  const states = new Map<string, { posts: TargetPost[]; lastRoots: string[]; index: number }>();
  for (const target of targets) {
    const state = states.get(target.accountId) ?? { posts: [], lastRoots: [], index: 0 };
    state.posts.push(target);
    states.set(target.accountId, state);
  }

  for (const state of states.values()) {
    state.posts.sort((left, right) => {
      if (left.date !== right.date) {
        return right.date.localeCompare(left.date);
      }
      return BigInt(right.logNo) > BigInt(left.logNo) ? 1 : -1;
    });
  }

  const maxSlots = Math.max(...[...states.values()].map((state) => state.posts.length));
  const assignments: Assignment[] = [];

  for (let slot = 0; slot < maxSlots; slot += 1) {
    for (const state of states.values()) {
      const post = state.posts[state.index];
      if (!post) {
        continue;
      }

      if (!hasRemainingKeywords()) {
        refillPool();
      }

      const sortedRoots = [...poolByRoot.entries()]
        .filter(([, keywords]) => keywords.length > 0)
        .sort((left, right) => right[1].length - left[1].length);

      const pickedRoot = sortedRoots.find(([root]) => !state.lastRoots.includes(root))?.[0]
        ?? sortedRoots.find(([root]) => state.lastRoots[0] !== root)?.[0]
        ?? sortedRoots[0]?.[0];

      if (!pickedRoot) {
        throw new Error(`키워드 부족: assigned=${assignments.length} targets=${targets.length}`);
      }

      const newKeyword = pickKeyword(pickedRoot, post.oldKeyword);
      if (!newKeyword) {
        throw new Error(`키워드 풀 오류: root=${pickedRoot}`);
      }

      state.lastRoots.unshift(pickedRoot);
      state.lastRoots = state.lastRoots.slice(0, 2);
      state.index += 1;
      assignments.push({
        ...post,
        newKeyword,
        newRoot: pickedRoot,
      });
    }
  }

  return assignments.sort((left, right) => {
    if (left.accountId !== right.accountId) {
      return left.accountId.localeCompare(right.accountId);
    }
    if (left.date !== right.date) {
      return right.date.localeCompare(left.date);
    }
    return BigInt(right.logNo) > BigInt(left.logNo) ? 1 : -1;
  });
};

const loadPlan = async (): Promise<{ targets: TargetPost[]; assignments: Assignment[] }> => {
  await mongoose.connect(process.env.MONGO_URI!);
  try {
    const sheet = await fetchSheetKeywords();
    const accounts = await loadAccounts();
    const byAccount: Record<string, number> = {};
    const targets = (await Promise.all(accounts.map((account) => fetchPostsSince(account, sheet.all)))).flat();

    for (const target of targets) {
      byAccount[target.nickname] = (byAccount[target.nickname] ?? 0) + 1;
    }

    const preferredPool = sheet.primary.length > 0
      ? sheet.primary
      : sheet.fallback.length > 0
        ? sheet.fallback
        : sheet.all;
    const pool = preferredPool.length > 0 ? preferredPool : sheet.all;

    const assignments = assignKeywords(targets, pool);
    await writeJson('targets.json', {
      startDate: START_DATE,
      targetCount: targets.length,
      byAccount,
      targets,
    });
    await writeJson('plan.json', {
      service: SERVICE,
      ref: REF,
      keywordPool: {
        primary: sheet.primary.length,
        fallback: sheet.fallback.length,
        all: sheet.all.length,
        selected: pool.length,
        reusedByCycle: pool.length < targets.length,
      },
      assignmentCount: assignments.length,
      assignments,
    });

    console.log(`[plan] targets=${targets.length} accounts=${accounts.length} selectedPool=${pool.length}`);
    for (const [nickname, count] of Object.entries(byAccount)) {
      console.log(`  ${nickname}: ${count}`);
    }

    return { targets, assignments };
  } finally {
    await mongoose.disconnect();
  }
};

const getQueueNames = (accountId: string): { generateQueueName: string; publishQueueName: string } => {
  const safeAccountId = accountId.replace(/[^a-zA-Z0-9]/g, '_');
  return {
    generateQueueName: `generate_${safeAccountId}`,
    publishQueueName: `publish_${safeAccountId}`,
  };
};

const buildJobIds = (assignment: Assignment): JobIds => {
  const identity = buildAdhocGenerateIdentity({
    mode: 'update',
    accountId: assignment.accountId,
    blogId: assignment.blogId,
    logNo: assignment.logNo,
    keyword: assignment.newKeyword,
    service: SERVICE,
    ref: REF,
    imageSource: IMAGE_SOURCE,
    manuscriptType: MANUSCRIPT_TYPE,
    keywordCategory: KEYWORD_CATEGORY,
  });
  const queueNames = getQueueNames(assignment.accountId);
  return {
    ...queueNames,
    generateJobId: identity.jobId,
    publishJobId: buildSchedulePublishJobId(identity.scheduleJobId),
  };
};

const connection = redis as unknown as ConnectionOptions;
const queueCache = new Map<string, Queue>();

const getQueue = (name: string): Queue => {
  const existing = queueCache.get(name);
  if (existing) {
    return existing;
  }

  const queue = new Queue(name, { connection });
  queueCache.set(name, queue);
  return queue;
};

const getJobState = async (queueName: string, jobId: string): Promise<{ state: string; job: Job | null }> => {
  const queue = getQueue(queueName);
  const job = await queue.getJob(jobId);
  if (!job) {
    return { state: 'missing', job };
  }
  return { state: await job.getState(), job };
};

const isAlreadyCompleted = async (assignment: Assignment): Promise<boolean> => {
  const ids = buildJobIds(assignment);
  const publish = await getJobState(ids.publishQueueName, ids.publishJobId);
  if (publish.state === 'completed') {
    return true;
  }

  const generate = await getJobState(ids.generateQueueName, ids.generateJobId);
  return generate.state === 'completed' && publish.state === 'completed';
};

const enqueueAssignments = async (assignments: Assignment[]): Promise<Assignment[]> => {
  const ready: Assignment[] = [];
  for (const assignment of assignments) {
    if (await isAlreadyCompleted(assignment)) {
      continue;
    }
    ready.push(assignment);
  }

  const selected = LIMIT > 0 ? ready.slice(0, LIMIT) : ready;
  const byBlog = new Map<string, Assignment[]>();
  for (const assignment of selected) {
    const existing = byBlog.get(assignment.blogId) ?? [];
    existing.push(assignment);
    byBlog.set(assignment.blogId, existing);
  }

  const responses: unknown[] = [];
  for (const [blogId, items] of byBlog) {
    const response = await fetch(`${SERVER_URL}/bot/link-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keywords: items.map((item) => item.newKeyword),
        links: items.map((item) => item.link),
        service: SERVICE,
        ref: REF,
        generate_images: true,
        image_count: IMAGE_COUNT,
        image_source: IMAGE_SOURCE,
        manuscript_type: MANUSCRIPT_TYPE,
        delay_between_posts: DELAY_BETWEEN_POSTS,
        keyword_category: KEYWORD_CATEGORY,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const payload = await response.json() as unknown;
    responses.push({ blogId, count: items.length, status: response.status, payload });
    if (!response.ok) {
      throw new Error(`link-update failed: blogId=${blogId} status=${response.status} body=${JSON.stringify(payload)}`);
    }
    console.log(`[enqueue] ${blogId} ${items.length}개`);
  }

  await writeJson('enqueue-result.json', {
    service: SERVICE,
    ref: REF,
    requested: selected.length,
    skippedAlreadyCompleted: assignments.length - ready.length,
    responses,
  });

  return selected;
};

const summarizeMonitor = async (assignments: Assignment[]): Promise<MonitorRow[]> => {
  const rows: MonitorRow[] = [];
  for (const assignment of assignments) {
    const ids = buildJobIds(assignment);
    const [generate, publish] = await Promise.all([
      getJobState(ids.generateQueueName, ids.generateJobId),
      getJobState(ids.publishQueueName, ids.publishJobId),
    ]);
    const failed = generate.state === 'failed' || publish.state === 'failed';
    const done = publish.state === 'completed' || failed;
    const failedJob = generate.state === 'failed' ? generate.job : publish.state === 'failed' ? publish.job : null;
    rows.push({
      ...assignment,
      ...ids,
      generateState: generate.state,
      publishState: publish.state,
      done,
      failed,
      ...(failedJob?.failedReason ? { error: failedJob.failedReason } : {}),
    });
  }
  return rows;
};

const monitorAssignments = async (assignments: Assignment[]): Promise<MonitorRow[]> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MONITOR_TIMEOUT_MS) {
    const rows = await summarizeMonitor(assignments);
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      const key = row.failed ? 'failed' : row.done ? 'done' : `${row.generateState}/${row.publishState}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`[monitor] ${JSON.stringify(counts)}`);
    await writeJson('monitor-current.json', { service: SERVICE, ref: REF, counts, rows });

    if (rows.every((row) => row.done)) {
      await writeJson('monitor-final.json', { service: SERVICE, ref: REF, counts, rows });
      return rows;
    }

    await sleep(MONITOR_INTERVAL_MS);
  }

  const rows = await summarizeMonitor(assignments);
  await writeJson('monitor-timeout.json', { service: SERVICE, ref: REF, rows });
  throw new Error(`monitor timeout: ${assignments.length} jobs`);
};

const fetchPublicHtml = async (assignment: Assignment): Promise<string> => {
  const urls = [
    `https://m.blog.naver.com/PostView.naver?blogId=${encodeURIComponent(assignment.blogId)}&logNo=${encodeURIComponent(assignment.logNo)}&navType=by`,
    `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(assignment.blogId)}&logNo=${encodeURIComponent(assignment.logNo)}`,
    assignment.link,
  ];

  for (const url of urls) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        Referer: `https://blog.naver.com/${assignment.blogId}`,
      },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (response?.ok) {
      const html = await response.text();
      if (html.includes(assignment.logNo) || html.includes(assignment.newKeyword)) {
        return html;
      }
    }
  }

  throw new Error(`public verify fetch failed: ${assignment.link}`);
};

const extractPublicTitle = (html: string): string => {
  const patterns = [
    /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i,
    /<title>([^<]+)<\/title>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtml(match[1]).replace(/\s*:\s*네이버\s*블로그\s*$/i, '').trim();
    }
  }

  return '';
};

const verifyAssignments = async (assignments: Assignment[]): Promise<VerifyRow[]> => {
  const rows: VerifyRow[] = [];
  for (const [index, assignment] of assignments.entries()) {
    const html = await fetchPublicHtml(assignment);
    const title = extractPublicTitle(html);
    const text = decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
    const normalizedTitle = normalizeText(title);
    const normalizedKeyword = normalizeText(assignment.newKeyword);
    const imageCount = new Set(html.match(/https?:\/\/[^"']+(?:postfiles|blogfiles|phinf)\.pstatic\.net[^"']+/g) ?? []).size;
    const titleOk = normalizedTitle.includes(normalizedKeyword);
    const keywordOk = normalizeText(text).includes(normalizedKeyword);
    const brandOk = text.includes('한려담원') || text.includes('흑염소') || text.includes('염소');
    const verified = titleOk && keywordOk && brandOk && imageCount >= 1;

    rows.push({
      ...assignment,
      title,
      titleOk,
      keywordOk,
      brandOk,
      imageCount,
      verified,
    });
    console.log(`[verify] ${index + 1}/${assignments.length} ${verified ? 'OK' : 'FAIL'} ${assignment.blogId}/${assignment.logNo} "${title}"`);
    await sleep(300);
  }

  await writeJson('verify.json', {
    service: SERVICE,
    ref: REF,
    total: rows.length,
    verified: rows.filter((row) => row.verified).length,
    failed: rows.filter((row) => !row.verified).length,
    rows,
  });

  return rows;
};

const closeQueues = async (): Promise<void> => {
  await Promise.all([...queueCache.values()].map((queue) => queue.close().catch(() => undefined)));
};

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI?.startsWith('mongodb+srv://')) {
    throw new Error('MONGO_URI is not Atlas mongodb+srv URI');
  }

  const plan = VERIFY_ONLY
    ? await readJsonIfExists<{ assignments: Assignment[] }>('plan.json')
    : await loadPlan();

  if (!plan) {
    throw new Error('plan.json not found');
  }

  if (PLAN_ONLY && !VERIFY_ONLY) {
    return;
  }

  const assignments = LIMIT > 0 ? plan.assignments.slice(0, LIMIT) : plan.assignments;
  const enqueued = VERIFY_ONLY ? assignments : await enqueueAssignments(assignments);
  const monitored = VERIFY_ONLY ? [] : await monitorAssignments(enqueued);
  const failed = monitored.filter((row) => row.failed);
  if (failed.length > 0) {
    console.log(`[failed] ${failed.length}개`);
  }

  const verifyTargets = VERIFY_ONLY
    ? assignments
    : enqueued.filter((assignment) => !failed.some((row) => row.logNo === assignment.logNo && row.blogId === assignment.blogId));
  await verifyAssignments(verifyTargets);
};

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[fatal] ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  });
