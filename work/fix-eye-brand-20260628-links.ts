import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { redis } from '../src/config/redis.js';
import { updatePost } from '../src/services/naver-blog.service.js';
import { getValidCookies, naverLogin } from '../src/services/naver-auth.service.js';
import { getSession } from '../src/services/session.service.js';

interface ManifestItem {
  logNo: string;
  keyword: string;
  title: string;
  slides: string[];
}

interface FinalFixSummary {
  item: {
    keyword: string;
    title: string;
    manuscriptPath: string;
    slides: string[];
  };
}

interface RepairItem extends ManifestItem {
  content: string;
  source: 'generated-repair' | 'final-package';
}

const ACCOUNT_ID = 'adplan3th';
const BLOG_ID = 'adplan3th';
const BLOG_CATEGORY = '에스앤비 안과';
const TOP_LINK = 'https://blog.naver.com/adplan3th/224094493829';
const BOTTOM_LINK = 'https://snbeye.com/sb-review/';
const MANIFEST_PATH = path.resolve('work/eye-brand-repair-20260628/manifest.json');
const FINAL_FIX_PATH = path.resolve('outputs/eye-brand-single-fix-224329240988/verify.json');
const OUTPUT_DIR = path.resolve('outputs/eye-brand-repair-20260628');
const VERIFY_PATH = path.join(OUTPUT_DIR, 'link-fix-verify.json');
const EXECUTE = process.argv.includes('--execute');
const ONLY_LOG_NOS = new Set(
  (process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length) ?? '')
    .split(',')
    .map((logNo) => logNo.trim())
    .filter(Boolean),
);

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const decodeHtml = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const buildGeneratedContent = (keyword: string, title: string): string => {
  const introLine = keyword.includes('백내장') || keyword.includes('노안')
    ? '정밀검사로 수정체와 망막 상태를 먼저 확인하는'
    : '정밀검사로 각막과 시력 조건을 먼저 확인하는';

  return `${title}

안녕하십니까, 시력교정술 국내 도입 1세대
압구정 에스앤비안과입니다.

${TOP_LINK}

${keyword}을 알아볼 때는 한 가지 장비명이나
가격만으로 판단하기 어렵습니다.

같은 증상처럼 보여도 각막 두께, 난시 방향,
눈물막 상태, 생활 패턴에 따라 필요한 설명이
달라질 수 있기 때문입니다.

오늘은 ${keyword} 상담 전 어떤 기준을 확인해야
하는지 브랜드 블로그 형식으로 정리해 드리겠습니다.

${introLine} 압구정 에스앤비안과 기준으로 정리했습니다.

1. ${keyword}에서 먼저 봐야 할 기준

[IMG] ${keyword} 상담 전 체크
가장 먼저 확인할 것은 현재 눈 상태입니다.

시력 수치만으로는 충분하지 않고 각막, 수정체,
망막, 눈물막 상태를 함께 살펴야 합니다.

검사 결과가 맞지 않으면 수술을 서두르기보다
보류하거나 다른 방법을 비교하는 과정이 필요합니다.

2. 정밀검사가 필요한 이유

[IMG] 정밀검사로 확인하는 항목
정밀검사는 단순히 가능 여부를 보는 절차가 아닙니다.

내 눈이 어떤 방식에 적합한지, 회복 과정에서
주의해야 할 부분이 무엇인지 확인하는 과정입니다.

특히 야간 빛 번짐, 건조감, 난시, 직업상 필요한
시야 조건은 상담 단계에서 함께 봐야 합니다.

3. 방법을 나누는 흐름

[IMG] 수술 방법을 나누는 기준
레이저 교정, 렌즈삽입술, 백내장 관련 수술처럼
방향이 나뉘는 경우에는 기준이 분명해야 합니다.

각막을 얼마나 보존할 수 있는지, 회복 기간은
얼마나 필요한지, 사후 관리는 어떻게 이어지는지
함께 확인해야 합니다.

4. 비용보다 중요한 구성

[IMG] 비용과 함께 볼 항목
비용은 병원마다 다르게 보일 수 있습니다.

하지만 검사 항목, 장비, 의료진 상담, 수술 후
검진 범위가 어디까지 포함되는지에 따라 실제
구성은 달라집니다.

가격만 따로 비교하기보다 전체 진료 흐름을
같이 확인하는 편이 안전합니다.

5. 상담 전 준비하면 좋은 질문

[IMG] 상담 전 질문 리스트
평소 렌즈 사용 시간, 불편한 시간대, 운전 여부,
모니터 사용량, 회복에 쓸 수 있는 날짜를 정리하면
상담이 더 구체적으로 진행됩니다.

압구정 에스앤비안과는 검사 결과를 바탕으로
가능한 방법과 보류해야 할 조건을 구분해 안내합니다.

${BOTTOM_LINK}

${keyword}을 고민 중이라면 먼저 정밀검사로
내 눈에 맞는 기준을 확인해 보시기 바랍니다.`;
};

