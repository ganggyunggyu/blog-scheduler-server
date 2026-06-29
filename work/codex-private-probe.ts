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
  });
  await context.addCookies(login.cookies as Parameters<typeof context.addCookies>[0]);

  const page = await context.newPage();
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/Post|admin|blog|api|open|private|update|save|write/i.test(url)) {
      requests.push(url);
    }
  });

  const targets: Array<[string, string]> = [
    ['updateForm', `https://blog.naver.com/PostUpdateForm.naver?blogId=${blogId}&logNo=${logNo}`],
    ['post', `https://blog.naver.com/${blogId}/${logNo}`],
    ['adminMain', `https://admin.blog.naver.com/AdminMain.naver?blogId=${blogId}`],
    ['adminBlog', `https://admin.blog.naver.com/${blogId}`],
  ];

  const pages = [];
  for (const [label, url] of targets) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2_000);
      const info = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const text = document.body?.innerText?.slice(0, 3000) ?? '';
        const forms = Array.from(document.querySelectorAll('form')).slice(0, 20).map((form) => ({
          action: form.getAttribute('action') ?? '',
          method: form.getAttribute('method') ?? '',
          inputs: Array.from(form.querySelectorAll('input, textarea, select')).slice(0, 160).map((el) => {
            const element = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
            return {
              tag: element.tagName,
              name: element.getAttribute('name') ?? '',
              id: element.getAttribute('id') ?? '',
              type: (element as HTMLInputElement).type ?? '',
              value: String(element.value ?? '').slice(0, 120),
            };
          }).filter((input) => input.name || input.id),
        }));
        return {
          url: location.href,
          title: document.title,
          text,
          hasPrivate: text.includes('비공개'),
          hasPublic: text.includes('공개'),
          htmlMarks: ['openType', 'postVisibility', 'secret', 'isOpen', 'PostUpdate', 'Update', 'publication'].filter((word) =>
            html.includes(word)
          ),
          forms,
        };
      });
      pages.push({ label, ...info });
    } catch (error) {
      pages.push({
        label,
        url: page.url(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result = {
    success: true,
    accountId,
    blogId,
    logNo,
    pages,
    requests: Array.from(new Set(requests)).slice(0, 300),
  };
  const outPath = path.resolve('work', `codex-private-probe-${blogId}-${logNo}.json`);
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    success: true,
    outPath,
    pageSummary: pages.map((page) => ({
      label: page.label,
      url: 'url' in page ? page.url : '',
      title: 'title' in page ? page.title : '',
      hasPrivate: 'hasPrivate' in page ? page.hasPrivate : false,
      hasPublic: 'hasPublic' in page ? page.hasPublic : false,
      formCount: 'forms' in page ? page.forms.length : 0,
      marks: 'htmlMarks' in page ? page.htmlMarks : [],
      error: 'error' in page ? page.error : undefined,
    })),
    requestCount: result.requests.length,
  }));
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
