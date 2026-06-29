import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { redis } from '../src/config/redis.js';
import { updatePost } from '../src/services/naver-blog.service.js';
import { getValidCookies, naverLogin } from '../src/services/naver-auth.service.js';
import { getSession } from '../src/services/session.service.js';

type CsvRow = string[];

interface KeywordPools {
  preferred: string[];
  fallback: string[];
}

interface RepairTarget {
  logNo: string;
  oldTitle: string;
  publishedAt: string;
}

interface RepairItem extends RepairTarget {
  keyword: string;
  title: string;
  content: string;
  slides: string[];
}

const SHEET_ID = '1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c';
const EYE_SHEET_GID = '633450920';
const EYE_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${EYE_SHEET_GID}`;
const ACCOUNT_ID = 'adplan3th';
const BLOG_ID = 'adplan3th';
const BLOG_CATEGORY = '에스앤비 안과';
const BASE_LINK = 'https://blog.naver.com/adplan3th/224094493829';
const EXECUTE = process.argv.includes('--execute');
const OUT_DIR = path.resolve('work/eye-brand-repair-20260628');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');

const TARGETS: RepairTarget[] = [
  {
    logNo: '224329239137',
    oldTitle: '스마일프로가격 구성과 확인할 점',
    publishedAt: '2026-06-28 00:14',
  },
  {
    logNo: '224329240966',
    oldTitle: '자이스스마일프로 원리와 특징',
    publishedAt: '2026-06-28 00:17',
  },
  {
    logNo: '224329240988',
    oldTitle: '자이스스마일프로 원리와 특징',
    publishedAt: '2026-06-28 00:17',
  },
  {
    logNo: '224329746798',
    oldTitle: '스마일라식 원리와 부작용에 대해서',
    publishedAt: '2026-06-28 17:53',
  },
  {
    logNo: '224329743934',
    oldTitle: '라식라섹 차이점과 수술 전 꼭 확인해야 할 핵심 사항',
    publishedAt: '2026-06-28 18:00',
  },
  {
    logNo: '224329759628',
    oldTitle: '라식재수술 및 스마일라식 재교정 차이 방법 비교',
    publishedAt: '2026-06-28 relative-23h',
  },
];

const parseCsv = (text: string): CsvRow[] => {
  const rows: CsvRow[] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }
      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }
    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows;
};

const normalizeKeyword = (value: string): string =>
  value.replace(/\s+/g, '').toLowerCase();

const slugify = (value: string): string =>
  value.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');

const fetchKeywordPools = async (): Promise<KeywordPools> => {
  const response = await fetch(EYE_SHEET_CSV_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cache-Control': 'no-cache',
    },
  });
  if (!response.ok) {
    throw new Error(`안과 키워드 시트 조회 실패: ${response.status}`);
  }

  const rows = parseCsv(await response.text());
  const preferred: string[] = [];
  const fallback: string[] = [];
  const seen = new Set<string>();

  for (const [index, row] of rows.entries()) {
    if (index === 0) {
      continue;
    }
    const keyword = row[0]?.trim() ?? '';
    const exposed = row[3]?.trim() ?? '';
    const newLogic = row[6]?.trim().toLowerCase() ?? '';
    if (!keyword || keyword.startsWith('키워드 ')) {
      continue;
    }
    if (seen.has(keyword)) {
      continue;
    }
    seen.add(keyword);
    if (!exposed && newLogic === 'o') {
      preferred.push(keyword);
    } else {
      fallback.push(keyword);
    }
  }

  return { preferred, fallback };
};

const loadUsedBrandKeywords = async (): Promise<Set<string>> => {
  const rows = await mongoose.connection.db?.collection('schedulejobs')
    .aggregate([
      {
        $lookup: {
          from: 'schedules',
          localField: 'scheduleId',
          foreignField: '_id',
          as: 'schedule',
        },
      },
      { $unwind: '$schedule' },
      {
        $match: {
          'schedule.accountId': ACCOUNT_ID,
          status: { $ne: 'cancelled' },
        },
      },
      { $project: { keyword: 1 } },
    ])
    .toArray();

  return new Set((rows ?? []).map((row) => String(row.keyword ?? '')).filter(Boolean));
};

const extractPostListJson = (text: string): unknown[] => {
  const marker = '"postList":[';
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) {
    return [];
  }

  const start = text.indexOf('[', markerIndex);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, index + 1)) as unknown[];
      }
    }
  }

  return [];
};

const decodeNaverTitle = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  try {
    return decodeURIComponent(value.replace(/\+/g, ' ')).trim();
  } catch {
    return value.trim();
  }
};

const fetchRecentTitles = async (): Promise<string[]> => {
  const titles: string[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${BLOG_ID}&viewdate=&currentPage=${page}&categoryNo=0&parentCategoryNo=&countPerPage=5`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: `https://blog.naver.com/${BLOG_ID}`,
      },
    });
    if (!response.ok) {
      continue;
    }
    for (const rawPost of extractPostListJson(await response.text())) {
      if (!rawPost || typeof rawPost !== 'object') {
        continue;
      }
      const title = decodeNaverTitle((rawPost as { title?: unknown }).title);
      if (title) {
        titles.push(title);
      }
    }
  }
  return titles;
};

