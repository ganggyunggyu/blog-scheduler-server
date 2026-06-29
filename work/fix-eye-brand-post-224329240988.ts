import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import { updatePost } from '../src/services/naver-blog.service.js';
import { naverLogin } from '../src/services/naver-auth.service.js';
import { getSession, saveSession } from '../src/services/session.service.js';

interface FinalPackageItem {
  keyword: string;
  title: string;
  manuscriptPath: string;
  slides: string[];
}

const ACCOUNT_ID = 'adplan3th';
const BLOG_ID = 'adplan3th';
const LOG_NO = '224329240988';
const TARGET_KEYWORD = '스마일라식수술비용';
const FINAL_ROOT = '/Users/ganggyunggyu/Downloads/2_브랜드블로그_최종';
const OUTPUT_DIR = path.resolve('outputs/eye-brand-single-fix-224329240988');

const findFinalPackageItem = async (): Promise<FinalPackageItem> => {
  const monthEntries = await fs.readdir(FINAL_ROOT, { withFileTypes: true });
  for (const monthEntry of monthEntries) {
    if (!monthEntry.isDirectory() || !/^\d+월$/u.test(monthEntry.name.normalize('NFC'))) {
      continue;
    }
    const monthPath = path.join(FINAL_ROOT, monthEntry.name);
    const postEntries = await fs.readdir(monthPath, { withFileTypes: true });
    for (const postEntry of postEntries) {
      if (!postEntry.isDirectory()) {
        continue;
      }
      const postName = postEntry.name.normalize('NFC');
      const keyword = postName.replace(/^\d+\./u, '').trim();
      if (keyword !== TARGET_KEYWORD) {
        continue;
      }

      const postPath = path.join(monthPath, postEntry.name);
      const entries = await fs.readdir(postPath, { withFileTypes: true });
      const manuscript = entries.find((entry) =>
        entry.isFile()
        && entry.name.normalize('NFC').startsWith('[모바일발행]')
        && entry.name.endsWith('.txt'));
      const slideDir = entries.find((entry) =>
        entry.isDirectory()
        && entry.name.normalize('NFC').endsWith('_slides'));
      if (!manuscript || !slideDir) {
        throw new Error(`최종 패키지 파일 누락: ${postPath}`);
      }

      const manuscriptPath = path.join(postPath, manuscript.name);
      const content = await fs.readFile(manuscriptPath, 'utf8');
      const title = content.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
      if (!title) {
        throw new Error(`원고 제목 없음: ${manuscriptPath}`);
      }

      const slideRoot = path.join(postPath, slideDir.name);
      const slides = (await fs.readdir(slideRoot))
        .filter((name) => /^slide_\d{2}\.png$/u.test(name.normalize('NFC')))
        .sort((left, right) => left.normalize('NFC').localeCompare(right.normalize('NFC')))
        .map((name) => path.join(slideRoot, name));
      if (slides.length !== 6) {
        throw new Error(`슬라이드 6장 필요: ${slideRoot}`);
      }

      return {
        keyword,
        title,
        manuscriptPath,
        slides,
      };
    }
  }

  throw new Error(`최종 패키지 항목 없음: ${TARGET_KEYWORD}`);
};

const getCookies = async (): Promise<unknown[]> => {
  const password = process.env.NAVER_BRAND_PASSWORD;
  if (!password) {
    const cached = await getSession(ACCOUNT_ID);
    if (cached) {
      return cached;
    }
    throw new Error('NAVER_BRAND_PASSWORD 없음');
  }

  const login = await naverLogin(ACCOUNT_ID, password);
  if (!login.success) {
    throw new Error(login.message);
  }
  await saveSession(ACCOUNT_ID, login.cookies);
  return login.cookies;
};

const removeStandaloneUrls = (content: string): string =>
  content
    .split(/\r?\n/u)
    .filter((line) => !/^https?:\/\/\S+$/u.test(line.trim()))
    .join('\n');

const verifyPublicPost = async (item: FinalPackageItem): Promise<Record<string, unknown>> => {
  const url = `https://blog.naver.com/PostView.naver?blogId=${BLOG_ID}&logNo=${LOG_NO}&redirect=Dlog&widgetTypeCall=true&directAccess=false&_=${Date.now()}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cache-Control': 'no-cache',
      Referer: `https://blog.naver.com/${BLOG_ID}`,
    },
  });
  const html = await response.text();
  const decodeHtml = (value: string): string =>
    value
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  const title = decodeHtml(
    (html.match(/<meta property="og:title" content="([^"]*)"/u)?.[1]
      ?? html.match(/<title>(.*?)<\/title>/iu)?.[1]
      ?? '').trim(),
  );
  const text = decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/giu, ' ')
      .replace(/<style[\s\S]*?<\/style>/giu, ' ')
      .replace(/<[^>]+>/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  const imageUrlCount = new Set(
    Array.from(html.matchAll(/https:\/\/blog(?:thumb|files|imgs)[^"'\s<>]+\.(?:png|jpg|jpeg|PNG|JPG|JPEG)/gu))
      .map((match) => match[0]),
  ).size;

  return {
    logNo: LOG_NO,
    url: `https://blog.naver.com/${BLOG_ID}/${LOG_NO}`,
    expectedTitle: item.title,
    title,
    titleOk: title.includes(item.title),
    keywordOk: text.includes(item.keyword),
    brandOk: text.includes('에스앤비안과'),
    removedStandaloneUrls: !html.includes('224094493829') && !html.includes('snbeye.com/sb-review'),
    imageUrlCount,
  };
};

const main = async (): Promise<void> => {
  const item = await findFinalPackageItem();
  const content = removeStandaloneUrls(await fs.readFile(item.manuscriptPath, 'utf8'));
  const result = await updatePost({
    cookies: await getCookies(),
    blogId: BLOG_ID,
    logNo: LOG_NO,
    title: item.title,
    content,
    images: [],
    multiImages: { slide: item.slides },
    category: '에스앤비 안과',
    keywordCategory: '안과브랜드',
    manuscriptType: 'default',
  });

  if (!result.success) {
    throw new Error(result.message);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const verify = await verifyPublicPost(item);
  await fs.writeFile(path.join(OUTPUT_DIR, 'verify.json'), JSON.stringify({
    item: {
      keyword: item.keyword,
      title: item.title,
      manuscriptPath: item.manuscriptPath,
      slides: item.slides,
    },
    result,
    verify,
  }, null, 2), 'utf8');
  console.log(JSON.stringify({ result, verify }, null, 2));
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.quit().catch(() => undefined);
  });
