# AI 에이전트 프롬프트: 블로그 스케줄링 서버 구축

## 프로젝트 생성 요청

다음 요구사항에 맞는 Node.js 스케줄링 서버를 구축해줘.

---

## 프로젝트 개요

네이버 블로그 자동발행 스케줄링 서버를 Fastify + BullMQ로 구축한다.
원고 생성은 별도 Python 서버(http://localhost:8000)의 API를 호출하고,
이 서버는 스케줄링과 Playwright 기반 블로그 발행만 담당한다.

※ v1 예약발행 방식: **`scheduledAt` 시각까지 대기하지 않고**, 작업 실행 시점에 Playwright로 네이버 글쓰기 화면에서 **예약발행 UI로 `scheduledAt`을 설정해 “미리 예약글 등록”** 한다.

---

## 기술 스택 (필수)

```
Runtime:    Node.js 20 LTS
Language:   TypeScript 5.x
Framework:  Fastify 5.x
Queue:      BullMQ (Redis 기반 작업 큐)
Browser:    Playwright (브라우저 자동화)
Database:   MongoDB + Mongoose
Validation: Zod
HTTP:       Axios
Date:       date-fns
```

---

## 디렉토리 구조

```
scheduler-server/
├── src/
│   ├── app.ts                    # Fastify 인스턴스 생성
│   ├── server.ts                 # 진입점 (서버 시작)
│   │
│   ├── config/
│   │   ├── env.ts                # 환경변수 검증 (Zod)
│   │   ├── redis.ts              # Redis 연결
│   │   └── mongo.ts              # MongoDB 연결
│   │
│   ├── routes/
│   │   ├── index.ts              # 라우트 등록
│   │   ├── schedule.route.ts     # /schedules
│   │   └── queue.route.ts        # /queues
│   │
│   ├── services/
│   │   ├── schedule.service.ts   # 스케줄 계산/관리
│   │   ├── manuscript.service.ts # 원고 서버 API 호출
│   │   ├── naver-auth.service.ts # Playwright 로그인
│   │   └── naver-blog.service.ts # Playwright 글쓰기
│   │
│   ├── queues/
│   │   ├── index.ts              # 큐/워커 초기화
│   │   ├── constants.ts          # 큐 이름, 옵션 상수
│   │   ├── generate.worker.ts    # 원고 생성 워커
│   │   └── reserve.worker.ts     # 네이버 예약글 등록 워커
│   │
│   ├── schemas/
│   │   ├── schedule.schema.ts    # MongoDB 스키마
│   │   └── dto.ts                # 요청/응답 Zod 스키마
│   │
│   ├── lib/
│   │   ├── playwright.ts         # Playwright 브라우저 관리
│   │   └── logger.ts             # 로거 설정
│   │
│   └── constants/
│       └── selectors.ts          # 네이버 CSS 셀렉터
│
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 핵심 구현 요구사항

### 1. 환경변수 설정 (src/config/env.ts)

```typescript
import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  TZ: z.string().default('Asia/Seoul'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // MongoDB
  MONGO_URI: z.string(),

  // 원고 서버
  MANUSCRIPT_API_URL: z.string().default('http://localhost:8000'),

  // Playwright
  PLAYWRIGHT_HEADLESS: z.preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const normalized = v.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return v;
  }, z.boolean()).default(false),
  PLAYWRIGHT_SLOW_MO: z.coerce.number().default(100),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
```

### 2. Fastify 앱 설정 (src/app.ts)

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes';
import { connectMongo } from './config/mongo';
import { initQueues } from './queues';
import { logger } from './lib/logger';

export async function buildApp() {
  const app = Fastify({ logger: true });

  // 플러그인
  await app.register(cors, { origin: true });

  // 초기화
  await connectMongo();
  await initQueues();

  // 라우트
  await registerRoutes(app);

  return app;
}
```

### 3. 서버 시작 (src/server.ts)

```typescript
import { buildApp } from './app';
import { env } from './config/env';

async function main() {
  const app = await buildApp();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`Server running on http://localhost:${env.PORT}`);
}

