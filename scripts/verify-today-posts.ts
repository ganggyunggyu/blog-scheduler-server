import 'dotenv/config';
import mongoose from 'mongoose';
import { chromium } from 'playwright';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TODAY = new Date();
const TODAY_STR = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`;
const TODAY_COMPACT = TODAY_STR.replace(/-/g, '');

interface Account {
  accountId: string;
  nickname: string;
  blogId: string;
  category: string;
}

interface PostItem {
  title: string;
  date: string;
  blogCategory: string;
}

interface VerifyResult {
  account: Account;
  expected: number;
  actual: number;
  posts: PostItem[];
  status: 'OK' | 'UNDER' | 'OVER' | 'ERROR';
  error?: string;
}

const EYE_CATEGORIES = ['안과', '에스앤비안과', '에스앤비안과-백업'];

const getExpectedCount = (category: string): number =>
  EYE_CATEGORIES.includes(category) ? 3 : 2;

const parseRssDate = (pubDate: string): string => {
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const extractTag = (xml: string, tag: string): string => {
  const cdataMatch = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  if (cdataMatch) return cdataMatch[1].trim();
  const plainMatch = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return plainMatch ? plainMatch[1].trim() : '';
};

const checkViaRss = async (blogId: string): Promise<PostItem[] | null> => {
  try {
    const res = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    if (!xml.includes('<item>')) return null;

    const posts: PostItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const title = extractTag(item, 'title');
      const pubDate = extractTag(item, 'pubDate');
      const category = extractTag(item, 'category');
      const dateStr = parseRssDate(pubDate);

      if (dateStr === TODAY_STR) {
        posts.push({ title, date: dateStr, blogCategory: category });
      }
    }

    return posts;
  } catch {
    return null;
  }
};

const checkViaPlaywright = async (
  blogId: string,
  page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>,
): Promise<PostItem[]> => {
  await page.goto(
    `https://blog.naver.com/PostList.naver?blogId=${blogId}&from=postList&categoryNo=0&viewDate=${TODAY_COMPACT}`,
    { waitUntil: 'domcontentloaded', timeout: 30000 },
  );
  await sleep(3000);

  const mainFrame = page.frames().find((f) => f.name() === 'mainFrame');
  if (!mainFrame) return [];

  await mainFrame.waitForSelector('.blog2_series, .wrap_list, .post-it, table', { timeout: 10000 }).catch(() => {});
  await sleep(1000);

  const posts = await mainFrame.evaluate(() => {
    const items: { title: string; date: string; blogCategory: string }[] = [];

    const rows = document.querySelectorAll('table.blog2_series tr, .wrap_list .item, .post-it');
    for (const row of rows) {
      const titleEl = row.querySelector('a.pcol2, a[class*="link"], .tit a, .title a');
      const dateEl = row.querySelector('.date, .post_date, span[class*="date"]');
      const catEl = row.querySelector('.category, .cate, a[class*="category"]');

      if (titleEl?.textContent?.trim()) {
        items.push({
          title: titleEl.textContent.trim(),
          date: dateEl?.textContent?.trim() || '',
          blogCategory: catEl?.textContent?.trim() || '',
        });
      }
    }

    if (items.length === 0) {
      const allLinks = document.querySelectorAll('a[href*="logNo="]');
      const seen = new Set<string>();
      for (const link of allLinks) {
        const text = link.textContent?.trim() || '';
        const href = link.getAttribute('href') || '';
        if (text.length > 3 && !seen.has(text)) {
          seen.add(text);
          items.push({ title: text, date: '', blogCategory: '' });
        }
      }
    }

    return items;
  });

  return posts;
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const db = mongoose.connection.useDb('cafe-bot');
  const col = db.collection('accounts');

  const docs = await col
    .find({
      isActive: { $ne: false },
      category: { $exists: true, $ne: '', $ne: null },
    })
    .toArray();

  const accounts: Account[] = docs.map((d) => ({
    accountId: d.accountId as string,
    nickname: (d.nickname as string) || (d.accountId as string),
    blogId: (d.blogId as string) || (d.accountId as string),
    category: (d.category as string) || '-',
  }));

  console.log(`=== 오늘(${TODAY_STR}) 발행글 검증 ===`);
  console.log(`대상: ${accounts.length}개 계정\n`);

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>> | null = null;

  const ensureBrowser = async () => {
    if (!browser) {
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();
    }
    return page!;
  };

  const results: VerifyResult[] = [];

  for (const acc of accounts) {
    const expected = getExpectedCount(acc.category);

    try {
      let posts = await checkViaRss(acc.blogId);

      if (posts === null) {
        const pw = await ensureBrowser();
        posts = await checkViaPlaywright(acc.blogId, pw);
      }

      const status = posts.length === expected ? 'OK' : posts.length < expected ? 'UNDER' : 'OVER';
      results.push({ account: acc, expected, actual: posts.length, posts, status });

      const icon = status === 'OK' ? '✓' : status === 'UNDER' ? '✗' : '⚠';
      const postInfo = posts.map((p) => `"${p.title}"${p.blogCategory ? ` [${p.blogCategory}]` : ''}`).join(', ');
      console.log(`  [${icon}] ${acc.nickname} (${acc.blogId}) [${acc.category}]: ${posts.length}/${expected} ${postInfo}`);

      await sleep(300);
    } catch (err) {
      results.push({
        account: acc,
        expected,
        actual: 0,
        posts: [],
        status: 'ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
      console.log(`  [!] ${acc.nickname} (${acc.blogId}): ERROR - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const ok = results.filter((r) => r.status === 'OK').length;
  const under = results.filter((r) => r.status === 'UNDER').length;
  const over = results.filter((r) => r.status === 'OVER').length;
  const errCount = results.filter((r) => r.status === 'ERROR').length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`결과: OK=${ok} / 미달=${under} / 초과=${over} / 에러=${errCount} / 전체=${results.length}`);

  const problems = results.filter((r) => r.status === 'UNDER' || r.status === 'ERROR');
  if (problems.length > 0) {
    console.log('\n문제 계정:');
    for (const r of problems) {
      console.log(`  ${r.account.nickname} (${r.account.blogId}) [${r.account.category}]: ${r.actual}/${r.expected} ${r.error || ''}`);
    }
  }

  console.log('='.repeat(60));

  if (browser) await browser.close();
  await mongoose.disconnect();
  process.exit(problems.length > 0 ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
