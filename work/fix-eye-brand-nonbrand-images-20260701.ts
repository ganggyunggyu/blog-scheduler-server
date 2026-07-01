import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { redis } from '../src/config/redis.js';
import { updatePost } from '../src/services/naver-blog.service.js';
import { getValidCookies, naverLogin } from '../src/services/naver-auth.service.js';
import { getSession } from '../src/services/session.service.js';

interface RepairItem {
  logNo: string;
  keyword: string;
  title: string;
  content: string;
  slides: string[];
}

const ACCOUNT_ID = 'adplan3th';
const BLOG_ID = 'adplan3th';
const LOG_NO = '224246516373';
const BLOG_CATEGORY = '에스앤비 안과';
const OUTPUT_DIR = path.resolve('outputs/eye-brand-image-audit-20260701');
const WORK_DIR = path.resolve('work/eye-brand-nonbrand-image-fix-20260701');
const SLIDE_DIR = path.join(WORK_DIR, 'slides', '01_스마일라식_15주년');
const VERIFY_PATH = path.join(OUTPUT_DIR, 'fix-224246516373-verify.json');
const EXECUTE = process.argv.includes('--execute');
const TOP_LINK = 'https://blog.naver.com/adplan3th/224094493829';
const BOTTOM_LINK = 'https://snbeye.com/sb-review/';

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const buildContent = (title: string): string => `${title}

안녕하십니까, 시력교정술 국내 도입 1세대
압구정 에스앤비안과입니다.

${TOP_LINK}

스마일라식을 알아볼 때 이벤트 문구만 보고
결정하기보다 내 눈 조건에 맞는 검사와 상담이
함께 진행되는지 확인하는 과정이 필요합니다.

정밀검사로 각막과 시력 조건을 먼저 확인하는 압구정 에스앤비안과 기준으로 정리했습니다.

1. 스마일라식 할인 전 먼저 볼 기준

[IMG] 이벤트 확인 전 검사 기준
할인이나 이벤트는 진료 선택의 참고 요소일 수 있지만
수술 가능 여부를 대신 판단해 주지는 않습니다.

각막 두께, 난시 방향, 눈물막 상태, 야간 동공 크기처럼
개인별 조건을 먼저 확인해야 안전한 방향을 정할 수 있습니다.

2. 정밀검사가 필요한 이유

[IMG] 정밀검사로 확인하는 항목
스마일라식은 각막을 다루는 시력교정술이기 때문에
검사 결과에 따라 적합 여부가 달라질 수 있습니다.

단순 시력 수치뿐 아니라 회복 과정에서 불편해질 수 있는
건조감, 빛 번짐, 직업상 필요한 시야 조건도 함께 봐야 합니다.

3. 비용보다 중요한 구성

[IMG] 비용과 함께 비교할 항목
같은 이벤트처럼 보여도 검사 항목, 장비, 의료진 상담,
수술 후 검진 범위가 어디까지 포함되는지에 따라
실제 구성은 달라질 수 있습니다.

가격만 따로 비교하기보다 진료 흐름 전체를 확인하는 편이
시력교정 계획을 세우는 데 더 도움이 됩니다.

4. 상담 전 준비하면 좋은 내용

[IMG] 상담 전 준비 리스트
렌즈 착용 시간, 불편한 시간대, 운전 여부, 모니터 사용량,
회복에 쓸 수 있는 날짜를 미리 정리하면 상담이 구체적입니다.

압구정 에스앤비안과는 검사 결과를 바탕으로 가능한 방법과
보류해야 할 조건을 구분해 안내합니다.

5. 이벤트를 볼 때의 기준

[IMG] 이벤트 확인 체크포인트
스마일라식 이벤트를 확인할 때도 내 눈에 맞는 수술인지,
사후 검진은 어떻게 이어지는지, 회복 일정은 무리 없는지까지
함께 확인하는 것이 좋습니다.

${BOTTOM_LINK}

스마일라식 할인 정보를 보고 계신다면 먼저 정밀검사로
내 눈에 맞는 기준부터 확인해 보시기 바랍니다.`;