main().catch(console.error);
```

### 4. BullMQ 큐 설정 (src/queues/index.ts)

```typescript
import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { QUEUES, defaultJobOptions } from './constants';
import { processGenerate } from './generate.worker';
import { processReserve } from './reserve.worker';

export const generateQueue = new Queue(QUEUES.GENERATE, {
  connection: redis,
  defaultJobOptions,
});

export const reserveQueue = new Queue(QUEUES.RESERVE, {
  connection: redis,
  defaultJobOptions,
});

export async function initQueues() {
  // Generate Worker
  new Worker(QUEUES.GENERATE, processGenerate, { connection: redis });

  // Reserve Worker
  new Worker(QUEUES.RESERVE, processReserve, { connection: redis });

  console.log('Queues initialized');
}
```

### 5. 큐 상수 (src/queues/constants.ts)

```typescript
export const QUEUES = {
  GENERATE: 'generate',
  RESERVE: 'reserve',
} as const;

export const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 60000, // 1분 → 2분 → 4분
  },
  removeOnComplete: 100,
  removeOnFail: 50,
};
```

### 6. 스케줄 계산 (src/services/schedule.service.ts)

```typescript
import { addDays, addHours, setHours, setMinutes, parseISO } from 'date-fns';

interface ScheduleItem {
  keyword: string;
  scheduledAt: Date;
  day: number;
  slot: number;
}

export function calculateSchedule(
  keywords: string[],
  startDate: string,
  startHour: number,
  postsPerDay: number,
  intervalHours: number
): ScheduleItem[] {
  const baseDate = setMinutes(setHours(parseISO(`${startDate}T00:00:00`), startHour), 0);
  const schedule: ScheduleItem[] = [];

  let keywordIdx = 0;
  let day = 0;

  while (keywordIdx < keywords.length) {
    const dayBase = addDays(baseDate, day);

    for (let slot = 0; slot < postsPerDay && keywordIdx < keywords.length; slot++) {
      const scheduledAt = addHours(dayBase, slot * intervalHours);

      schedule.push({
        keyword: keywords[keywordIdx],
        scheduledAt,
        day: day + 1,
        slot: slot + 1,
      });

      keywordIdx++;
    }

    day++;
  }

  return schedule;
}
```

### 7. 원고 서버 API 호출 (src/services/manuscript.service.ts)

```typescript
import axios from 'axios';
import { env } from '../config/env';

interface Manuscript {
  _id: string;
  content: string;
  keyword: string;
  category: string;
  engine: string;
}

export async function generateManuscript(
  keyword: string,
  service: string,
  ref: string = ''
): Promise<{ id: string; title: string; content: string; raw: Manuscript }> {
  const response = await axios.post<Manuscript>(
    `${env.MANUSCRIPT_API_URL}/generate/grok`,
    {
      service,
      keyword,
      ref,
    },
    { timeout: 300000 } // 5분 타임아웃 (AI 생성 오래 걸림)
  );

  // Python 서버에서 내려오는 content는 "첫 줄=제목, 나머지=본문" 규칙을 가정
  const raw = response.data;
  const lines = (raw.content ?? '').split('\n');
  const title = (lines[0] ?? '').trim() || keyword;
  const content = lines.slice(1).join('\n').trim();

  return { id: raw._id, title, content, raw };
}
```

### 8. Playwright 네이버 로그인 (src/services/naver-auth.service.ts)

```typescript
import { chromium, Browser, BrowserContext } from 'playwright';
import { env } from '../config/env';
import { SELECTORS } from '../constants/selectors';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: env.PLAYWRIGHT_HEADLESS,
      slowMo: env.PLAYWRIGHT_SLOW_MO,
    });
  }
  return browser;
}

