import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import type { Page } from 'playwright';
import { naverLogin } from '../src/services/naver-auth.service.js';
import { createSession, closeSession, waitForFrame } from '../src/lib/naver-editor/index.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import type { BrowserSession } from '../src/lib/naver-editor/types.js';

const DRY_RUN = !process.argv.includes('--execute');
const START_DATE = '2026-06-01';
const END_DATE = '2026-06-08';
const KEEP_PER_DAY = 3;
const GROUP_246_PATH = '/Users/ganggyunggyu/Downloads/알리바바/블로그_2,4,6 키워드_72건.txt';
const GROUP_135_PATH = '/Users/ganggyunggyu/Downloads/알리바바/블로그_1,3,5 키워드_73건.txt';
const STATE_PATH = path.join(process.cwd(), 'data', 'alibaba-delete-excess-after-june-state.json');
const PREVIOUSLY_DELETED_LOGNOS = [
  '224303795390',
  '224305136715',
  '224305133219',
  '224307762416',
  '224307747730',
  '224305567427',
  '224305554565',
  '224307748487',
  '224307757233',
  '224307828980',
  '224307829157',
  '224307834755',
  '224307870378',
  '224307853656',
  '224307885334',
  '224307844983',
  '224307875299',
  '224307869906',
  '224303800996',
  '224303809995',
  '224307951484',
  '224305563010',
];

const GROUP_246 = ['mad1651', 'weed3122', 'individual14144'];
const GROUP_135 = ['crvfwy7062', 'heavymouse448', 'rqr1io45'];
const ACCOUNT_IDS = [...GROUP_135, ...GROUP_246];

interface AccountDoc {
  accountId: string;
  password: string;
  blogId?: string;
  nickname?: string;
}

interface ScheduleDoc {
  _id: string;
  accountId: string;
  service?: string;
  ref?: string;
}

interface JobDoc {
  _id: string;
  scheduleId: string;
  keyword: string;
  scheduledAt: string;
  postUrl?: string;
}

interface PublicPost {
  logNo: string;
  title: string;
  addDate: string;
}

interface PlannedPost extends JobDoc {
  accountId: string;
  nickname: string;
  blogId: string;
  service: string;
  ref: string;
  date: string;
  logNo: string;
  title: string;
  keep: boolean;
  keepReason: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const normalize = (value: string): string =>
  value.replace(/\s/g, '').toLowerCase();

const decodeTitle = (value: string): string => {
  const withSpaces = value.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(withSpaces);
  } catch {
    return withSpaces;
  }
};

const parseKeywordFile = async (filePath: string): Promise<Map<string, string[]>> => {
  const text = await readFile(filePath, 'utf8');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const byDate = new Map<string, string[]>();
  let currentDate = '';

  for (const line of lines) {
    const dateMatch = line.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (dateMatch) {
      currentDate = `2026-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
      byDate.set(currentDate, []);
      continue;
    }

    if (!currentDate) {
      throw new Error(`날짜 없는 키워드: ${line}`);
    }

    byDate.get(currentDate)?.push(line);
  }

  return byDate;
};

const loadDeletedLogNos = async (): Promise<Set<string>> => {
  const deleted = new Set(PREVIOUSLY_DELETED_LOGNOS);
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, 'utf8')) as unknown;
    if (Array.isArray(parsed)) {
      for (const value of parsed) {
        if (typeof value === 'string') deleted.add(value);
      }
    }
  } catch {
    return deleted;
  }
  return deleted;
};

const saveDeletedLogNos = async (deleted: Set<string>): Promise<void> => {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify([...deleted].sort(), null, 2), 'utf8');
};

const extractJsonArray = (text: string): unknown[] => {
  const start = text.indexOf('[');
  if (start < 0) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let index = start; index < text.length; index += 1) {
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
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }

  return end > start ? JSON.parse(text.slice(start, end)) as unknown[] : [];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const isClosedBrowserError = (error: unknown): boolean =>
  error instanceof Error &&
  (
    error.message.includes('Target page, context or browser has been closed') ||
    error.message.includes('Target closed') ||
    error.message.includes('Browser has been closed')
  );

const fetchPublicPosts = async (blogId: string): Promise<PublicPost[]> => {
  const posts: PublicPost[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 12; page += 1) {
    const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&viewdate=&currentPage=${page}&categoryNo=0&parentCategoryNo=&countPerPage=30`;
    let response: Response | null = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          Referer: `https://blog.naver.com/${blogId}`,
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) break;
      if (response.status !== 429 || attempt === 4) {
        throw new Error(`글 목록 조회 실패: ${blogId} page=${page} status=${response.status}`);
      }
      await sleep(10_000 * attempt);
    }

    if (!response?.ok) {
      throw new Error(`글 목록 조회 실패: ${blogId} page=${page}`);
    }
    const rawItems = extractJsonArray(await response.text()).filter(isRecord);
    if (rawItems.length === 0) break;

    for (const item of rawItems) {
      const logNo = String(item.logNo ?? '');
      if (!logNo || seen.has(logNo)) continue;
      seen.add(logNo);
      posts.push({
        logNo,
        title: decodeTitle(String(item.title ?? '')),
        addDate: String(item.addDate ?? ''),
      });
    }
    await sleep(1200);
  }

  return posts;
};

