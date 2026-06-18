import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { chromium, type Browser, type Page } from 'playwright';

const TARGET_DATE_ARG = process.argv.find((arg) => arg.startsWith('--date='))?.slice('--date='.length);
const TARGET_DATE = TARGET_DATE_ARG || (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
})();
const OUTPUT_PATH = path.join(process.cwd(), 'outputs', `alibaba-image-check-${TARGET_DATE}.json`);
const EXPECTED_PER_ACCOUNT = 3;
const MIN_BODY_IMAGES = Number(process.env.MIN_BODY_IMAGES ?? '1');

interface Account {
  accountId: string;
  blogId: string;
  nickname: string;
}

interface RssPost {
  logNo: string;
  title: string;
  link: string;
  pubDate: string;
}

interface ImageInfo {
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  complete: boolean;
}

interface PostCheck {
  accountId: string;
  blogId: string;
  nickname: string;
  logNo: string;
  title: string;
  url: string;
  pubDate: string;
  bodyImageCount: number;
  loadedImageCount: number;
  brokenImageCount: number;
  hasImage: boolean;
  ok: boolean;
  status: 'OK' | 'NO_IMAGE' | 'BROKEN_IMAGE' | 'CHECK_FAILED';
  images: ImageInfo[];
  error?: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const decodeXml = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const extractTag = (xml: string, tag: string): string => {
  const cdataMatch = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  if (cdataMatch) return cdataMatch[1].trim();
  const plainMatch = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return plainMatch ? decodeXml(plainMatch[1].trim()) : '';
};

const parseRssDate = (pubDate: string): string => {
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const getLogNoFromLink = (link: string): string => {
  const match = link.match(/[?&]logNo=(\d+)/) || link.match(/\/(\d{8,})(?:[?#]|$)/);
  return match?.[1] ?? '';
};

const loadAlibabaAccounts = async (): Promise<Account[]> => {
  const docs = await mongoose.connection
    .collection('blogaccounts')
    .find(
      {
        category: '알리바바',
        $or: [
          { isEnabled: { $exists: false } },
          { isEnabled: true },
        ],
      },
      { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1 } },
    )
    .sort({ nickname: 1, accountId: 1 })
    .toArray();

  return docs.flatMap((doc) => {
    const accountId = typeof doc.accountId === 'string' ? doc.accountId : '';
    if (!accountId) return [];
    const blogId = typeof doc.blogId === 'string' && doc.blogId ? doc.blogId : accountId;
    const nickname = typeof doc.nickname === 'string' && doc.nickname ? doc.nickname : accountId;
    return [{ accountId, blogId, nickname }];
  });
};

const fetchTodayRssPosts = async (blogId: string): Promise<RssPost[]> => {
  const response = await fetch(`https://rss.blog.naver.com/${encodeURIComponent(blogId)}.xml`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`RSS 조회 실패 status=${response.status}`);
  }

  const xml = await response.text();
  const posts: RssPost[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const pubDate = extractTag(match[1], 'pubDate');
    if (parseRssDate(pubDate) !== TARGET_DATE) continue;

    const link = extractTag(match[1], 'link');
    const logNo = getLogNoFromLink(link);
    posts.push({
      logNo,
      title: extractTag(match[1], 'title'),
      link,
      pubDate,
    });
  }

  return posts.sort((a, b) => Number(BigInt(b.logNo || '0') - BigInt(a.logNo || '0')));
};

const gotoPost = async (page: Page, blogId: string, logNo: string): Promise<void> => {
  const url = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(logNo)}&redirect=Dlog&widgetTypeCall=true&directAccess=false`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(2_000);
};

const collectImagesFromPage = async (page: Page): Promise<ImageInfo[]> => {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLImageElement>(
      [
        '#postViewArea img',
        '.se-main-container img',
        '.se_component_wrap img',
        '.se-image-resource',
        '.post-view img',
        '.post_ct img',
        '.se_doc_viewer img',
      ].join(', '),
    ));

    const seen = new Set<string>();
    return candidates.flatMap((image) => {
      const src = image.currentSrc || image.src || image.getAttribute('data-lazy-src') || '';
      if (!src || seen.has(src)) return [];
      seen.add(src);
      const rect = image.getBoundingClientRect();
      return [{
        src,
        alt: image.alt || '',
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        renderedWidth: Math.round(rect.width),
        renderedHeight: Math.round(rect.height),
        complete: image.complete,
      }];
    });
  });
};

const checkPost = async (
  page: Page,
  account: Account,
  post: RssPost,
): Promise<PostCheck> => {
  const url = `https://blog.naver.com/${account.blogId}/${post.logNo}`;
  try {
    await gotoPost(page, account.blogId, post.logNo);
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1200);
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1200);

    const images = await collectImagesFromPage(page);
    const loadedImages = images.filter((image) => (
      image.complete &&
      image.naturalWidth > 0 &&
      image.naturalHeight > 0
    ));
    const brokenImages = images.filter((image) => (
      !image.complete ||
      image.naturalWidth === 0 ||
      image.naturalHeight === 0
    ));
    const hasImage = loadedImages.length >= MIN_BODY_IMAGES;
    const ok = hasImage && brokenImages.length === 0;
    const status = ok ? 'OK' : hasImage ? 'BROKEN_IMAGE' : 'NO_IMAGE';

    return {
      accountId: account.accountId,
      blogId: account.blogId,
      nickname: account.nickname,
      logNo: post.logNo,
      title: post.title,
      url,
      pubDate: post.pubDate,
      bodyImageCount: images.length,
      loadedImageCount: loadedImages.length,
      brokenImageCount: brokenImages.length,
      hasImage,
      ok,
      status,
      images,
    };
  } catch (error) {
    return {
      accountId: account.accountId,
      blogId: account.blogId,
      nickname: account.nickname,
      logNo: post.logNo,
      title: post.title,
      url,
      pubDate: post.pubDate,
      bodyImageCount: 0,
      loadedImageCount: 0,
      brokenImageCount: 0,
      hasImage: false,
      ok: false,
      status: 'CHECK_FAILED',
      images: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI?.startsWith('mongodb+srv://')) {
    throw new Error('Atlas MONGO_URI가 필요함');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const accounts = await loadAlibabaAccounts();
  await mongoose.disconnect();

  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1400 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  });

