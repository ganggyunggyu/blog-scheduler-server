import 'dotenv/config';
import type { Page } from 'playwright';
import { getSession } from '../src/services/session.service.js';
import { createSession } from '../src/lib/naver-editor/browser.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';

/**
 * 키워드로 최근 글을 찾아 삭제함.
 *
 * 캐시된 세션이 있는 계정만 처리하고, 세션이 없으면 건너뜀.
 * 여기서 새로 로그인하지 않음(로그인 흐름은 캡차 자동 처리를 포함하므로 이 스크립트에서는 밟지 않음).
 */

const extractRecentPosts = async (
  blogId: string,
): Promise<Array<{ logNo: string; title: string }>> => {
  const response = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  });
  const xml = await response.text();

  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap((item) => {
    const body = item[1];
    const link = body.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/)?.[1] ?? '';
    const title = body.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? '';
    const logNo = link.match(/\/(\d{10,})/)?.[1];
    return logNo ? [{ logNo, title }] : [];
  });
};

const deletePost = async (page: Page, blogId: string, logNo: string): Promise<string> => {
  await page.goto(`https://blog.naver.com/${blogId}/${logNo}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const frame = page.frames().find((candidate) => candidate.name() === 'mainFrame') ?? page.mainFrame();

  page.once('dialog', (dialog) => {
    dialog.accept().catch(() => undefined);
  });

  const result = await frame.evaluate(() => {
    const button = document.querySelector('a.btn_del._deletePost, a._deletePost') as HTMLElement | null;
    if (!button) return 'no-delete-button';
    button.click();
    return 'clicked';
  });
  if (result !== 'clicked') return result;

  await page.waitForTimeout(2000);
  const confirmed = await frame
    .evaluate(() => {
      const confirm = document.querySelector('a._confirm, .btn_ok, ._returnFalse._confirm') as HTMLElement | null;
      if (!confirm) return false;
      confirm.click();
      return true;
    })
    .catch(() => false);

  await page.waitForTimeout(3000);
  return confirmed ? 'deleted' : 'clicked-no-confirm';
};

const main = async (): Promise<void> => {
  const accountId = process.argv[2];
  const keywords = process.argv.slice(3);
  if (!accountId || keywords.length === 0) {
    throw new Error('사용법: tsx scripts/_delete-posts-by-keyword.ts <계정ID> <키워드...>');
  }

  const cookies = await getSession(accountId);
  if (!cookies) {
    console.log(`${accountId}: 캐시된 세션 없음 - 건너뜀`);
    return;
  }

  const posts = await extractRecentPosts(accountId);
  const targets = posts.filter((post) => keywords.some((keyword) => post.title.includes(keyword)));

  console.log(`${accountId}: 공개글 ${posts.length}건 중 삭제 대상 ${targets.length}건`);
  targets.forEach((post) => console.log(`  - ${post.logNo} ${post.title.slice(0, 50)}`));

  if (targets.length === 0) {
    return;
  }

  const session = await createSession(cookies, accountId);
  for (const post of targets) {
    const outcome = await deletePost(session.page, accountId, post.logNo);
    console.log(`  ${outcome === 'deleted' ? '삭제 완료' : outcome} : ${post.logNo}`);
  }

  await session.context.close();
  await closeBrowser();
};

main().catch(async (error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  await closeBrowser().catch(() => undefined);
  process.exit(1);
});
