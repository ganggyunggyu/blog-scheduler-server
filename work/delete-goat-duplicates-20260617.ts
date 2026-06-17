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

const TARGET_DATE = '2026-06-17';
const TARGET_CATEGORY = '흑염소';
const EXPECTED_PER_ACCOUNT = 2;
const EXECUTE = process.argv.includes('--execute');
const OUTPUT_PATH = `outputs/goat-duplicate-delete-${TARGET_DATE}${EXECUTE ? '-execute' : '-dry-run'}.json`;

interface AccountRow {
  accountId: string;
  blogId?: string;
  nickname?: string;
  category?: string;
}

interface CredentialRow {
  accountId: string;
  password?: string;
  blogId?: string;
  nickname?: string;
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
  matchedKeyword: string;
}

interface DeleteTarget extends PublicPost {
  reason: 'duplicate-keyword' | 'over-quota';
}

interface AccountPlan {
  accountId: string;
  blogId: string;
  nickname: string;
  jobs: JobRow[];
  matchedPosts: PublicPost[];
  deleteTargets: DeleteTarget[];
  remainingCount: number;
  deleted: Array<{ logNo: string; title: string; keyword: string; ok: boolean; dbUpdated: boolean; message?: string }>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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

  const normalizedKeywords = keywords.map((keyword) => ({
    raw: keyword,
    normalized: normalize(keyword),
  }));
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
    );

    if (!matchedKeyword) {
      continue;
    }

    posts.push({
      logNo: logNoMatch[1],
      title,
      pubDate,
      link,
      matchedKeyword: matchedKeyword.raw,
    });
  }

  return posts.sort((left, right) => Number(BigInt(right.logNo) - BigInt(left.logNo)));
};

const buildDeleteTargets = (posts: PublicPost[]): DeleteTarget[] => {
  const toDelete = new Map<string, DeleteTarget>();
  const byKeyword = new Map<string, PublicPost[]>();

  for (const post of posts) {
    const rows = byKeyword.get(post.matchedKeyword) ?? [];
    rows.push(post);
    byKeyword.set(post.matchedKeyword, rows);
  }

  for (const group of byKeyword.values()) {
    const sorted = [...group].sort((left, right) => Number(BigInt(right.logNo) - BigInt(left.logNo)));
    for (const post of sorted.slice(1)) {
      toDelete.set(post.logNo, { ...post, reason: 'duplicate-keyword' });
    }
  }

  const remainingAfterDuplicates = posts
    .filter((post) => !toDelete.has(post.logNo))
    .sort((left, right) => Number(BigInt(right.logNo) - BigInt(left.logNo)));

  if (remainingAfterDuplicates.length > EXPECTED_PER_ACCOUNT) {
    for (const post of remainingAfterDuplicates.slice(EXPECTED_PER_ACCOUNT)) {
      toDelete.set(post.logNo, { ...post, reason: 'over-quota' });
    }
  }

  return [...toDelete.values()].sort((left, right) => Number(BigInt(left.logNo) - BigInt(right.logNo)));
};