  const checks: PostCheck[] = [];
  const accountSummaries = [];

  for (const account of accounts) {
    const posts = await fetchTodayRssPosts(account.blogId);
    for (const post of posts) {
      if (!post.logNo) {
        checks.push({
          accountId: account.accountId,
          blogId: account.blogId,
          nickname: account.nickname,
          logNo: '',
          title: post.title,
          url: post.link,
          pubDate: post.pubDate,
          bodyImageCount: 0,
          loadedImageCount: 0,
          brokenImageCount: 0,
          hasImage: false,
          ok: false,
          status: 'CHECK_FAILED',
          images: [],
          error: 'RSS link에서 logNo 추출 실패',
        });
        continue;
      }
      checks.push(await checkPost(page, account, post));
      await sleep(800);
    }

    const accountChecks = checks.filter((check) => check.accountId === account.accountId);
    accountSummaries.push({
      ...account,
      postCount: posts.length,
      expected: EXPECTED_PER_ACCOUNT,
      okCount: accountChecks.filter((check) => check.ok).length,
      problemCount: accountChecks.filter((check) => !check.ok).length,
      status: posts.length === EXPECTED_PER_ACCOUNT && accountChecks.every((check) => check.ok)
        ? 'OK'
        : 'CHECK',
    });
  }

  await browser.close();

  const result = {
    targetDate: TARGET_DATE,
    generatedAt: new Date().toISOString(),
    criteria: {
      expectedPerAccount: EXPECTED_PER_ACCOUNT,
      minBodyImages: MIN_BODY_IMAGES,
      imageSource: 'public Naver post body via Playwright',
    },
    totals: {
      accounts: accounts.length,
      posts: checks.length,
      ok: checks.filter((check) => check.ok).length,
      problems: checks.filter((check) => !check.ok).length,
      missingImages: checks.filter((check) => check.status === 'NO_IMAGE').length,
      brokenImages: checks.filter((check) => check.status === 'BROKEN_IMAGE').length,
      checkFailed: checks.filter((check) => check.status === 'CHECK_FAILED').length,
    },
    accounts: accountSummaries,
    problems: checks.filter((check) => !check.ok),
    posts: checks,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({
    outputPath: OUTPUT_PATH,
    targetDate: TARGET_DATE,
    totals: result.totals,
    accounts: accountSummaries,
    problems: result.problems.map((problem) => ({
      accountId: problem.accountId,
      logNo: problem.logNo,
      status: problem.status,
      title: problem.title,
      error: problem.error,
    })),
  }, null, 2));
};

main().catch(async (error) => {
  await mongoose.disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