export async function naverLogin(
  id: string,
  password: string
): Promise<{ cookies: any[]; success: boolean; message: string }> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://nid.naver.com/nidlogin.login');

    await page.fill(SELECTORS.login.id, id);
    await page.fill(SELECTORS.login.pw, password);
    await page.click(SELECTORS.login.btn);

    // 로그인 완료 대기
    await page.waitForURL('https://www.naver.com/', { timeout: 30000 });

    const cookies = await context.cookies();
    await context.close();

    return { cookies, success: true, message: '로그인 성공' };
  } catch (error) {
    await context.close();
    return {
      cookies: [],
      success: false,
      message: error instanceof Error ? error.message : '로그인 실패',
    };
  }
}
```

### 9. Playwright 블로그 글쓰기 (src/services/naver-blog.service.ts)

```typescript
import { BrowserContext } from 'playwright';
import { getBrowser } from './naver-auth.service';
import { SELECTORS } from '../constants/selectors';

interface WritePostParams {
  cookies: any[];
  title: string;
  content: string;
  images?: string[];
  scheduleTime?: Date;
}

export async function writePost(params: WritePostParams): Promise<{
  success: boolean;
  postUrl?: string;
  message: string;
}> {
  const { cookies, title, content, scheduleTime } = params;

  const browser = await getBrowser();
  const context = await browser.newContext();
  await context.addCookies(cookies);

  const page = await context.newPage();

  try {
    // 블로그 에디터 접근 (mainFrame 기반)
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const frame = page.frame({ name: 'mainFrame' });
    if (!frame) throw new Error('mainFrame을 찾을 수 없습니다.');

    // 팝업 닫기
    await frame.click(SELECTORS.popup.cancel).catch(() => {});
    await frame.click(SELECTORS.popup.helpClose).catch(() => {});

    // 제목 입력
    await frame.fill(SELECTORS.editor.title, title);

    // 본문 입력
    await frame.click(SELECTORS.editor.content);
    await page.keyboard.type(content);

    // 발행(예약 설정) 오버레이
    await frame.click(SELECTORS.publish.btn);
    await page.waitForTimeout(1000);

    // 예약 발행 설정 (날짜+시간)
    if (scheduleTime) {
      await frame.click(SELECTORS.publish.scheduleRadio);

      const now = new Date();
      const isSameDate =
        now.getFullYear() === scheduleTime.getFullYear() &&
        now.getMonth() === scheduleTime.getMonth() &&
        now.getDate() === scheduleTime.getDate();

      if (!isSameDate) {
        await frame.click(SELECTORS.publish.dateInput, { timeout: 3000 });
        await frame.locator('.ui-datepicker-header').waitFor({ state: 'visible', timeout: 3000 });

        const monthDiff =
          (scheduleTime.getFullYear() - now.getFullYear()) * 12 +
          (scheduleTime.getMonth() - now.getMonth());

        for (let i = 0; i < monthDiff; i++) {
          await frame.click(SELECTORS.publish.datepickerNextMonth, { timeout: 3000 });
          await page.waitForTimeout(300);
        }

        const dayButtons = await frame.$$('td:not(.ui-state-disabled) button.ui-state-default');
        const targetDay = String(scheduleTime.getDate());
        for (const btn of dayButtons) {
          const text = (await btn.textContent())?.trim();
          if (text === targetDay) {
            await btn.click();
            await page.waitForTimeout(300);
            break;
          }
        }
      }

      const hour = scheduleTime.getHours().toString().padStart(2, '0');
      const minute = (Math.floor(scheduleTime.getMinutes() / 10) * 10).toString().padStart(2, '0');
      await frame.selectOption(SELECTORS.publish.hourSelect, hour);
      await frame.selectOption(SELECTORS.publish.minuteSelect, minute);
    }

    // 공개 설정
    await frame.click(SELECTORS.publish.publicRadio);

    // 발행 확인
    await frame.click(SELECTORS.publish.confirm);
    await page.waitForTimeout(3000);

    const postUrl = page.url();
    await context.close();

    return { success: true, postUrl, message: '발행 성공' };
  } catch (error) {
    await context.close();
    return {
      success: false,
      message: error instanceof Error ? error.message : '발행 실패',
    };
  }
}
```

### 10. CSS 셀렉터 상수 (src/constants/selectors.ts)

```typescript
export const SELECTORS = {
  login: {
    id: '#id',
    pw: '#pw',
    btn: '.btn_login',
    captcha: '#captcha',
  },

  editor: {
    title: '.se-title-input',
    content: '.se-text-paragraph',
    imageUpload: 'input[type="file"]',
  },

  publish: {
    btn: "button.publish_btn__m9KHH, button[data-click-area='tpb.publish']",
    confirm: "button.confirm_btn__WEaBq, button[data-testid='seOnePublishBtn']",
    publicRadio: 'input#open_public',
    privateRadio: 'input#open_private',
    scheduleRadio: "label[for='radio_time2'], label.radio_label__mB6ia",
    hourSelect: 'select.hour_option__J_heO',
    minuteSelect: 'select.minute_option__Vb3xB',
    dateInput: "input.input_date__QmA0s",
    datepickerNextMonth: "button.ui-datepicker-next",
    datepickerPrevMonth: "button.ui-datepicker-prev",
    datepickerYear: "span.ui-datepicker-year",
    datepickerMonth: "span.ui-datepicker-month",
  },

  popup: {
    cancel: 'button.se-popup-button-cancel',
    helpClose: 'button.se-help-panel-close-button',
  },
};
```

### 11. Reserve Worker (src/queues/reserve.worker.ts)

```typescript
import { Job } from 'bullmq';
import { naverLogin } from '../services/naver-auth.service';
import { writePost } from '../services/naver-blog.service';
import { logger } from '../lib/logger';

