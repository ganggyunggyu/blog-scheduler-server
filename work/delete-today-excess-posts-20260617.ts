import 'dotenv/config';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import type { Page } from 'playwright';
import { naverLogin } from '../src/services/naver-auth.service.js';
import {
  closeSession,
  createSession,
  waitForFrame,
} from '../src/lib/naver-editor/index.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const TARGET_DATE = '2026-06-17';
const EXECUTE = process.argv.includes('--execute');
const TARGET_CATEGORIES = ['흑염소', '윤슬', '추상의구체화', '알리바바'];
const OUTPUT_PATH = `outputs/today-excess-delete-${TARGET_DATE}${EXECUTE ? '-execute' : '-dry-run'}.json`;

interface AccountRow {
  accountId: string;
  blogId?: string;
  nickname?: string;
  category?: string;
}

interface CredentialRow {
  accountId: string;
  password?: string;
}

interface ScheduleRow {
  _id: string;
  accountId: string;
}

interface JobRow {
  _id: string;
  scheduleId: string;
  keyword: string;
  scheduledAt: string;
  status: string;
  postUrl?: string;
}

interface PublicPost {
  logNo: string;
  title: string;
  pubDate: string;
  link: string;
  matchedKeyword?: string;
  keep: boolean;
  keepReason?: string;
  deleteReason?: string;
}

interface AccountPlan {
  accountId: string;
  blogId: string;
  nickname: string;
  category: string;
  expected: number;
  jobs: JobRow[];
  posts: PublicPost[];
  deleteTargets: PublicPost[];
  deleted: Array<{ logNo: string; title: string; ok: boolean; dbUpdated: boolean; message?: string }>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const expectedForCategory = (category: string): number =>
  category === '알리바바' ? 3 : 2;

const normalize = (value: string): string =>
  value.replace(/\s+/g, '').toLowerCase();

const extractTag = (xml: string, tag: string): string => {
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  if (cdata) return cdata[1].trim();
  const plain = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return plain ? plain[1].trim() : '';
};

const parsePubDateKst = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

const compareLogNoDesc = (left: PublicPost, right: PublicPost): number =>
  Number(BigInt(right.logNo) - BigInt(left.logNo));

const fetchTodayPosts = async (
  blogId: string,
  keywords: string[],
): Promise<PublicPost[]> => {
  const response = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`RSS 조회 실패: ${blogId} status=${response.status}`);
  }

  const normalizedKeywords = [...new Set(keywords)]
    .filter(Boolean)
    .map((keyword) => ({
      raw: keyword,
      normalized: normalize(keyword),
    }))
    .sort((left, right) => right.normalized.length - left.normalized.length);

  const xml = await response.text();
  const posts: PublicPost[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const pubDate = extractTag(item, 'pubDate');
    if (parsePubDateKst(pubDate) !== TARGET_DATE) {
      continue;
    }

    const title = extractTag(item, 'title');
    const link = extractTag(item, 'link');
    const logNoMatch = link.match(/\/(\d{10,})/);
    if (!logNoMatch) {
      continue;
    }

    const normalizedTitle = normalize(title);
    const matchedKeyword = normalizedKeywords.find((keyword) =>
      normalizedTitle.includes(keyword.normalized)
    )?.raw;

    posts.push({
      logNo: logNoMatch[1],
      title,
      pubDate,
      link,
      matchedKeyword,
      keep: false,
    });
  }

  return posts.sort(compareLogNoDesc);
};