const deletePost = async (
  page: Page,
  blogId: string,
  post: DeleteTarget,
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

    const directResult = await frame.evaluate(() => {
      const overflow = document.querySelector(
        'button._open_overflowmenu, a._open_overflowmenu, [class*="_open_overflowmenu"], button[class*="more"], a[class*="more"], [class*="btn_more"], [class*="ico_more"]',
      ) as HTMLElement | null;
      if (overflow) {
        overflow.click();
      }

      const candidates = Array.from(document.querySelectorAll('a, button, span, li'));
      const deleteControl = candidates.find((element) => {
        const text = (element.textContent || '').trim();
        return text === '삭제' || text === 'Delete';
      }) as HTMLElement | undefined;

      if (!deleteControl) {
        return 'no-delete-control';
      }

      deleteControl.click();
      return 'clicked';
    });

    if (directResult !== 'clicked') {
      return { ok: false, message: directResult };
    }

    await sleep(1500);

    await frame.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, a'));
      const confirmControl = candidates.find((element) => {
        const text = (element.textContent || '').trim();
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

const markDeletedJob = async (
  accountId: string,
  jobs: JobRow[],
  target: DeleteTarget,
): Promise<boolean> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Mongo connection is not ready');
  }

  const exactByUrl = jobs.find((job) => job.postUrl?.includes(target.logNo));
  const fallbackByKeyword = [...jobs]
    .filter((job) => job.keyword === target.matchedKeyword && job.status === 'published')
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))[0];
  const targetJob = exactByUrl ?? fallbackByKeyword;

  if (!targetJob) {
    return false;
  }

  const result = await db.collection('schedulejobs').updateOne(
    { _id: targetJob._id, status: 'published' },
    {
      $set: {
        status: 'cancelled',
        error: `deleted duplicate public post ${TARGET_DATE} ${target.logNo}`,
        updatedAt: new Date(),
      },
    },
  );

  await db.collection('schedules').updateOne(
    { _id: targetJob.scheduleId, accountId },
    { $set: { updatedAt: new Date() } },
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
        category: TARGET_CATEGORY,
        $or: [{ isEnabled: true }, { isEnabled: { $exists: false } }],
        status: { $ne: 'disabled' },
      },
      { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, category: 1 } },
    )
    .sort({ nickname: 1, accountId: 1 })
    .toArray();

  const scheduleRows = await db.collection('schedules')
    .find(
      {
        accountId: { $in: accounts.map((account) => account.accountId) },
        status: { $ne: 'cancelled' },
      },
      { projection: { _id: 1, accountId: 1 } },
    )
    .toArray();

  const accountByScheduleId = new Map(scheduleRows.map((schedule) => [String(schedule._id), schedule.accountId]));
  const jobsRaw = await db.collection<JobRow>('schedulejobs')
    .find(
      {
        scheduleId: { $in: scheduleRows.map((schedule) => schedule._id) },
        scheduledAt: { $regex: `^${TARGET_DATE}` },
        status: { $in: ['published', 'failed'] },
      },
      { projection: { _id: 1, scheduleId: 1, keyword: 1, scheduledAt: 1, status: 1, postUrl: 1 } },
    )
    .sort({ scheduledAt: 1, _id: 1 })
    .toArray();

  const jobsByAccount = new Map<string, JobRow[]>();
  for (const job of jobsRaw) {
    const accountId = accountByScheduleId.get(String(job.scheduleId));
    if (!accountId) {
      continue;
    }
    const rows = jobsByAccount.get(accountId) ?? [];
    rows.push({ ...job, _id: String(job._id), scheduleId: String(job.scheduleId) });
    jobsByAccount.set(accountId, rows);
  }

  const plans: AccountPlan[] = [];
  for (const account of accounts) {
    const jobs = jobsByAccount.get(account.accountId) ?? [];
    const keywords = [...new Set(jobs.map((job) => job.keyword).filter(Boolean))];
    const blogId = account.blogId || account.accountId;
    const matchedPosts = await fetchTodayPosts(blogId, keywords);
    const deleteTargets = buildDeleteTargets(matchedPosts);
    plans.push({
      accountId: account.accountId,
      blogId,
      nickname: account.nickname || account.accountId,
      jobs,
      matchedPosts,
      deleteTargets,
      remainingCount: matchedPosts.length - deleteTargets.length,
      deleted: [],
    });
    await sleep(800);
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
          { projection: { _id: 0, accountId: 1, password: 1, blogId: 1, nickname: 1 } },
        )
        .toArray();
      const credentialsById = new Map(credentials.map((credential) => [credential.accountId, credential]));

      for (const plan of plans.filter((candidate) => candidate.deleteTargets.length > 0)) {
        const credential = credentialsById.get(plan.accountId);
        if (!credential?.password) {
          plan.deleted.push({
            logNo: '',
            title: '',
            keyword: '',
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
            keyword: '',
            ok: false,
            dbUpdated: false,
            message: login.message || 'login failed',
          });
          continue;
        }

        const session = await createSession(login.cookies);
        try {
          for (const target of plan.deleteTargets) {
            const result = await deletePost(session.page, plan.blogId, target);
            let dbUpdated = false;
            if (result.ok) {
              dbUpdated = await markDeletedJob(plan.accountId, plan.jobs, target);
            }
            plan.deleted.push({
              logNo: target.logNo,
              title: target.title,
              keyword: target.matchedKeyword,
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
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify({
      targetDate: TARGET_DATE,
      execute: EXECUTE,
      generatedAt: new Date().toISOString(),
      expectedPerAccount: EXPECTED_PER_ACCOUNT,
      totalTargets: plans.reduce((sum, plan) => sum + plan.deleteTargets.length, 0),
      totalDeleted: plans.reduce((sum, plan) => sum + plan.deleted.filter((row) => row.ok).length, 0),
      plans: plans.map((plan) => ({
        accountId: plan.accountId,
        blogId: plan.blogId,
        nickname: plan.nickname,
        matchedPosts: plan.matchedPosts.map((post) => ({
          logNo: post.logNo,
          title: post.title,
          keyword: post.matchedKeyword,
          pubDate: post.pubDate,
        })),
        deleteTargets: plan.deleteTargets.map((post) => ({
          logNo: post.logNo,
          title: post.title,
          keyword: post.matchedKeyword,
          reason: post.reason,
        })),
        remainingCount: plan.remainingCount,
        deleted: plan.deleted,
      })),
    }, null, 2)}\n`);

    console.log(JSON.stringify({
      outputPath: OUTPUT_PATH,
      execute: EXECUTE,
      totalTargets: plans.reduce((sum, plan) => sum + plan.deleteTargets.length, 0),
      totalDeleted: plans.reduce((sum, plan) => sum + plan.deleted.filter((row) => row.ok).length, 0),
      accounts: plans.map((plan) => ({
        accountId: plan.accountId,
        nickname: plan.nickname,
        matched: plan.matchedPosts.length,
        targets: plan.deleteTargets.length,
        remaining: plan.remainingCount,
        deleted: plan.deleted.filter((row) => row.ok).length,
      })),
    }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