interface ReserveJobData {
  accountId: string;
  password: string;
  manuscript: {
    title: string;
    content: string;
    images?: string[];
  };
  scheduledAt: string;
}

export async function processReserve(job: Job<ReserveJobData>) {
  const { accountId, password, manuscript, scheduledAt } = job.data;

  logger.info(`[Reserve] Starting job ${job.id} for ${accountId}`);

  // 1. 로그인
  const loginResult = await naverLogin(accountId, password);
  if (!loginResult.success) {
    throw new Error(`로그인 실패: ${loginResult.message}`);
  }

  // 2. 예약글 등록 (네이버 예약 UI로 scheduledAt 설정)
  const reserveResult = await writePost({
    cookies: loginResult.cookies,
    title: manuscript.title,
    content: manuscript.content,
    images: manuscript.images,
    scheduleTime: scheduledAt ? new Date(scheduledAt) : undefined,
  });

  if (!reserveResult.success) {
    throw new Error(`예약 등록 실패: ${reserveResult.message}`);
  }

  logger.info(`[Reserve] Completed job ${job.id}: ${reserveResult.postUrl}`);

  return reserveResult;
}
```

### 12. 스케줄 라우트 (src/routes/schedule.route.ts)

```typescript
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { calculateSchedule } from '../services/schedule.service';
import { generateQueue } from '../queues';
import { format } from 'date-fns';

const createScheduleSchema = z.object({
  service: z.string().default('default'),
  ref: z.string().default(''),
  queues: z.array(z.object({
    account: z.object({
      id: z.string(),
      password: z.string(),
    }),
    keywords: z.array(z.string()).min(1),
  })).min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().min(0).max(23).default(10),
  postsPerDay: z.number().min(1).max(10).default(3),
  intervalHours: z.number().min(1).max(12).default(2),
  generateImages: z.boolean().default(true),
  imageCount: z.number().min(1).max(10).default(5),
  delayBetweenPostsSeconds: z.number().min(0).max(600).default(10),
});