const chooseKeepers = (
  posts: PublicPost[],
  expected: number,
): PublicPost[] => {
  const byKeyword = new Map<string, PublicPost[]>();
  const keepLogNos = new Set<string>();

  for (const post of posts.filter((candidate) => candidate.matchedKeyword)) {
    const key = post.matchedKeyword!;
    const group = byKeyword.get(key) ?? [];
    group.push(post);
    byKeyword.set(key, group);
  }

  for (const [keyword, group] of byKeyword) {
    const newest = [...group].sort(compareLogNoDesc)[0];
    newest.keep = true;
    newest.keepReason = `matched:${keyword}`;
    keepLogNos.add(newest.logNo);
  }

  for (const post of posts.sort(compareLogNoDesc)) {
    if (keepLogNos.size >= expected) {
      break;
    }
    if (keepLogNos.has(post.logNo)) {
      continue;
    }
    post.keep = true;
    post.keepReason = 'fill-latest';
    keepLogNos.add(post.logNo);
  }

  const keepers = posts
    .filter((post) => keepLogNos.has(post.logNo))
    .sort(compareLogNoDesc)
    .slice(0, expected);

  const finalKeepLogNos = new Set(keepers.map((post) => post.logNo));
  for (const post of posts) {
    if (finalKeepLogNos.has(post.logNo)) {
      post.keep = true;
      post.keepReason ||= 'selected';
      continue;
    }
    post.keep = false;
    if (post.matchedKeyword && posts.some((other) =>
      other.keep && other.matchedKeyword === post.matchedKeyword
    )) {
      post.deleteReason = 'duplicate-keyword';
    } else {
      post.deleteReason = 'over-quota';
    }
  }

  return keepers;
};