const resolveAccounts = async (): Promise<Map<string, AccountDoc>> => {
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const accounts = await cafeDb.collection<AccountDoc>('accounts')
    .find(
      { accountId: { $in: ACCOUNT_IDS } },
      { projection: { accountId: 1, password: 1, blogId: 1, nickname: 1 } },
    )
    .toArray();

  const byId = new Map(accounts.map((account) => [account.accountId, account]));
  const missing = ACCOUNT_IDS.filter((accountId) => !byId.get(accountId)?.password);
  if (missing.length > 0) {
    throw new Error(`계정 또는 비밀번호 없음: ${missing.join(', ')}`);
  }
  return byId;
};

const findMatchingPost = (
  posts: PublicPost[],
  keyword: string,
  usedLogNos: Set<string>,
): PublicPost | null => {
  const normalizedKeyword = normalize(keyword);
  const candidates = posts
    .filter((post) => !usedLogNos.has(post.logNo) && normalize(post.title).includes(normalizedKeyword))
    .sort((a, b) => BigInt(b.logNo) > BigInt(a.logNo) ? 1 : -1);

  return candidates[0] ?? null;
};

const collectPlannedPosts = async (
  expectedByAccountDate: Map<string, string[]>,
): Promise<PlannedPost[]> => {
  const accounts = await resolveAccounts();
  const schedules = await mongoose.connection.collection<ScheduleDoc>('schedules')
    .find(
      { accountId: { $in: ACCOUNT_IDS } },
      { projection: { _id: 1, accountId: 1, service: 1, ref: 1 } },
    )
    .toArray();
  const scheduleById = new Map(schedules.map((schedule) => [String(schedule._id), schedule]));
  const jobs = await mongoose.connection.collection<JobDoc>('schedulejobs')
    .find(
      {
        scheduleId: { $in: schedules.map((schedule) => String(schedule._id)) },
        scheduledAt: { $gte: `${START_DATE}T00:00:00+09:00`, $lte: `${END_DATE}T23:59:59+09:00` },
        status: 'published',
      },
      { projection: { _id: 1, scheduleId: 1, keyword: 1, scheduledAt: 1, postUrl: 1 } },
    )
    .sort({ scheduledAt: 1 })
    .toArray();

  const postsByBlogId = new Map<string, PublicPost[]>();
  const usedLogNosByBlogId = new Map<string, Set<string>>();
  const planned: PlannedPost[] = [];

  for (const accountId of ACCOUNT_IDS) {
    const account = accounts.get(accountId);
    if (!account) continue;
    const blogId = account.blogId || accountId;
    postsByBlogId.set(blogId, await fetchPublicPosts(blogId));
    usedLogNosByBlogId.set(blogId, new Set());
    console.log(`[list] ${account.nickname || accountId} (${blogId}) posts=${postsByBlogId.get(blogId)?.length ?? 0}`);
    await sleep(3000);
  }

  for (const job of jobs) {
    const schedule = scheduleById.get(String(job.scheduleId));
    if (!schedule) continue;
    const account = accounts.get(schedule.accountId);
    if (!account) continue;

    const blogId = account.blogId || schedule.accountId;
    const posts = postsByBlogId.get(blogId) ?? [];
    const usedLogNos = usedLogNosByBlogId.get(blogId) ?? new Set<string>();
    const matched = findMatchingPost(posts, job.keyword, usedLogNos);
    if (!matched) {
      console.log(`[miss] ${account.nickname || schedule.accountId} ${job.scheduledAt} ${job.keyword}`);
      continue;
    }
    usedLogNos.add(matched.logNo);

    planned.push({
      ...job,
      accountId: schedule.accountId,
      nickname: account.nickname || schedule.accountId,
      blogId,
      service: schedule.service || '',
      ref: schedule.ref || '',
      date: job.scheduledAt.slice(0, 10),
      logNo: matched.logNo,
      title: matched.title,
      keep: false,
      keepReason: '',
    });
  }

  const byAccountDate = new Map<string, PlannedPost[]>();
  for (const post of planned) {
    const key = `${post.accountId}\u0000${post.date}`;
    byAccountDate.set(key, [...(byAccountDate.get(key) ?? []), post]);
  }

  for (const [key, posts] of byAccountDate) {
    const [accountId, date] = key.split('\u0000');
    const expectedKeywords = expectedByAccountDate.get(key) ?? [];
    const normalizedExpected = new Set(expectedKeywords.map(normalize));
    const expectedMatches = posts.filter((post) => normalizedExpected.has(normalize(post.keyword)));
    expectedMatches
      .sort((a, b) => expectedKeywords.indexOf(a.keyword) - expectedKeywords.indexOf(b.keyword))
      .slice(0, KEEP_PER_DAY)
      .forEach((post) => {
        post.keep = true;
        post.keepReason = 'keyword-plan';
      });

    if (posts.filter((post) => post.keep).length < Math.min(KEEP_PER_DAY, posts.length)) {
      posts
        .filter((post) => !post.keep)
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
        .slice(0, KEEP_PER_DAY - posts.filter((post) => post.keep).length)
        .forEach((post) => {
          post.keep = true;
          post.keepReason = 'fill-daily-3';
        });
    }

    const kept = posts.filter((post) => post.keep).length;
    console.log(`[plan] ${accountId} ${date} published=${posts.length} keep=${kept} delete=${posts.length - kept}`);
  }

  return planned;
};

