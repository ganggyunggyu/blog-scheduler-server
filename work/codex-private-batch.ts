import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { naverLogin } from '../src/services/naver-auth.service.js';
import { getBrowser, closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

type Target = {
  sheet: string;
  rowNumber: number;
  company: string;
  keyword: string;
  publishedAt: string;
  sameKeywordCount: string;
  url: string;
  blogId: string;
  logNo: string;
};

type RowResult = Target & {
  success: boolean;
  stage: string;
  message?: string;
  finalUrl?: string;
  publicUrl?: string;
  publicTitle?: string;
  publicHasPrivateText?: boolean;
  publicStillHasKeyword?: boolean;
};

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const closeEditorOverlays = async (page: import('playwright').Page): Promise<void> => {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(300);
  const closeCandidates = page.locator(
    'button:has-text("닫기"), button[aria-label*="닫"], button:has-text("Skip"), button:has-text("건너뛰기"), button:has-text("확인")'
  );
  for (let i = 0; i < await closeCandidates.count(); i += 1) {
    const candidate = closeCandidates.nth(i);
    if (await candidate.isVisible({ timeout: 100 }).catch(() => false)) {
      await candidate.click({ timeout: 800 }).catch(() => undefined);
      await page.waitForTimeout(200);
    }
  }
};

const openPublishPanel = async (page: import('playwright').Page): Promise<boolean> => {
  await closeEditorOverlays(page);
  const publishCandidates = page.locator('button:has-text("발행"), a:has-text("발행")');
  for (let i = (await publishCandidates.count()) - 1; i >= 0; i -= 1) {
    const candidate = publishCandidates.nth(i);
    if (await candidate.isVisible({ timeout: 300 }).catch(() => false)) {
      await candidate.click({ timeout: 5000, force: true });
      await page.waitForTimeout(800);
      return true;
    }
  }
  return false;
};

const disableKeepDefaultIfChecked = async (page: import('playwright').Page): Promise<void> => {
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const label = labels.find((item) => (item.textContent ?? '').includes('이 설정을 기본값으로 유지'));
    if (!label) return;
    const container = label.closest('div, li, span') ?? label.parentElement;
    const input =
      (container?.querySelector('input[type="checkbox"]') as HTMLInputElement | null) ??
      (label.previousElementSibling as HTMLInputElement | null) ??
      (label.nextElementSibling as HTMLInputElement | null);
    if (input?.type === 'checkbox' && input.checked) {
      label.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  });
};

const verifyPublicHidden = async (
  browser: Awaited<ReturnType<typeof getBrowser>>,
  target: Target
): Promise<{
  publicUrl: string;
  publicTitle: string;
  publicHasPrivateText: boolean;
  publicStillHasKeyword: boolean;
}> => {
  const publicContext = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  });
  const publicPage = await publicContext.newPage();
  await publicPage.goto(`https://blog.naver.com/${target.blogId}/${target.logNo}`, {
    waitUntil: 'domcontentloaded',
    timeout: 20_000,
  }).catch(() => undefined);
  await publicPage.waitForTimeout(1_000);
  const result = await publicPage.evaluate((keyword) => {
    const text = document.body?.innerText?.replace(/\s+/g, ' ').trim() ?? '';
    return {
      publicUrl: location.href,
      publicTitle: document.title,
      publicHasPrivateText: /비공개|권한|공개된 글이 아닙니다|존재하지 않는|삭제/.test(text),
      publicStillHasKeyword: keyword ? text.includes(keyword) : false,
    };
  }, target.keyword).catch(() => ({
    publicUrl: publicPage.url(),
    publicTitle: '',
    publicHasPrivateText: false,
    publicStillHasKeyword: false,
  }));
  await publicContext.close();
  return result;
};