const selectKeywords = (
  pools: KeywordPools,
  usedKeywords: Set<string>,
  recentTitles: string[],
  count: number,
): string[] => {
  const recent = recentTitles.map(normalizeKeyword);
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const keyword of [...pools.preferred, ...pools.fallback]) {
    const normalized = normalizeKeyword(keyword);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    if (usedKeywords.has(keyword)) {
      continue;
    }
    if (recent.some((title) => title.includes(normalized) || normalized.includes(title))) {
      continue;
    }
    selected.push(keyword);
    if (selected.length === count) {
      break;
    }
  }

  if (selected.length < count) {
    throw new Error(`수정 키워드 부족: ${selected.length} < ${count}`);
  }
  return selected;
};

const titleFor = (keyword: string, index: number): string => {
  const endings = [
    '검사 전 확인할 기준',
    '선택 전 알아둘 내용',
    '상담 때 물어볼 핵심',
    '방법과 주의사항 정리',
    '비교할 때 보는 기준',
    '정밀검사가 필요한 이유',
  ];
  return `${keyword} ${endings[index % endings.length]}`;
};

const buildContent = (keyword: string, title: string): string => {
  const introLine = keyword.includes('백내장') || keyword.includes('노안')
    ? '정밀검사로 수정체와 망막 상태를 먼저 확인하는'
    : '정밀검사로 각막과 시력 조건을 먼저 확인하는';

  return `${title}

안녕하십니까, 시력교정술 국내 도입 1세대
압구정 에스앤비안과입니다.

${BASE_LINK}


${keyword}을 알아볼 때는 한 가지 장비명이나
가격만으로 판단하기 어렵습니다.

같은 증상처럼 보여도 각막 두께, 난시 방향,
눈물막 상태, 생활 패턴에 따라 필요한 설명이
달라질 수 있기 때문입니다.

오늘은 ${keyword} 상담 전 어떤 기준을 확인해야
하는지 브랜드 블로그 형식으로 정리해 드리겠습니다.

${introLine}
압구정 에스앤비안과 기준으로 정리했습니다.

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

${keyword}을 고민 중이라면 먼저 정밀검사로
내 눈에 맞는 기준을 확인해 보시기 바랍니다.`;
};

