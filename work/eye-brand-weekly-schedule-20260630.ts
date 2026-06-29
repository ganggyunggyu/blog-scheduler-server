import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

type CsvRow = string[];

interface KeywordPools {
  preferred: string[];
  fallback: string[];
}

interface PlannedItem {
  keyword: string;
  title: string;
  content: string;
  scheduledAt: string;
  slot: number;
  slides: string[];
}

const SHEET_ID = '1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c';
const EYE_SHEET_GID = '633450920';
const EYE_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${EYE_SHEET_GID}`;
const SCHEDULER_API_URL = process.env.SCHEDULER_API_URL ?? 'http://localhost:8001';
const ACCOUNT_ID = 'adplan3th';
const BLOG_ID = 'adplan3th';
const START_DATE = '2026-06-30';
const DATES = ['2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'];
const SLOT_TIMES = ['09:00', '13:00', '17:00'];
const OUT_DIR = path.resolve('work/eye-brand-week-20260630');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const BASE_LINK = 'https://blog.naver.com/adplan3th/224094493829';
const EXECUTE = process.argv.includes('--execute');

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
  const candidates = [...pools.preferred, ...pools.fallback];
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const keyword of candidates) {
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
    throw new Error(`브랜드 예약 키워드 부족: ${selected.length} < ${count}`);
  }

  return selected;
};

const titleFor = (keyword: string, index: number): string => {
  const endings = [
    '전 확인할 기준',
    '방법과 주의할 점',
    '상담 전 알아둘 내용',
    '검사 기준과 선택 방법',
    '궁금할 때 확인할 점',
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


${keyword}을 알아보다 보면 정보는 많은데,
내 눈에 맞는 기준이 무엇인지 헷갈리는 경우가
많습니다.

비용이나 후기만 보고 결정하기에는 눈 상태마다
확인해야 할 부분이 다를 수 있습니다.

오늘은 ${keyword}을 고민할 때 어떤 순서로
살펴보면 좋을지 차분히 정리해 드리겠습니다.

${introLine}
압구정 에스앤비안과 기준으로 정리했습니다.

1. ${keyword}에서 먼저 확인할 부분

[IMG] ${keyword} 상담 전 확인할 핵심
가장 먼저 볼 것은 수술명이나 비용이 아니라
현재 눈 상태입니다.

각막 두께, 굴절도, 난시 방향, 건조감, 동공 크기,
생활 패턴이 함께 확인되어야 선택지가 좁혀집니다.

같은 ${keyword}을 검색하더라도 사람마다 필요한
방법이 달라지는 이유가 여기에 있습니다.

2. 정밀검사가 먼저인 이유

[IMG] 정밀검사로 보는 눈 상태
검사는 단순 시력 측정에서 끝나지 않습니다.

각막 지형도와 두께, 눈물막 상태, 망막 확인까지
살펴봐야 안전하게 진행할 수 있는 범위가 보입니다.

검사 결과가 충분하지 않으면 수술 가능 여부보다
보류나 다른 방법을 먼저 안내받는 것이 맞습니다.

3. 방법을 나누는 기준

[IMG] 방법 선택을 나누는 기준
레이저 교정, 렌즈삽입술, 백내장 관련 수술처럼
방향이 나뉘는 경우에는 기준이 분명해야 합니다.

각막을 얼마나 보존할 수 있는지, 회복 기간을
어느 정도 예상하는지, 야간 빛 번짐 가능성은
어떤지 함께 봅니다.

한 가지 방법을 먼저 정해 두기보다 검사 결과에
따라 가능한 선택지를 비교하는 과정이 필요합니다.

4. 비용보다 함께 봐야 할 항목

[IMG] 비용과 함께 확인할 항목
비용은 병원마다 다르게 보일 수 있습니다.

하지만 장비, 검사 항목, 수술 후 검진, 회복 관리가
어디까지 포함되는지에 따라 실제 구성은 달라집니다.

가격만 따로 비교하면 중요한 관리 과정이 빠질 수
있어, 전체 진료 흐름을 같이 확인하는 편이 좋습니다.

5. 상담 전 정리하면 좋은 질문

[IMG] 상담 전 체크리스트
상담 전에는 평소 불편한 시간대, 안경이나 렌즈 사용
기간, 직업상 필요한 시야, 회복에 쓸 수 있는 날짜를
정리해 오시면 도움이 됩니다.

특히 운전, 야간 근무, 장시간 모니터 사용이 있다면
검사 결과와 함께 이야기해야 합니다.

압구정 에스앤비안과는 검사 결과를 바탕으로
가능한 방법과 보류해야 할 조건을 구분해 안내합니다.

${keyword}을 고민 중이라면 먼저 정밀검사로
내 눈의 기준을 확인해 보시기 바랍니다.`;
};