const deleteViaManagement = async (
  page: Page,
  blogId: string,
  post: PublicPost,
): Promise<{ ok: boolean; message?: string }> => {
  try {
    page.once('dialog', (dialog) => {
      dialog.accept().catch(() => undefined);
    });

    await page.goto(`https://blog.naver.com/${blogId}`, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await sleep(4000);

    const frame = await waitForFrame(page, 'mainFrame', 30_000);
    await page.evaluate(() => {
      document.getElementById('personalNoticeLayer')?.remove();
    }).catch(() => undefined);

    const toggleButton = await frame.$('a._toggleTopList');
    if (toggleButton && await toggleButton.isVisible().catch(() => false)) {
      await toggleButton.click();
      await sleep(1500);
    }

    const checkbox = await frame.$(`input[name="logNo"][value="${post.logNo}"]`);
    if (!checkbox) {
      return { ok: false, message: 'management-checkbox-not-found' };
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

      const controls = Array.from(document.querySelectorAll('a, button'));
      const deleteControl = controls.find((control) => {
        const text = (control.textContent || '').trim();
        const className = String((control as HTMLElement).className || '');
        return (
          (text.includes('삭제') && !text.includes('전체')) ||
          className.includes('delete') ||
          className.includes('del_btn')
        );
      }) as HTMLElement | undefined;

      if (!deleteControl) {
        return false;
      }

      deleteControl.click();
      return true;
    });

    if (!clicked) {
      return { ok: false, message: 'management-delete-button-not-found' };
    }

    await sleep(4000);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

const deleteDirect = async (
  page: Page,
  blogId: string,
  post: PublicPost,
): Promise<{ ok: boolean; message?: string }> => {
  try {
    page.once('dialog', (dialog) => {
      dialog.accept().catch(() => undefined);
    });

    await page.goto(`https://blog.naver.com/${blogId}/${post.logNo}`, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await sleep(4000);

    const frame = await waitForFrame(page, 'mainFrame', 30_000);
    await sleep(1500);

    const clicked = await frame.evaluate(() => {
      const overflow = document.querySelector(
        'button._open_overflowmenu, a._open_overflowmenu, [class*="_open_overflowmenu"], button[class*="more"], a[class*="more"], [class*="btn_more"], [class*="ico_more"]',
      ) as HTMLElement | null;
      overflow?.click();

      const controls = Array.from(document.querySelectorAll('a, button, span, li'));
      const deleteControl = controls.find((control) => {
        const text = (control.textContent || '').trim();
        return text === '삭제' || text === 'Delete';
      }) as HTMLElement | undefined;

      if (!deleteControl) {
        return false;
      }

      deleteControl.click();
      return true;
    });

    if (!clicked) {
      return { ok: false, message: 'direct-delete-control-not-found' };
    }

    await sleep(1500);
    await frame.evaluate(() => {
      const controls = Array.from(document.querySelectorAll('button, a'));
      const confirmControl = controls.find((control) => {
        const text = (control.textContent || '').trim();
        return text === '확인' || text === '삭제' || text === '네';
      }) as HTMLElement | undefined;
      confirmControl?.click();
    }).catch(() => undefined);

    await sleep(3500);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

const deletePost = async (
  page: Page,
  blogId: string,
  post: PublicPost,
): Promise<{ ok: boolean; message?: string }> => {
  const direct = await deleteDirect(page, blogId, post);
  if (direct.ok) {
    return direct;
  }

  const management = await deleteViaManagement(page, blogId, post);
  if (management.ok) {
    return management;
  }

  return {
    ok: false,
    message: `${direct.message ?? 'direct-failed'}; ${management.message ?? 'management-failed'}`,
  };
};

const markDeletedJob = async (
  accountId: string,
  jobs: JobRow[],
  post: PublicPost,
): Promise<boolean> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Mongo connection is not ready');
  }

  const schedules = await db.collection<ScheduleRow>('schedules')
    .find(
      { accountId },
      { projection: { _id: 1, accountId: 1 } },
    )
    .toArray();

  const exact = await db.collection<JobRow>('schedulejobs').findOne({
    scheduleId: { $in: schedules.map((schedule) => schedule._id) },
    postUrl: { $regex: post.logNo },
    status: 'published',
  });

  const fallback = !exact && post.matchedKeyword
    ? [...jobs]
      .filter((job) => job.keyword === post.matchedKeyword && job.status === 'published')
      .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))[0]
    : null;

  const target = exact ?? fallback;
  if (!target) {
    return false;
  }

  const result = await db.collection('schedulejobs').updateOne(
    { _id: target._id, status: 'published' },
    {
      $set: {
        status: 'cancelled',
        error: `deleted public post for daily count ${TARGET_DATE} ${post.logNo}`,
        updatedAt: new Date(),
      },
    },
  );

  return result.modifiedCount === 1;
};

const buildPlans = async (): Promise<AccountPlan[]> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Mongo connection is not ready');
  }

  const accounts = await db.collection<AccountRow>('blogaccounts')
    .find(
      {
        category: { $in: TARGET_CATEGORIES },
        $or: [{ isEnabled: true }, { isEnabled: { $exists: false } }],
        status: { $ne: 'disabled' },
      },
      { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, category: 1 } },
    )
    .sort({ category: 1, nickname: 1, accountId: 1 })
    .toArray();

  const scheduleRows = await db.collection<ScheduleRow>('schedules')
    .find(
      {
        accountId: { $in: accounts.map((account) => account.accountId) },
        status: { $ne: 'cancelled' },
      },
      { projection: { _id: 1, accountId: 1 } },
    )
    .toArray();

  const accountBySchedule = new Map(scheduleRows.map((schedule) => [String(schedule._id), schedule.accountId]));
  const rawJobs = await db.collection<JobRow>('schedulejobs')
    .find(
      {
        scheduleId: { $in: scheduleRows.map((schedule) => schedule._id) },
        scheduledAt: { $regex: `^${TARGET_DATE}` },
        status: { $ne: 'cancelled' },
      },
      { projection: { _id: 1, scheduleId: 1, keyword: 1, scheduledAt: 1, status: 1, postUrl: 1 } },
    )
    .sort({ scheduledAt: 1, _id: 1 })
    .toArray();

  const jobsByAccount = new Map<string, JobRow[]>();
  for (const job of rawJobs) {
    const accountId = accountBySchedule.get(String(job.scheduleId));
    if (!accountId) {
      continue;
    }

    const rows = jobsByAccount.get(accountId) ?? [];
    rows.push({ ...job, _id: String(job._id), scheduleId: String(job.scheduleId) });
    jobsByAccount.set(accountId, rows);
  }

  const plans: AccountPlan[] = [];
  for (const account of accounts) {
    const category = account.category || '';
    const expected = expectedForCategory(category);
    const jobs = jobsByAccount.get(account.accountId) ?? [];
    const posts = await fetchTodayPosts(
      account.blogId || account.accountId,
      jobs.map((job) => job.keyword),
    );
    chooseKeepers(posts, expected);
    plans.push({
      accountId: account.accountId,
      blogId: account.blogId || account.accountId,
      nickname: account.nickname || account.accountId,
      category,
      expected,
      jobs,
      posts,
      deleteTargets: posts.filter((post) => !post.keep),
      deleted: [],
    });
    await sleep(700);
  }

  return plans;
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const plans = await buildPlans();

    if (EXECUTE) {
      const cafeDb = mongoose.connection.useDb('cafe-bot');
      const credentials = await cafeDb.collection<CredentialRow>('accounts')
        .find(
          { accountId: { $in: plans.map((plan) => plan.accountId) } },
          { projection: { _id: 0, accountId: 1, password: 1 } },
        )
        .toArray();
      const credentialsById = new Map(credentials.map((credential) => [credential.accountId, credential]));

      for (const plan of plans.filter((candidate) => candidate.deleteTargets.length > 0)) {
        const credential = credentialsById.get(plan.accountId);
        if (!credential?.password) {
          plan.deleted.push({
            logNo: '',
            title: '',
            ok: false,
            dbUpdated: false,
            message: 'credential missing',
          });
          continue;
        }

        const login = await naverLogin(plan.accountId, credential.password);
        if (!login.success) {
          plan.deleted.push({
            logNo: '',
            title: '',
            ok: false,
            dbUpdated: false,
            message: login.message || 'login failed',
          });
          continue;
        }

        const session = await createSession(login.cookies);
        try {
          for (const post of plan.deleteTargets) {
            const result = await deletePost(session.page, plan.blogId, post);
            const dbUpdated = result.ok
              ? await markDeletedJob(plan.accountId, plan.jobs, post)
              : false;
            plan.deleted.push({
              logNo: post.logNo,
              title: post.title,
              ok: result.ok,
              dbUpdated,
              message: result.message,
            });
            await sleep(2500);
          }
        } finally {
          await closeSession(session);
        }

        await sleep(3000);
      }
    }

    await fs.mkdir('outputs', { recursive: true });
    const report = {
      targetDate: TARGET_DATE,
      execute: EXECUTE,
      generatedAt: new Date().toISOString(),
      totalTargets: plans.reduce((sum, plan) => sum + plan.deleteTargets.length, 0),
      totalDeleted: plans.reduce((sum, plan) => sum + plan.deleted.filter((row) => row.ok).length, 0),
      plans: plans.map((plan) => ({
        accountId: plan.accountId,
        blogId: plan.blogId,
        nickname: plan.nickname,
        category: plan.category,
        expected: plan.expected,
        todayCount: plan.posts.length,
        deleteCount: plan.deleteTargets.length,
        remainingCount: plan.posts.length - plan.deleteTargets.length,
        keep: plan.posts.filter((post) => post.keep).map((post) => ({
          logNo: post.logNo,
          title: post.title,
          keyword: post.matchedKeyword || '',
          reason: post.keepReason || '',
        })),
        deleteTargets: plan.deleteTargets.map((post) => ({
          logNo: post.logNo,
          title: post.title,
          keyword: post.matchedKeyword || '',
          reason: post.deleteReason || '',
        })),
        deleted: plan.deleted,
      })),
    };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);

    console.log(JSON.stringify({
      outputPath: OUTPUT_PATH,
      execute: EXECUTE,
      totalTargets: report.totalTargets,
      totalDeleted: report.totalDeleted,
      accounts: report.plans.map((plan) => ({
        accountId: plan.accountId,
        category: plan.category,
        todayCount: plan.todayCount,
        deleteCount: plan.deleteCount,
        remainingCount: plan.remainingCount,
        deleted: plan.deleted.filter((row) => row.ok).length,
      })),
    }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