const applyTarget = async (
  browser: Awaited<ReturnType<typeof getBrowser>>,
  page: import('playwright').Page,
  target: Target
): Promise<RowResult> => {
  try {
    await page.goto(`https://blog.naver.com/PostUpdateForm.naver?blogId=${target.blogId}&logNo=${target.logNo}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3_000);

    const opened = await openPublishPanel(page);
    if (!opened) {
      const verify = await verifyPublicHidden(browser, target);
      const alreadyHidden = verify.publicHasPrivateText || !verify.publicStillHasKeyword || !verify.publicUrl.includes(target.logNo);
      return {
        ...target,
        success: alreadyHidden,
        stage: alreadyHidden ? 'already_hidden_or_no_panel' : 'open_publish_panel',
        message: alreadyHidden ? '공개 페이지에서 원 키워드 미노출' : '발행 패널 버튼 없음',
        ...verify,
      };
    }

    const privateRadio = page.locator('input[name="open_type"][value="0"]').first();
    if (!(await privateRadio.isVisible({ timeout: 5000 }).catch(() => false))) {
      const verify = await verifyPublicHidden(browser, target);
      const alreadyHidden = verify.publicHasPrivateText || !verify.publicStillHasKeyword || !verify.publicUrl.includes(target.logNo);
      return {
        ...target,
        success: alreadyHidden,
        stage: alreadyHidden ? 'already_hidden_no_private_radio' : 'find_private_radio',
        message: alreadyHidden ? '공개 페이지에서 원 키워드 미노출' : '비공개 라디오 없음',
        ...verify,
      };
    }
    await privateRadio.check({ force: true });
    await page.waitForTimeout(200);
    await disableKeepDefaultIfChecked(page);
    await page.waitForTimeout(200);

    const confirmButtons = page.locator('button.confirm_btn__WEaBq, button:has-text("발행")');
    let clicked = false;
    for (let i = (await confirmButtons.count()) - 1; i >= 0; i -= 1) {
      const button = confirmButtons.nth(i);
      const text = ((await button.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      if (text.includes('발행') && await button.isVisible({ timeout: 300 }).catch(() => false)) {
        await button.click({ timeout: 5000, force: true });
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      return { ...target, success: false, stage: 'confirm', message: '최종 발행 버튼 없음' };
    }

    await page.waitForTimeout(4_000);
    const verify = await verifyPublicHidden(browser, target);
    const success =
      verify.publicHasPrivateText ||
      !verify.publicStillHasKeyword ||
      !verify.publicUrl.includes(target.logNo);

    return {
      ...target,
      success,
      stage: success ? 'done' : 'verify_public',
      message: success ? undefined : '공개 페이지에 키워드가 여전히 보임',
      finalUrl: page.url(),
      ...verify,
    };
  } catch (error) {
    return {
      ...target,
      success: false,
      stage: 'exception',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

const main = async (): Promise<void> => {
  const accountId = required('NAVER_ACCOUNT_ID');
  const password = required('NAVER_ACCOUNT_PW');
  const blogId = required('NAVER_BLOG_ID');
  const allTargets = JSON.parse(await readFile(required('TARGETS_JSON_PATH'), 'utf8')) as Target[];
  const targets = allTargets.filter((target) => target.blogId === blogId);
  const outDir = process.env.RESULT_DIR || path.resolve('work', 'codex-private-results');
  await import('fs/promises').then(({ mkdir }) => mkdir(outDir, { recursive: true }));

  const login = await naverLogin(accountId, password);
  if (!login.success) {
    const rows = targets.map((target) => ({
      ...target,
      success: false,
      stage: 'login',
      message: login.message,
    }));
    const outPath = path.join(outDir, `${blogId}.json`);
    await writeFile(outPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ blogId, success: 0, failed: rows.length, outPath, login: login.message }));
    process.exitCode = 1;
    return;
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies(login.cookies as Parameters<typeof context.addCookies>[0]);
  const page = await context.newPage();
  const results: RowResult[] = [];

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const result = await applyTarget(browser, page, target);
    results.push(result);
    console.log(JSON.stringify({
      blogId,
      index: i + 1,
      total: targets.length,
      rowNumber: target.rowNumber,
      logNo: target.logNo,
      success: result.success,
      stage: result.stage,
      message: result.message,
    }));
    await delay(1_500);
  }

  await context.close();
  const outPath = path.join(outDir, `${blogId}.json`);
  await writeFile(outPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  const success = results.filter((result) => result.success).length;
  const failed = results.length - success;
  console.log(JSON.stringify({ blogId, total: results.length, success, failed, outPath }));
  if (failed > 0) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser().catch(() => undefined);
    redis.disconnect();
  });