const addDays = (date: string, offset: number): string => {
  const base = new Date(`${date}T00:00:00+09:00`);
  base.setUTCDate(base.getUTCDate() + offset);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);
};

const scheduledAtFor = (date: string, time: string): string =>
  `${date}T${time}:00+09:00`;

const writeSlideGenerator = async (items: Array<{ keyword: string; title: string; dir: string }>): Promise<void> => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const inputPath = path.join(OUT_DIR, 'slide-input.json');
  await fs.writeFile(inputPath, JSON.stringify({ items }, null, 2), 'utf8');
  const python = String.raw`
import json
import math
import os
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 2160, 2700
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"

def font(size, index=0):
    return ImageFont.truetype(FONT, size=size, index=index)

def wrap_text(draw, text, ft, max_width):
    words = list(text)
    lines = []
    line = ""
    for ch in words:
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
    img = Image.new("RGB", (small_w, small_h), "#071323")
    px = img.load()
    for y in range(small_h):
        for x in range(small_w):
            t = (x / small_w * 0.35) + (y / small_h * 0.65)
            r = int(5 + 18 * t)
            g = int(17 + 42 * t)
            b = int(34 + 72 * t)
            px[x, y] = (r, g, b)
    return img.resize((W, H), Image.Resampling.BICUBIC)

def draw_background(draw, accent):
    line = (58, 91, 137)
    draw.polygon([(0, 435), (760, 0), (1730, 650), (1120, 1310)], outline=line)
    draw.line([(720, 0), (1730, 650), (1400, 1220), (2140, 1450)], fill=line, width=3)
    for x, y, r in [(760, 0, 17), (1730, 650, 17), (1400, 1220, 17), (760, 1950, 17)]:
        draw.ellipse((x-r, y-r, x+r, y+r), fill=(63, 95, 140))
    draw.ellipse((690, 1900, 1480, 2690), outline=(31, 78, 138), width=5)
    draw.line((1085, 1940, 1085, 2360), fill=(45, 94, 159), width=6)
    draw.line((1085, 2360, 1290, 2490), fill=(45, 94, 159), width=7)
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
        ("EYE CARE", keyword, "확인할 기준 정리"),
        ("POINT 01", "정밀검사", "눈 상태를 먼저 확인합니다"),
        ("POINT 02", "적합 조건", "가능한 방법과 보류 조건을 나눕니다"),
        ("POINT 03", "방법 선택", "수술명보다 검사 결과가 우선입니다"),
        ("POINT 04", "비용 구성", "검사와 사후 관리 포함 범위를 봅니다"),
        ("CHECK LIST", "상담 전 정리", "생활 패턴과 회복 일정을 함께 확인합니다"),
    ]
    top, main, sub = labels[idx - 1]

    draw.text((140, 830), top, font=font(78), fill=accent)
    y = 990
    main_font = font(150 if len(main) <= 8 else 126)
    y = draw_text_block(draw, (140, y), main, main_font, "#ffffff", 1420, 26)
    y += 55
    draw_text_block(draw, (145, y), sub, font(72), "#62a8ff", 1320, 18)

    if idx == 1:
        draw.text((140, 1540), title, font=font(86), fill="#dbeafe")
    else:
        draw.text((140, 1540), keyword, font=font(86), fill="#dbeafe")

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

const buildPlan = async (keywords: string[]): Promise<PlannedItem[]> => {
  const slideInputs: Array<{ keyword: string; title: string; dir: string }> = [];
  const planned: PlannedItem[] = [];

  for (const [index, keyword] of keywords.entries()) {
    const title = titleFor(keyword, index);
    const dayIndex = Math.floor(index / SLOT_TIMES.length);
    const timeIndex = index % SLOT_TIMES.length;
    const date = DATES[dayIndex] ?? addDays(START_DATE, dayIndex);
    const itemDir = path.join(OUT_DIR, 'slides', `${String(index + 1).padStart(2, '0')}_${slugify(keyword)}`);
    const slides = SLOT_TIMES.concat(SLOT_TIMES).slice(0, 6)
      .map((_, slideIndex) => path.join(itemDir, `slide_${String(slideIndex + 1).padStart(2, '0')}.png`));

    slideInputs.push({ keyword, title, dir: itemDir });
    planned.push({
      keyword,
      title,
      content: buildContent(keyword, title),
      scheduledAt: scheduledAtFor(date, SLOT_TIMES[timeIndex]),
      slot: index + 1,
      slides,
    });
  }

  await writeSlideGenerator(slideInputs);
  await fs.writeFile(MANIFEST_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    accountId: ACCOUNT_ID,
    blogId: BLOG_ID,
    service: 'eye-brand-weekly-local-generated',
    ref: 'eye-brand-week-2026-06-30_2026-07-04',
    scheduleDate: START_DATE,
    items: planned.map((item) => ({
      keyword: item.keyword,
      title: item.title,
      scheduledAt: item.scheduledAt,
      slot: item.slot,
      slides: item.slides,
    })),
  }, null, 2), 'utf8');

  return planned;
};

const callAutoSchedule = async (planned: PlannedItem[]): Promise<unknown> => {
  const password = process.env.NAVER_BRAND_PASSWORD;
  if (!password) {
    throw new Error('NAVER_BRAND_PASSWORD 없음: 브랜드 예약 스킵');
  }

  const body = {
    queues: [
      {
        account: {
          id: ACCOUNT_ID,
          password,
          blogId: BLOG_ID,
        },
        blog_name: '에스앤비안과 브랜드',
        keywords: planned.map((item) => item.keyword),
        items: planned.map((item) => ({
          keyword: item.keyword,
          scheduledAt: item.scheduledAt,
          slot: item.slot,
        })),
        manuscripts: planned.map((item) => ({
          title: item.title,
          content: item.content,
        })),
        multi_images: planned.map((item) => ({
          slide: item.slides,
        })),
      },
    ],
    schedule_date: START_DATE,
    schedule_mode: '3',
    service: 'eye-brand-weekly-local-generated',
    ref: 'eye-brand-week-2026-06-30_2026-07-04',
    generate_images: false,
    image_count: 6,
    image_source: 'local',
    manuscript_type: 'default',
    delay_between_posts: 10,
    keyword_category: '안과브랜드',
  };

  const response = await fetch(`${SCHEDULER_API_URL}/bot/auto-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(`auto-schedule 실패: ${response.status}`);
  }
  if (
    !result ||
    typeof result !== 'object' ||
    !('success' in result) ||
    (result as { success?: unknown }).success !== true
  ) {
    throw new Error(`auto-schedule 실패 응답: ${JSON.stringify(result)}`);
  }
  return result;
};

const main = async (): Promise<void> => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI 없음');
  }

  await mongoose.connect(mongoUri);
  try {
    const [pools, usedKeywords, recentTitles] = await Promise.all([
      fetchKeywordPools(),
      loadUsedBrandKeywords(),
      fetchRecentTitles(),
    ]);
    const keywords = selectKeywords(pools, usedKeywords, recentTitles, DATES.length * SLOT_TIMES.length);
    const planned = await buildPlan(keywords);
    const result = EXECUTE ? await callAutoSchedule(planned) : { dryRun: true, totalJobs: planned.length };
    console.log(JSON.stringify({
      mode: EXECUTE ? 'execute' : 'dry-run',
      manifest: MANIFEST_PATH,
      selected: keywords,
      result,
    }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
