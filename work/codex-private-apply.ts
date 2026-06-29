import { writeFile } from 'fs/promises';
import path from 'path';
import { naverLogin } from '../src/services/naver-auth.service.js';
import { getBrowser, closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

type ApplyResult = {
  success: boolean;
  accountId: string;
  blogId: string;
  logNo: string;
  stage?: string;
  message?: string;
  finalUrl?: string;
  publicCheck?: {
    url: string;
    title: string;
    hasPrivateText: boolean;
    hasOriginalTitle: boolean;
    textSample: string;
  };
  requests?: Array<{ method: string; url: string; postData?: string }>;
};

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const closeEditorOverlays = async (page: import('playwright').Page): Promise<void> => {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(400);
  const closeCandidates = page.locator(
    'button:has-text("닫기"), button[aria-label*="닫"], button:has-text("Skip"), button:has-text("건너뛰기"), button:has-text("확인")'
  );
  for (let i = 0; i < await closeCandidates.count(); i += 1) {
    const candidate = closeCandidates.nth(i);
    if (await candidate.isVisible({ timeout: 150 }).catch(() => false)) {
      await candidate.click({ timeout: 1000 }).catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }
};

const openPublishPanel = async (page: import('playwright').Page): Promise<boolean> => {
  await closeEditorOverlays(page);
  const publishCandidates = page.locator('button:has-text("발행"), a:has-text("발행")');
  for (let i = (await publishCandidates.count()) - 1; i >= 0; i -= 1) {
    const candidate = publishCandidates.nth(i);
    if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
      await candidate.click({ timeout: 5000, force: true });
      await page.waitForTimeout(1000);
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

const applyOne = async (): Promise<ApplyResult> => {
  const accountId = required('NAVER_ACCOUNT_ID');
  const password = required('NAVER_ACCOUNT_PW');
  const blogId = required('NAVER_BLOG_ID');
  const logNo = required('NAVER_LOG_NO');
  const originalTitle = process.env.NAVER_POST_TITLE ?? '';

  const login = await naverLogin(accountId, password);
  if (!login.success) {
    return { success: false, accountId, blogId, logNo, stage: 'login', message: login.message };
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies(login.cookies as Parameters<typeof context.addCookies>[0]);

  const page = await context.newPage();
  const requests: Array<{ method: string; url: string; postData?: string }> = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/blog\.naver\.com\/(api|Post|Rabbit)|platform\.editor|publish|save|post/i.test(url)) {
      requests.push({
        method: request.method(),
        url,
        postData: request.postData()?.slice(0, 2000),
      });
    }
  });

  await page.goto(`https://blog.naver.com/PostUpdateForm.naver?blogId=${blogId}&logNo=${logNo}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForTimeout(4_000);

  const opened = await openPublishPanel(page);
  if (!opened) {
    await context.close();
    return { success: false, accountId, blogId, logNo, stage: 'open_publish_panel', message: '발행 패널 버튼 없음', requests };
  }

  const privateRadio = page.locator('input[name="open_type"][value="0"]').first();
  if (!(await privateRadio.isVisible({ timeout: 5000 }).catch(() => false))) {
    await context.close();
    return { success: false, accountId, blogId, logNo, stage: 'find_private_radio', message: '비공개 라디오 없음', requests };
  }
  await privateRadio.check({ force: true });
  await page.waitForTimeout(300);
  await disableKeepDefaultIfChecked(page);
  await page.waitForTimeout(300);

  const confirmButtons = page.locator('button.confirm_btn__WEaBq, button:has-text("발행")');
  let clicked = false;
  for (let i = (await confirmButtons.count()) - 1; i >= 0; i -= 1) {
    const button = confirmButtons.nth(i);
    const text = ((await button.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
    if (text.includes('발행') && await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click({ timeout: 5000, force: true });
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    await context.close();
    return { success: false, accountId, blogId, logNo, stage: 'confirm', message: '최종 발행 버튼 없음', requests };
  }

  await page.waitForTimeout(5_000);
  const finalUrl = page.url();

  const publicContext = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  });
  const publicPage = await publicContext.newPage();
  await publicPage.goto(`https://blog.naver.com/${blogId}/${logNo}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  }).catch(() => undefined);
  await publicPage.waitForTimeout(1500);
  const publicCheck = await publicPage.evaluate((title) => {
    const text = document.body?.innerText?.replace(/\s+/g, ' ').trim() ?? '';
    return {
      url: location.href,
      title: document.title,
      hasPrivateText: /비공개|권한|공개된 글이 아닙니다|존재하지 않는/.test(text),
      hasOriginalTitle: title ? text.includes(title.slice(0, 20)) : false,
      textSample: text.slice(0, 300),
    };
  }, originalTitle).catch(() => ({
    url: publicPage.url(),
    title: '',
    hasPrivateText: false,
    hasOriginalTitle: false,
    textSample: '',
  }));

  await publicContext.close();
  await context.close();

  return {
    success: publicCheck.hasPrivateText || !publicCheck.hasOriginalTitle,
    accountId,
    blogId,
    logNo,
    stage: 'done',
    finalUrl,
    publicCheck,
    requests,
  };
};

const main = async (): Promise<void> => {
  const result = await applyOne();
  const outPath = path.resolve('work', `codex-private-apply-${result.blogId}-${result.logNo}.json`);
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    success: result.success,
    accountId: result.accountId,
    blogId: result.blogId,
    logNo: result.logNo,
    stage: result.stage,
    message: result.message,
    finalUrl: result.finalUrl,
    publicCheck: result.publicCheck,
    outPath,
  }, null, 2));
  if (!result.success) process.exitCode = 1;
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
