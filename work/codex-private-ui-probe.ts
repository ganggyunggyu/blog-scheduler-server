import { writeFile } from 'fs/promises';
import path from 'path';
import { naverLogin } from '../src/services/naver-auth.service.js';
import { getBrowser, closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const main = async (): Promise<void> => {
  const accountId = required('NAVER_ACCOUNT_ID');
  const password = required('NAVER_ACCOUNT_PW');
  const blogId = required('NAVER_BLOG_ID');
  const logNo = required('NAVER_LOG_NO');

  const login = await naverLogin(accountId, password);
  if (!login.success) {
    console.log(JSON.stringify({ success: false, stage: 'login', message: login.message }));
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
  const requests: Array<{ url: string; method: string; postData?: string }> = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/blog\.naver\.com\/(api|Post|Rabbit)|platform\.editor|publish|save|post/i.test(url)) {
      requests.push({
        url,
        method: request.method(),
        postData: request.postData()?.slice(0, 2000),
      });
    }
  });

  await page.goto(`https://blog.naver.com/PostUpdateForm.naver?blogId=${blogId}&logNo=${logNo}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForTimeout(4_000);

  const before = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: document.body?.innerText?.slice(0, 5000) ?? '',
    buttons: Array.from(document.querySelectorAll('button, a')).map((el) => ({
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      aria: el.getAttribute('aria-label') ?? '',
      role: el.getAttribute('role') ?? '',
      className: el.getAttribute('class') ?? '',
    })).filter((x) => x.text || x.aria).slice(0, 200),
  }));

  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(500);
  const closeCandidates = page.locator(
    'button:has-text("닫기"), button[aria-label*="닫"], button:has-text("Skip"), button:has-text("건너뛰기"), button:has-text("확인")'
  );
  for (let i = 0; i < await closeCandidates.count(); i += 1) {
    const candidate = closeCandidates.nth(i);
    if (await candidate.isVisible({ timeout: 200 }).catch(() => false)) {
      await candidate.click({ timeout: 1000 }).catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }

  const publishCandidates = page.locator('button:has-text("발행"), a:has-text("발행")');
  const count = await publishCandidates.count();
  let clicked = false;
  for (let i = count - 1; i >= 0; i -= 1) {
    const candidate = publishCandidates.nth(i);
    if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
      await candidate.click({ timeout: 5000, force: true });
      clicked = true;
      break;
    }
  }
  await page.waitForTimeout(2_000);

  const after = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: document.body?.innerText?.slice(0, 8000) ?? '',
    controls: Array.from(document.querySelectorAll('button, a, input, label, [role="button"], [role="radio"], [aria-label]')).map((el) => {
      const input = el as HTMLInputElement;
      return {
        tag: el.tagName,
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        aria: el.getAttribute('aria-label') ?? '',
        role: el.getAttribute('role') ?? '',
        type: input.type ?? '',
        name: input.name ?? '',
        value: input.value ?? '',
        checked: typeof input.checked === 'boolean' ? input.checked : undefined,
        className: el.getAttribute('class') ?? '',
      };
    }).filter((x) => x.text || x.aria || x.name || x.value).slice(0, 260),
  }));

  const out = { success: true, accountId, blogId, logNo, clicked, before, after, requests };
  const outPath = path.resolve('work', `codex-private-ui-probe-${blogId}-${logNo}.json`);
  await writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: path.resolve('work', `codex-private-ui-probe-${blogId}-${logNo}.png`), fullPage: true });
  console.log(JSON.stringify({
    success: true,
    clicked,
    outPath,
    bodyHasPrivate: after.text.includes('비공개'),
    bodyHasPublic: after.text.includes('공개'),
    controlTexts: after.controls.map((c) => c.text || c.aria || `${c.name}:${c.value}`).filter(Boolean).slice(0, 80),
    requestCount: requests.length,
  }, null, 2));
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
