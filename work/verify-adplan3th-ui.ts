import { getValidCookies } from '../src/services/naver-auth.service.ts';
import { createSession, closeSession } from '../src/lib/naver-editor/browser.ts';

const ACCOUNT_ID = 'adplan3th';

const requiredPassword = (): string => {
  const password = process.env.NAVER_PASSWORD;
  if (!password) {
    throw new Error('NAVER_PASSWORD is required');
  }
  return password;
};

const extractBodyText = async (pageOrFrame: {
  locator: (selector: string) => { innerText: (options?: { timeout?: number }) => Promise<string> };
}): Promise<string> => {
  try {
    return await pageOrFrame.locator('body').innerText({ timeout: 2_000 });
  } catch {
    return '';
  }
};

const logSection = (label: string, value: string): void => {
  console.log(`\n=== ${label} ===`);
  console.log(value);
};

const probeUrl = async (
  page: Awaited<ReturnType<typeof createSession>>['page'],
  url: string
): Promise<void> => {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4_000);

  const frameSummaries = [];
  for (const frame of page.frames()) {
    const text = await extractBodyText(frame);
    frameSummaries.push({
      url: frame.url(),
      text: text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 40),
    });
  }

  logSection(`URL ${url}`, JSON.stringify(frameSummaries, null, 2));
}

const run = async (): Promise<void> => {
  const auth = await getValidCookies(ACCOUNT_ID, requiredPassword());
  console.log(`auth.fromCache=${auth.fromCache}`);

  const session = await createSession(auth.cookies, ACCOUNT_ID);

  try {
    await probeUrl(
      session.page,
      'https://blog.naver.com/PostList.naver?blogId=adplan3th&from=postList&categoryNo=0'
    );

    const adminCandidates = [
      'https://admin.blog.naver.com/adplan3th',
      'https://admin.blog.naver.com/adplan3th/post',
      'https://admin.blog.naver.com/adplan3th/posts',
      'https://admin.blog.naver.com/adplan3th/post/list',
      'https://admin.blog.naver.com/adplan3th/publish',
      'https://admin.blog.naver.com/adplan3th/reserve',
      'https://admin.blog.naver.com/adplan3th/reservation',
      'https://admin.blog.naver.com/adplan3th/post/reserve',
      'https://admin.blog.naver.com/adplan3th/post/publish',
      'https://admin.blog.naver.com/PostList.naver?blogId=adplan3th',
    ];

    for (const url of adminCandidates) {
      await probeUrl(session.page, url);
    }
  } finally {
    await closeSession(session);
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