const deletePost = async (page: Page, blogId: string, logNo: string): Promise<boolean> => {
  page.once('dialog', (dialog) => {
    dialog.accept().catch(() => undefined);
  });

  await page.goto(`https://blog.naver.com/${blogId}/${logNo}`, {
    waitUntil: 'load',
    timeout: 60_000,
  });
  await sleep(3000);

  const frame = await waitForFrame(page, 'mainFrame', 30_000);
  await sleep(1000);

  const result = await frame.evaluate(() => {
    window.confirm = () => true;
    const menuButton = document.querySelector(
      'button._open_overflowmenu, a._open_overflowmenu, [class*="_open_overflowmenu"], .se-module-more-button',
    ) as HTMLElement | null;
    menuButton?.click();

    const directButtons = [...document.querySelectorAll('a, button, span')];
    const deleteButton = directButtons.find((element) => (element.textContent || '').trim() === '삭제') as HTMLElement | undefined;
    deleteButton?.click();

    return Boolean(deleteButton);
  });

  if (!result) return deletePostFromManagement(page, blogId, logNo);
  await sleep(3000);
  return true;
};

const deletePostFromManagement = async (page: Page, blogId: string, logNo: string): Promise<boolean> => {
  page.once('dialog', (dialog) => {
    dialog.accept().catch(() => undefined);
  });

  await page.goto(`https://blog.naver.com/${blogId}`, {
    waitUntil: 'load',
    timeout: 60_000,
  });
  await sleep(3000);

  const frame = await waitForFrame(page, 'mainFrame', 30_000);
  await page.evaluate(() => {
    document.getElementById('personalNoticeLayer')?.remove();
  });

  const toggleButton = await frame.$('a._toggleTopList');
  if (toggleButton && await toggleButton.isVisible().catch(() => false)) {
    await toggleButton.click();
    await sleep(1000);
  }

  const checkbox = await frame.$(`input[name="logNo"][value="${logNo}"]`);
  if (!checkbox) {
    return false;
  }
  await checkbox.check({ force: true });
  await sleep(500);

  const clicked = await frame.evaluate(() => {
    const selectors = ['a._topListDeleteBtn', 'button._topListDeleteBtn'];
    for (const selector of selectors) {
      const button = document.querySelector(selector) as HTMLElement | null;
      if (button) {
        button.click();
        return true;
      }
    }

    const buttons = [...document.querySelectorAll('a, button')];
    const deleteButton = buttons.find((button) => {
      const text = (button.textContent || '').trim();
      return text.includes('삭제') && !text.includes('전체');
    }) as HTMLElement | undefined;
    deleteButton?.click();
    return Boolean(deleteButton);
  });

  if (!clicked) return false;
  await sleep(3000);
  return true;
};

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const [group246, group135] = await Promise.all([
    parseKeywordFile(GROUP_246_PATH),
    parseKeywordFile(GROUP_135_PATH),
  ]);
  const expectedByAccountDate = new Map<string, string[]>();
  for (const [date, keywords] of group246) {
    for (const accountId of GROUP_246) expectedByAccountDate.set(`${accountId}\u0000${date}`, keywords);
  }
  for (const [date, keywords] of group135) {
    for (const accountId of GROUP_135) expectedByAccountDate.set(`${accountId}\u0000${date}`, keywords);
  }

  const planned = await collectPlannedPosts(expectedByAccountDate);
  const deletedLogNos = await loadDeletedLogNos();
  const toDelete = planned.filter((post) => !post.keep && !deletedLogNos.has(post.logNo));
  const toKeep = planned.filter((post) => post.keep);

  console.log(`\n=== 알리바바 6월 이후 초과 삭제 ${DRY_RUN ? 'DRY-RUN' : 'EXECUTE'} ===`);
  console.log(`matched=${planned.length} keep=${toKeep.length} alreadyDeleted=${deletedLogNos.size} delete=${toDelete.length}`);

  for (const post of toDelete) {
    console.log(`[delete] ${post.nickname} ${post.date} ${post.logNo} ${post.keyword} | ${post.title.slice(0, 60)}`);
  }

  if (DRY_RUN) {
    console.log('\n실행하려면 --execute 붙여 재실행함.');
    return;
  }

  const accounts = await resolveAccounts();
  let deleted = 0;
  const byAccount = new Map<string, PlannedPost[]>();
  for (const post of toDelete) {
    byAccount.set(post.accountId, [...(byAccount.get(post.accountId) ?? []), post]);
  }

  for (const [accountId, posts] of byAccount) {
    const account = accounts.get(accountId);
    if (!account) continue;
    const login = await naverLogin(accountId, account.password);
    if (!login.success) {
      console.log(`[login-fail] ${account.nickname || accountId}: ${login.message}`);
      continue;
    }

    let session: BrowserSession | null = await createSession(login.cookies, accountId);
    try {
      for (const post of posts) {
        try {
          if (!session || session.page.isClosed()) {
            session = await createSession(login.cookies, accountId);
          }
          const ok = await deletePost(session.page, post.blogId, post.logNo);
          if (ok) {
            deleted += 1;
            deletedLogNos.add(post.logNo);
            await saveDeletedLogNos(deletedLogNos);
          }
          console.log(`${ok ? '[deleted]' : '[delete-fail]'} ${post.nickname} ${post.logNo} ${post.keyword}`);
        } catch (error) {
          if (!isClosedBrowserError(error)) {
            console.log(`[delete-error] ${post.nickname} ${post.logNo} ${post.keyword}: ${error instanceof Error ? error.message : String(error)}`);
            continue;
          }
          await closeSession(session).catch(() => undefined);
          session = await createSession(login.cookies, accountId);
          const ok = await deletePost(session.page, post.blogId, post.logNo).catch(() => false);
          if (ok) {
            deleted += 1;
            deletedLogNos.add(post.logNo);
            await saveDeletedLogNos(deletedLogNos);
          }
          console.log(`${ok ? '[deleted-retry]' : '[delete-fail-retry]'} ${post.nickname} ${post.logNo} ${post.keyword}`);
        }
        await sleep(2000);
      }
    } finally {
      if (session) await closeSession(session);
    }
  }

  console.log(`\n[result] deleted=${deleted}/${toDelete.length}`);
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
