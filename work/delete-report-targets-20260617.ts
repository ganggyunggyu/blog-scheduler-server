import 'dotenv/config';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import type { Frame, Page } from 'playwright';
import { naverLogin } from '../src/services/naver-auth.service.js';
import { closeSession, createSession, waitForFrame } from '../src/lib/naver-editor/index.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const REPORT_PATH = process.argv.find((arg) => arg.startsWith('--report='))?.slice('--report='.length)
  || 'outputs/today-excess-delete-2026-06-17-dry-run.json';
const EXECUTE = process.argv.includes('--execute');
const ACCOUNT_FILTER = new Set(
  (process.argv.find((arg) => arg.startsWith('--accounts='))?.slice('--accounts='.length) || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const LIMIT = Number(process.argv.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length) || '0');
const OUTPUT_PATH = `outputs/delete-report-targets-2026-06-17${EXECUTE ? '-execute' : '-dry-run'}.json`;

interface ReportPlan {
  accountId: string;
  blogId: string;
  nickname: string;
  category: string;
  deleteTargets: Array<{ logNo: string; title: string; keyword?: string; reason?: string }>;
}

interface DeleteAttempt {
  logNo: string;
  title: string;
  requested: boolean;
  alreadyGone: boolean;
  ok: boolean;
  method?: string;
  message?: string;
}

interface AccountResult {
  accountId: string;
  blogId: string;
  nickname: string;
  category: string;
  attempts: DeleteAttempt[];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const decodeTitle = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value.replace(/\+/g, ' ');
  }
};

const extractJsonArray = (text: string): unknown[] => {
  const start = text.indexOf('[');
  if (start < 0) {
    return [];
  }

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
    if (inString) {
      continue;
    }
    if (char === '[') {
      depth += 1;
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

  return JSON.parse(text.slice(start, end)) as unknown[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const listPublicLogNos = async (blogId: string): Promise<Set<string>> => {
  const logNos = new Set<string>();
  for (let page = 1; page <= 4; page += 1) {
    const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&viewdate=&currentPage=${page}&categoryNo=0&parentCategoryNo=&countPerPage=30`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        Referer: `https://blog.naver.com/${blogId}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`public list failed: ${blogId} page=${page} status=${response.status}`);
    }

    const rawItems = extractJsonArray(await response.text()).filter(isRecord);
    if (rawItems.length === 0) {
      break;
    }

    for (const item of rawItems) {
      const logNo = String(item.logNo ?? '');
      if (logNo) {
        logNos.add(logNo);
      }
    }
    await sleep(500);
  }
  return logNos;
};

const clickConfirmDelete = async (frame: Frame): Promise<boolean> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ready = await frame.evaluate(() => {
      const layer = document.querySelector('#sendPostLayer') as HTMLElement | null;
      const control = document.querySelector('#sendPostLayerBtn') as HTMLElement | null;
      const content = (document.querySelector('#layerContent')?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!layer || !control) {
        return false;
      }
      const style = layer.getAttribute('style') || '';
      const rect = control.getBoundingClientRect();
      return !style.includes('-10000px') && rect.width > 0 && rect.height > 0 && content.length > 0;
    }).catch(() => false);

    if (ready) {
      await frame.locator('#sendPostLayerBtn').click({ force: true, timeout: 10_000 });
      return true;
    }
    await sleep(500);
  }
  return false;
};

const deleteDirect = async (
  page: Page,
  blogId: string,
  logNo: string,
): Promise<{ ok: boolean; message?: string }> => {
  await page.goto(`https://blog.naver.com/${blogId}/${logNo}`, {
    waitUntil: 'load',
    timeout: 60_000,
  });
  await sleep(3500);

  const frame = await waitForFrame(page, 'mainFrame', 30_000);
  await sleep(1000);

  const invoked = await frame.evaluate((targetLogNo) => {
    const candidateWindow = window as typeof window & {
      postView?: {
        deletePost?: (
          event: unknown,
          logNo: number,
          action?: string | null,
          notice?: boolean | string,
        ) => void;
      };
    };
    if (!candidateWindow.postView?.deletePost) {
      return 'postView.deletePost-not-found';
    }
    window.confirm = () => true;
    candidateWindow.postView.deletePost(null, Number(targetLogNo), null, false);
    return 'invoked';
  }, logNo);

  if (invoked === 'invoked') {
    await sleep(5000);
    return { ok: true };
  }

  const deleteLinks = frame.locator('a._deletePost').filter({ hasText: /삭제/ });
  const count = await deleteLinks.count();
  if (count === 0) {
    return { ok: false, message: `direct-delete-control-not-found; ${invoked}` };
  }

  await deleteLinks.nth(count - 1).scrollIntoViewIfNeeded({ timeout: 10_000 });
  await deleteLinks.nth(count - 1).click({ timeout: 10_000 });

  const confirmed = await clickConfirmDelete(frame);
  if (!confirmed) {
    return { ok: false, message: 'confirm-not-found-after-visible-delete' };
  }

  await sleep(3500);
  return { ok: true };
};