const writeSlideGenerator = async (items: Array<{ keyword: string; title: string; dir: string }>): Promise<void> => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const inputPath = path.join(OUT_DIR, 'slide-input.json');
  await fs.writeFile(inputPath, JSON.stringify({ items }, null, 2), 'utf8');
  const python = String.raw`
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 2160, 2700
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"

def font(size, index=0):
    return ImageFont.truetype(FONT, size=size, index=index)

def wrap_text(draw, text, ft, max_width):
    lines = []
    line = ""
    for ch in list(text):
        trial = line + ch
        if draw.textbbox((0, 0), trial, font=ft)[2] <= max_width:
            line = trial
        else:
            if line:
                lines.append(line)
            line = ch
    if line:
        lines.append(line)
    return lines

def draw_text_block(draw, xy, text, ft, fill, max_width, line_gap=20):
    x, y = xy
    for line in wrap_text(draw, text, ft, max_width):
        draw.text((x, y), line, font=ft, fill=fill)
        y += ft.size + line_gap
    return y

def make_gradient():
    small_w, small_h = 270, 338
    img = Image.new("RGB", (small_w, small_h), "#061225")
    px = img.load()
    for y in range(small_h):
        for x in range(small_w):
            t = (x / small_w * 0.28) + (y / small_h * 0.72)
            px[x, y] = (int(4 + 18 * t), int(15 + 42 * t), int(34 + 78 * t))
    return img.resize((W, H), Image.Resampling.BICUBIC)

def draw_background(draw, accent):
    line = (56, 90, 140)
    draw.polygon([(0, 420), (780, 0), (1740, 650), (1110, 1320)], outline=line)
    draw.line([(740, 0), (1740, 650), (1410, 1210), (2140, 1450)], fill=line, width=3)
    for x, y, r in [(780, 0, 17), (1740, 650, 17), (1410, 1210, 17), (760, 1940, 17)]:
        draw.ellipse((x-r, y-r, x+r, y+r), fill=(64, 97, 144))
    draw.ellipse((690, 1900, 1480, 2690), outline=(32, 80, 142), width=5)
    draw.line((1085, 1940, 1085, 2360), fill=(45, 96, 164), width=6)
    draw.line((1085, 2360, 1290, 2490), fill=(45, 96, 164), width=7)
    draw.ellipse((1065, 2340, 1105, 2380), fill=accent)

def draw_logo(draw):
    draw.text((1540, 150), "압구정", font=font(58), fill="#dbeafe")
    draw.text((1540, 225), "S&B안과", font=font(112), fill="#ffffff")
    draw.text((1545, 355), "SHINE&BRIGHT EYE CLINIC", font=font(38), fill="#c8d7ec")

def draw_slide(item, idx):
    accent = (88, 166, 255)
    img = BASE_GRADIENT.copy()
    draw = ImageDraw.Draw(img)
    draw_background(draw, accent)
    draw_logo(draw)

    keyword = item["keyword"]
    title = item["title"]
    labels = [
        ("EYE CARE", keyword, "상담 전 확인할 기준"),
        ("CHECK 01", "정밀검사", "눈 상태를 먼저 확인합니다"),
        ("CHECK 02", "적합 조건", "가능한 방법과 보류 조건을 나눕니다"),
        ("CHECK 03", "방법 선택", "수술명보다 검사 결과가 우선입니다"),
        ("CHECK 04", "비용 구성", "검사와 사후 관리 범위를 함께 봅니다"),
        ("CHECK 05", "상담 준비", "생활 패턴과 회복 일정을 정리합니다"),
    ]
    top, main, sub = labels[idx - 1]

    draw.text((140, 830), top, font=font(78), fill=accent)
    y = 990
    main_font = font(150 if len(main) <= 8 else 126)
    y = draw_text_block(draw, (140, y), main, main_font, "#ffffff", 1420, 26)
    y += 55
    draw_text_block(draw, (145, y), sub, font(72), "#62a8ff", 1320, 18)

    draw.text((140, 1540), title if idx == 1 else keyword, font=font(86), fill="#dbeafe")
    draw.rounded_rectangle((140, 2460, 590, 2585), radius=10, fill="#2f6eea")
    draw.text((205, 2492), "EYE CARE", font=font(56), fill="#ffffff")
    return img

with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)

BASE_GRADIENT = make_gradient()

for item in data["items"]:
    os.makedirs(item["dir"], exist_ok=True)
    for idx in range(1, 7):
        img = draw_slide(item, idx)
        img.save(os.path.join(item["dir"], f"slide_{idx:02d}.png"), quality=95)
`;

  const result = spawnSync('python3', ['-c', python, inputPath], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`슬라이드 생성 실패: exit=${result.status}`);
  }
};

const buildRepairItems = async (keywords: string[]): Promise<RepairItem[]> => {
  const slideInputs: Array<{ keyword: string; title: string; dir: string }> = [];
  const items = TARGETS.map((target, index) => {
    const keyword = keywords[index];
    const title = titleFor(keyword, index);
    const itemDir = path.join(OUT_DIR, 'slides', `${String(index + 1).padStart(2, '0')}_${slugify(keyword)}`);
    const slides = Array.from({ length: 6 }, (_, slideIndex) =>
      path.join(itemDir, `slide_${String(slideIndex + 1).padStart(2, '0')}.png`));
    slideInputs.push({ keyword, title, dir: itemDir });
    return {
      ...target,
      keyword,
      title,
      content: buildContent(keyword, title),
      slides,
    };
  });

  await writeSlideGenerator(slideInputs);
  await fs.writeFile(MANIFEST_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    accountId: ACCOUNT_ID,
    blogId: BLOG_ID,
    service: 'eye-brand-repair-20260628',
    items: items.map((item) => ({
      logNo: item.logNo,
      oldTitle: item.oldTitle,
      publishedAt: item.publishedAt,
      keyword: item.keyword,
      title: item.title,
      slides: item.slides,
    })),
  }, null, 2), 'utf8');

  return items;
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

const applyRepairs = async (items: RepairItem[]): Promise<Array<{ logNo: string; keyword: string; title: string; success: boolean; postUrl?: string; message?: string }>> => {
  const cookies = await getCookies();
  const results = [];

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
  await mongoose.connect(env.MONGO_URI);
  try {
    const [pools, usedKeywords, recentTitles] = await Promise.all([
      fetchKeywordPools(),
      loadUsedBrandKeywords(),
      fetchRecentTitles(),
    ]);
    const keywords = selectKeywords(pools, usedKeywords, recentTitles, TARGETS.length);
    const items = await buildRepairItems(keywords);
    const results = EXECUTE ? await applyRepairs(items) : [];

    console.log(JSON.stringify({
      execute: EXECUTE,
      manifestPath: MANIFEST_PATH,
      targets: items.map((item) => ({
        logNo: item.logNo,
        oldTitle: item.oldTitle,
        publishedAt: item.publishedAt,
        keyword: item.keyword,
        title: item.title,
      })),
      results,
    }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