const writeSlides = async (item: { keyword: string; title: string; dir: string }): Promise<void> => {
  await fs.mkdir(item.dir, { recursive: true });
  const inputPath = path.join(WORK_DIR, 'slide-input.json');
  await fs.writeFile(inputPath, JSON.stringify({ items: [item] }, null, 2), 'utf8');

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
    img = Image.new("RGB", (small_w, small_h), "#07172b")
    px = img.load()
    for y in range(small_h):
        for x in range(small_w):
            t = (x / small_w * 0.32) + (y / small_h * 0.68)
            px[x, y] = (int(5 + 20 * t), int(18 + 48 * t), int(42 + 92 * t))
    return img.resize((W, H), Image.Resampling.BICUBIC)

def draw_background(draw, accent):
    line = (56, 96, 150)
    draw.polygon([(0, 380), (820, 0), (1810, 620), (1120, 1320)], outline=line)
    draw.line([(720, 0), (1810, 620), (1410, 1210), (2140, 1460)], fill=line, width=4)
    for x, y, r in [(820, 0, 18), (1810, 620, 18), (1410, 1210, 18), (760, 1940, 18)]:
        draw.ellipse((x-r, y-r, x+r, y+r), fill=(68, 108, 160))
    draw.ellipse((690, 1900, 1480, 2690), outline=(35, 86, 150), width=5)
    draw.line((1085, 1940, 1085, 2360), fill=(48, 102, 172), width=6)
    draw.line((1085, 2360, 1290, 2490), fill=(48, 102, 172), width=7)
    draw.ellipse((1065, 2340, 1105, 2380), fill=accent)

def draw_logo(draw):
    draw.text((1540, 150), "압구정", font=font(58), fill="#dbeafe")
    draw.text((1540, 225), "S&B안과", font=font(112), fill="#ffffff")
    draw.text((1545, 355), "SHINE&BRIGHT EYE CLINIC", font=font(38), fill="#c8d7ec")

def draw_slide(item, idx):
    accent = (96, 178, 255)
    img = BASE_GRADIENT.copy()
    draw = ImageDraw.Draw(img)
    draw_background(draw, accent)
    draw_logo(draw)

    keyword = item["keyword"]
    title = item["title"]
    labels = [
        ("S&B EYE", "스마일라식", "이벤트보다 먼저 볼 검사 기준"),
        ("CHECK 01", "정밀검사", "각막과 시력 조건을 확인합니다"),
        ("CHECK 02", "비용 구성", "검사와 사후 관리 범위를 함께 봅니다"),
        ("CHECK 03", "상담 준비", "렌즈 사용과 회복 일정을 정리합니다"),
        ("CHECK 04", "이벤트 기준", "내 눈에 맞는 조건인지 확인합니다"),
        ("CHECK 05", "에스앤비안과", "검사 결과에 맞춰 방향을 안내합니다"),
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

  const result = spawnSync('python3', ['-c', python, inputPath], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`슬라이드 생성 실패: exit=${result.status}`);
  }
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

const decodeHtml = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const filenameOf = (url: string): string => {
  const clean = url.split('?')[0] ?? url;
  return decodeHtml(clean.slice(clean.lastIndexOf('/') + 1));
};

const verifyPublicPost = async (item: RepairItem): Promise<Record<string, unknown>> => {
  await sleep(4000);
  const url = `https://blog.naver.com/PostView.naver?blogId=${BLOG_ID}&logNo=${item.logNo}&redirect=Dlog&widgetTypeCall=true&directAccess=false&_=${Date.now()}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Cache-Control': 'no-cache',
      Referer: `https://blog.naver.com/${BLOG_ID}`,
    },
    signal: AbortSignal.timeout(30000),
  });
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
  const imageUrls = Array.from(new Set(
    Array.from(html.matchAll(/https:\/\/(?:blogthumb|postfiles|blogfiles)\.pstatic\.net[^"'\s<>]+\.(?:png|jpg|jpeg|webp)(?:\?[^"'\s<>]*)?/giu))
      .map((match) => decodeHtml(match[0])),
  ));
  const imageNames = imageUrls.map(filenameOf)
    .filter((name) => !/블로그_스킨|skin|spc\.gif|ico_|arw|gnb|menu|login|down|up/iu.test(name));
  const slideCount = imageNames.filter((name) => /^slide_\d{2}\./iu.test(name)).length;
  const topLinkOk = html.includes(TOP_LINK) || text.includes(TOP_LINK);
  const bottomLinkOk = html.includes(BOTTOM_LINK) || text.includes(BOTTOM_LINK);

  return {
    logNo: item.logNo,
    url: `https://blog.naver.com/${BLOG_ID}/${item.logNo}`,
    httpStatus: response.status,
    expectedTitle: item.title,
    title,
    titleOk: title.includes(item.title),
    keywordOk: text.includes(item.keyword),
    brandOk: /에스앤비안과|S&B안과|SHINE&BRIGHT/iu.test(text),
    topLinkOk,
    bottomLinkOk,
    linkOk: topLinkOk && bottomLinkOk,
    slideCount,
    firstContentImage: imageNames[0] ?? '',
    imageNames: imageNames.slice(0, 12),
  };
};

const buildRepairItem = async (): Promise<RepairItem> => {
  const title = '스마일라식 할인 15주년 이벤트';
  const keyword = '스마일라식 할인';
  const slides = Array.from({ length: 6 }, (_, index) =>
    path.join(SLIDE_DIR, `slide_${String(index + 1).padStart(2, '0')}.png`));
  await writeSlides({ keyword, title, dir: SLIDE_DIR });
  return {
    logNo: LOG_NO,
    keyword,
    title,
    content: buildContent(title),
    slides,
  };
};

const main = async (): Promise<void> => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const item = await buildRepairItem();
  const manifest = {
    generatedAt: new Date().toISOString(),
    execute: EXECUTE,
    accountId: ACCOUNT_ID,
    blogId: BLOG_ID,
    item,
  };
  await fs.writeFile(path.join(WORK_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const result = EXECUTE
    ? await updatePost({
      cookies: await getCookies(),
      blogId: BLOG_ID,
      logNo: item.logNo,
      title: item.title,
      content: item.content,
      images: [],
      multiImages: { slide: item.slides },
      category: BLOG_CATEGORY,
      keywordCategory: '안과브랜드',
      manuscriptType: 'default',
    })
    : { success: false, message: 'dry-run' };

  const verify = EXECUTE && result.success ? await verifyPublicPost(item) : null;
  await fs.writeFile(VERIFY_PATH, JSON.stringify({ item, result, verify }, null, 2), 'utf8');
  console.log(JSON.stringify({ result, verify, verifyPath: VERIFY_PATH }, null, 2));

  if (EXECUTE && !result.success) {
    throw new Error(result.message);
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