const loadItems = async (): Promise<RepairItem[]> => {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as { items?: ManifestItem[] };
  const items = manifest.items ?? [];
  const finalFix = JSON.parse(await fs.readFile(FINAL_FIX_PATH, 'utf8')) as FinalFixSummary;
  const finalContent = await fs.readFile(finalFix.item.manuscriptPath, 'utf8');

  return items.map((item) => {
    if (item.logNo === '224329240988') {
      return {
        logNo: item.logNo,
        keyword: finalFix.item.keyword,
        title: finalFix.item.title,
        slides: finalFix.item.slides,
        content: finalContent,
        source: 'final-package',
      };
    }

    return {
      ...item,
      content: buildGeneratedContent(item.keyword, item.title),
      source: 'generated-repair',
    };
  }).filter((item) => ONLY_LOG_NOS.size === 0 || ONLY_LOG_NOS.has(item.logNo));
};

const getCookies = async (): Promise<unknown[]> => {
  const cached = await getSession(ACCOUNT_ID);
  if (cached) {
    return cached;
  }

  const password = process.env.NAVER_BRAND_PASSWORD;
  if (!password) {
    throw new Error('NAVER_BRAND_PASSWORD 없음');
  }

  const validated = await getValidCookies(ACCOUNT_ID, password);
  if (validated.cookies.length > 0) {
    return validated.cookies;
  }

  const login = await naverLogin(ACCOUNT_ID, password);
  if (!login.success) {
    throw new Error(login.message);
  }

  return login.cookies;
};

const verifyPublicPost = async (item: RepairItem): Promise<Record<string, unknown>> => {
  await sleep(3000);
  const response = await fetch(
    `https://blog.naver.com/PostView.naver?blogId=${BLOG_ID}&logNo=${item.logNo}&redirect=Dlog&widgetTypeCall=true&directAccess=false&_=${Date.now()}`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Cache-Control': 'no-cache',
        Referer: `https://blog.naver.com/${BLOG_ID}`,
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  const html = await response.text();
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
  const uniqueSlides = [...new Set(
    Array.from(html.matchAll(/slide_\d{2}\.png/giu))
      .map((match) => match[0].toLowerCase()),
  )].sort();
  const topLinkOk = html.includes(TOP_LINK) || text.includes(TOP_LINK);
  const bottomLinkOk = html.includes(BOTTOM_LINK) || text.includes(BOTTOM_LINK);

  return {
    logNo: item.logNo,
    url: `https://blog.naver.com/${BLOG_ID}/${item.logNo}`,
    source: item.source,
    httpStatus: response.status,
    expectedTitle: item.title,
    title,
    titleOk: title.includes(item.title),
    keywordOk: text.includes(item.keyword),
    brandOk: /에스앤비안과|S&B안과|SHINE&BRIGHT/iu.test(text),
    topLinkOk,
    bottomLinkOk,
    linkOk: topLinkOk && bottomLinkOk,
    uniqueSlides,
    hasAllSixSlides: ['slide_01.png', 'slide_02.png', 'slide_03.png', 'slide_04.png', 'slide_05.png', 'slide_06.png']
      .every((slide) => uniqueSlides.includes(slide)),
  };
};

const applyFixes = async (items: RepairItem[]): Promise<Array<Record<string, unknown>>> => {
  const cookies = await getCookies();
  const results: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const result = await updatePost({
      cookies,
      blogId: BLOG_ID,
      logNo: item.logNo,
      title: item.title,
      content: item.content,
      images: [],
      multiImages: { slide: item.slides },
      category: BLOG_CATEGORY,
      keywordCategory: '안과브랜드',
      manuscriptType: 'default',
    });
    results.push({
      logNo: item.logNo,
      keyword: item.keyword,
      title: item.title,
      source: item.source,
      success: result.success,
      postUrl: result.postUrl,
      message: result.message,
    });
    if (!result.success) {
      break;
    }
  }
  return results;
};

const main = async (): Promise<void> => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const items = await loadItems();
  const results = EXECUTE ? await applyFixes(items) : [];
  const successfulLogNos = new Set(results
    .filter((result) => result.success === true)
    .map((result) => String(result.logNo)));
  const verifyItems = EXECUTE
    ? items.filter((item) => successfulLogNos.has(item.logNo))
    : items;
  const verify = EXECUTE
    ? await Promise.all(verifyItems.map(verifyPublicPost))
    : [];

  await fs.writeFile(VERIFY_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    execute: EXECUTE,
    targetCount: items.length,
    items: items.map((item) => ({
      logNo: item.logNo,
      keyword: item.keyword,
      title: item.title,
      source: item.source,
      slides: item.slides,
    })),
    results,
    verify,
  }, null, 2), 'utf8');

  console.log(JSON.stringify({ execute: EXECUTE, targetCount: items.length, results, verify, verifyPath: VERIFY_PATH }, null, 2));

  if (EXECUTE && results.some((result) => result.success !== true)) {
    throw new Error('28일 브랜드 링크 보정 실패 항목 존재');
  }
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.quit().catch(() => undefined);
  });