const deleteFromManagement = async (
  page: Page,
  blogId: string,
  logNo: string,
): Promise<{ ok: boolean; message?: string }> => {
  await page.goto(`https://blog.naver.com/PostList.naver?blogId=${blogId}&widgetTypeCall=true&noTrackingCode=true&directAccess=true`, {
    waitUntil: 'load',
    timeout: 60_000,
  });
  await sleep(3000);

  const frame = await waitForFrame(page, 'mainFrame', 30_000);
  await page.evaluate(() => {
    document.getElementById('personalNoticeLayer')?.remove();
  }).catch(() => undefined);

  const found = await frame.evaluate((targetLogNo) => {
    const checkbox = document.querySelector(`input[name="logNo"][value="${targetLogNo}"]`) as HTMLInputElement | null;
    if (!checkbox) {
      return false;
    }
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('click', { bubbles: true }));
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, logNo);

  if (!found) {
    return { ok: false, message: 'management-checkbox-not-found' };
  }

  await sleep(700);

  const clicked = await frame.evaluate(() => {
    const control = document.querySelector('._cfmDeletePost') as HTMLElement | null;
    if (!control) {
      return false;
    }
    control.click();
    return true;
  });

  if (!clicked) {
    return { ok: false, message: 'management-delete-button-not-found' };
  }

  const confirmed = await clickConfirmDelete(frame);
  if (!confirmed) {
    return { ok: false, message: 'management-confirm-not-found' };
  }

  await sleep(3500);
  return { ok: true };
};

const deletePost = async (
  page: Page,
  blogId: string,
  logNo: string,
): Promise<{ ok: boolean; method?: string; message?: string }> => {
  let direct: { ok: boolean; message?: string };
  try {
    direct = await deleteDirect(page, blogId, logNo);
  } catch (error) {
    direct = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (direct.ok) {
    return { ok: true, method: 'direct' };
  }

  let management: { ok: boolean; message?: string };
  try {
    management = await deleteFromManagement(page, blogId, logNo);
  } catch (error) {
    management = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (management.ok) {
    return { ok: true, method: 'management' };
  }

  return {
    ok: false,
    message: `${direct.message ?? 'direct-failed'}; ${management.message ?? 'management-failed'}`,
  };
};

const loadPlans = async (): Promise<ReportPlan[]> => {
  const raw = JSON.parse(await fs.readFile(REPORT_PATH, 'utf8')) as { plans: ReportPlan[] };
  const plans = raw.plans
    .filter((plan) => plan.deleteTargets.length > 0)
    .filter((plan) => ACCOUNT_FILTER.size === 0 || ACCOUNT_FILTER.has(plan.accountId));

  if (LIMIT <= 0) {
    return plans;
  }

  let remaining = LIMIT;
  return plans.flatMap((plan) => {
    if (remaining <= 0) {
      return [];
    }
    const targets = plan.deleteTargets.slice(0, remaining);
    remaining -= targets.length;
    return [{ ...plan, deleteTargets: targets }];
  });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const results: AccountResult[] = [];

  try {
    const plans = await loadPlans();
    const cafeDb = mongoose.connection.useDb('cafe-bot');
    const credentials = await cafeDb.collection<CredentialRow>('accounts')
      .find(
        { accountId: { $in: plans.map((plan) => plan.accountId) } },
        { projection: { _id: 0, accountId: 1, password: 1 } },
      )
      .toArray();
    const credentialsById = new Map(credentials.map((credential) => [credential.accountId, credential]));

    for (const plan of plans) {
      const publicBefore = await listPublicLogNos(plan.blogId);
      const targets = plan.deleteTargets.filter((target) => publicBefore.has(target.logNo));
      const result: AccountResult = {
        accountId: plan.accountId,
        blogId: plan.blogId,
        nickname: plan.nickname,
        category: plan.category,
        attempts: plan.deleteTargets.map((target) => ({
          logNo: target.logNo,
          title: decodeTitle(target.title),
          requested: targets.some((candidate) => candidate.logNo === target.logNo),
          alreadyGone: !publicBefore.has(target.logNo),
          ok: !publicBefore.has(target.logNo),
        })),
      };
      results.push(result);

      if (targets.length === 0 || !EXECUTE) {
        continue;
      }

      const credential = credentialsById.get(plan.accountId);
      if (!credential?.password) {
        for (const attempt of result.attempts.filter((attempt) => attempt.requested)) {
          attempt.ok = false;
          attempt.message = 'credential missing';
        }
        continue;
      }

      const login = await naverLogin(plan.accountId, credential.password);
      if (!login.success) {
        for (const attempt of result.attempts.filter((attempt) => attempt.requested)) {
          attempt.ok = false;
          attempt.message = login.message || 'login failed';
        }
        continue;
      }

      const session = await createSession(login.cookies);
      try {
        for (const target of targets) {
          const attempt = result.attempts.find((candidate) => candidate.logNo === target.logNo);
          if (!attempt) {
            continue;
          }
          const deletion = await deletePost(session.page, plan.blogId, target.logNo);
          const publicAfter = deletion.ok ? await listPublicLogNos(plan.blogId) : publicBefore;
          attempt.ok = deletion.ok && !publicAfter.has(target.logNo);
          attempt.method = deletion.method;
          attempt.message = attempt.ok ? undefined : deletion.message || 'still-public-after-delete';
          await sleep(1500);
        }
      } finally {
        await closeSession(session);
      }

      await sleep(2500);
    }

    await fs.mkdir('outputs', { recursive: true });
    const summary = {
      execute: EXECUTE,
      reportPath: REPORT_PATH,
      generatedAt: new Date().toISOString(),
      totalRequested: results.reduce((sum, account) => sum + account.attempts.filter((attempt) => attempt.requested).length, 0),
      totalOk: results.reduce((sum, account) => sum + account.attempts.filter((attempt) => attempt.ok).length, 0),
      results,
    };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({
      outputPath: OUTPUT_PATH,
      execute: EXECUTE,
      totalRequested: summary.totalRequested,
      totalOk: summary.totalOk,
      accounts: results.map((account) => ({
        accountId: account.accountId,
        requested: account.attempts.filter((attempt) => attempt.requested).length,
        ok: account.attempts.filter((attempt) => attempt.ok).length,
        failed: account.attempts.filter((attempt) => attempt.requested && !attempt.ok).length,
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