export async function scheduleRoutes(app: FastifyInstance) {
  // 스케줄 생성
  app.post('/schedules', async (req, reply) => {
    const body = createScheduleSchema.parse(req.body);

    const results = [];

    for (const queue of body.queues) {
      const schedule = calculateSchedule(
        queue.keywords,
        body.startDate,
        body.startHour,
        body.postsPerDay,
        body.intervalHours
      );

      // 각 스케줄 아이템을 큐에 추가
      for (const item of schedule) {
        await generateQueue.add(
          'generate',
          {
            keyword: item.keyword,
            account: queue.account,
            scheduledAt: format(item.scheduledAt, "yyyy-MM-dd'T'HH:mm:ssXXX"),
            service: body.service,
            ref: body.ref,
            generateImages: body.generateImages,
            imageCount: body.imageCount,
            delayBetweenPostsSeconds: body.delayBetweenPostsSeconds,
          },
        );
      }

      results.push({
        account: `${queue.account.id.slice(0, 3)}***`,
        keywords: queue.keywords.length,
        schedule: schedule.map((item) => ({
          ...item,
          scheduledAt: format(item.scheduledAt, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        })),
      });
    }

    return {
      success: true,
      totalJobs: results.reduce((sum, r) => sum + r.keywords, 0),
      results,
    };
  });

  // 스케줄 조회
  app.get('/schedules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    // MongoDB에서 조회
    return { id, status: 'pending' };
  });

  // 스케줄 취소
  app.delete('/schedules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    // 큐에서 제거
    return { success: true, id };
  });
}
```

### 13. 큐 상태 라우트 (src/routes/queue.route.ts)

```typescript
import { FastifyInstance } from 'fastify';
import { generateQueue, reserveQueue } from '../queues';

export async function queueRoutes(app: FastifyInstance) {
  app.get('/queues/stats', async () => {
    const [generateCounts, reserveCounts] = await Promise.all([
      generateQueue.getJobCounts(),
      reserveQueue.getJobCounts(),
    ]);

    return {
      generate: generateCounts,
      reserve: reserveCounts,
    };
  });
}
```

### 14. 라우트 등록 (src/routes/index.ts)

```typescript
import { FastifyInstance } from 'fastify';
import { scheduleRoutes } from './schedule.route';
import { queueRoutes } from './queue.route';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(scheduleRoutes);
  await app.register(queueRoutes);

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
}
```

---

## package.json

```json
{
  "name": "scheduler-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/cors": "^10.0.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.4.0",
    "mongoose": "^8.0.0",
    "playwright": "^1.48.0",
    "axios": "^1.7.0",
    "zod": "^3.23.0",
    "date-fns": "^4.1.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0"
  }
}
```

---

## Docker Compose

```yaml
version: '3.8'

services:
  scheduler:
    build: .
    ports:
      - "3000:3000"
    environment:
      - TZ=Asia/Seoul
      - REDIS_HOST=redis
      - MONGO_URI=mongodb://mongo:27017/scheduler
      - MANUSCRIPT_API_URL=http://host.docker.internal:8000
    depends_on:
      - redis
      - mongo

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db

volumes:
  redis_data:
  mongo_data:
```

---

## .env.example

```env
PORT=3000
NODE_ENV=development
TZ=Asia/Seoul

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# MongoDB
MONGO_URI=mongodb://localhost:27017/scheduler

# 원고 서버 (Python)
MANUSCRIPT_API_URL=http://localhost:8000

# Playwright
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_SLOW_MO=100
```

---

## 실행 순서

```bash
# 1. 프로젝트 생성
mkdir scheduler-server && cd scheduler-server

# 2. 패키지 설치
npm init -y
npm install fastify @fastify/cors bullmq ioredis mongoose playwright axios zod date-fns dotenv
npm install -D typescript tsx @types/node

# 3. Playwright 브라우저 설치
npx playwright install chromium

# 4. Redis, MongoDB 실행
docker-compose up -d redis mongo

# 5. 환경변수 설정
cp .env.example .env

# 6. 개발 서버 실행
npm run dev
```

---

## 기존 Python 코드 참고

이 파일들의 로직을 참고해서 Node.js로 구현:

- 네이버 로그인: `routers/auth/naver.py`
- 블로그 글쓰기: `routers/auth/blog_write.py`
- 스케줄 계산: `routers/bot/auto_schedule.py`
- 큐 관리: `routers/bot/common.py`, `routers/bot/queue.py`
