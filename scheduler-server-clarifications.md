# 스케줄링 서버 추가 요구사항 (필수)

기획서/프롬프트 문서의 모호한 부분을 명확히 정의한다. **이 문서의 내용이 기존 문서와 충돌하면 이 문서가 우선**한다.

---

## 0. 서버 역할 명확화

### 이 서버는 웹 API 서버다

스케줄링 서버는 **클라이언트(프론트엔드/외부 시스템)로부터 HTTP 요청을 받아 동작하는 웹 API 서버**다.
단독으로 돌아가는 백그라운드 데몬이나 크론잡이 아님.

```
┌─────────────┐      HTTP       ┌─────────────────────┐
│   Client    │ ──────────────→ │  Scheduler Server   │
│  (Frontend) │   POST /schedules   (Fastify + BullMQ)   │
└─────────────┘                 └─────────────────────┘
                                         │
                                         ▼
                               ┌─────────────────────┐
                               │    BullMQ Worker    │
                               │  (백그라운드 처리)  │
                               └─────────────────────┘
```

### 요청-응답 흐름

```
1. 클라이언트 → POST /schedules (스케줄 생성 요청)
2. 서버 → 스케줄 계산 → 큐에 작업 추가 → 응답 반환
3. 클라이언트 → GET /schedules/:id (상태 조회)
4. 클라이언트 → DELETE /schedules/:id (취소)
```

### 기존 Python 서버와 동일한 패턴

현재 Python 서버의 `routers/bot/` 구조와 동일:

```python
# 기존 Python (routers/bot/auto_schedule.py)
@router.post("/auto-schedule")
async def auto_schedule_bot(request: AutoScheduleRequest):
    # 클라이언트 요청 받아서 처리
    ...
```

```typescript
// 새 Node.js (src/routes/schedule.route.ts)
app.post('/schedules', async (req, reply) => {
  // 동일하게 클라이언트 요청 받아서 처리
  ...
});
```

### 클라이언트 예시

```typescript
// 프론트엔드에서 호출
const response = await fetch('http://scheduler:3000/schedules', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
  },
  body: JSON.stringify({
    queues: [{ account: {...}, keywords: [...] }],
    startDate: '2025-01-07',
    // ...
  }),
});

const { scheduleId } = await response.json();

// 상태 폴링
const status = await fetch(`http://scheduler:3000/schedules/${scheduleId}`);
```

---

## 1. 큐 타이밍 구조 (중요)

### 문제점
기존 프롬프트의 예시 코드는 `generate` 큐에 `scheduledAt`까지 delay를 건다:
```typescript
// ❌ 잘못된 구조
await generateQueue.add('generate', { ... }, { delay: scheduledAt까지_밀리초 });
```

이러면 원고 생성이 발행 직전에 시작돼서:
- AI 원고 생성에 1~3분 소요
- 예약발행 시간 놓침
- 발행 실패

### 올바른 구조

```
POST /schedules 요청
     ↓
[즉시] generate 큐에 추가 (delay 없음)
     ↓
[즉시] Worker: 원고 서버 API 호출 (1~3분 소요)
     ↓
[즉시] 원고 생성 완료 → MongoDB에 저장
     ↓
[즉시] publish 큐에 추가 (scheduledAt까지 delay)
     ↓
[대기] ... (delay 동안 대기) ...
     ↓
[scheduledAt] Worker: Playwright로 블로그 발행
```

### 구현 규칙

```typescript
// ✅ 올바른 구조

// 1. generate는 즉시 실행 (delay 없음)
await generateQueue.add('generate', {
  keyword: item.keyword,
  account: queue.account,
  scheduledAt: item.scheduledAt.toISOString(),
}, { delay: 0 }); // 즉시 실행

// 2. generate.worker.ts에서 원고 생성 후 publish 큐에 추가
export async function processGenerate(job: Job<GenerateJobData>) {
  const { keyword, account, scheduledAt } = job.data;

  // 원고 생성 (즉시)
  const manuscript = await generateManuscript(keyword);

  // MongoDB에 저장
  const saved = await saveManuscript(manuscript);

  // publish 큐에 추가 (scheduledAt까지 delay)
  const delay = Math.max(0, new Date(scheduledAt).getTime() - Date.now());

  await publishQueue.add('publish', {
    manuscriptId: saved._id,
    account,
    scheduledAt,
  }, { delay }); // 여기서만 delay

  return { manuscriptId: saved._id };
}
```

### 선행 시간 (Lead Time) 옵션

원고 생성 실패 시 재시도 여유를 위해 선행 시간 설정 가능:

```typescript
// 스케줄 요청에 leadTimeMinutes 옵션 추가
interface CreateScheduleDto {
  // ... 기존 필드
  leadTimeMinutes?: number; // 기본값: 30 (발행 30분 전에 원고 생성)
}

// 적용
const generateAt = subMinutes(scheduledAt, leadTimeMinutes);
const generateDelay = Math.max(0, generateAt.getTime() - Date.now());

await generateQueue.add('generate', { ... }, { delay: generateDelay });
```

---

## 2. 로그인/세션 전략 (중요)

### 문제점
- 매번 ID/PW로 로그인하면 네이버 봇 탐지 → 캡차/계정 잠금
- 쿠키 TTL, 갱신 규칙이 없음

### 세션 관리 규칙

```typescript
// src/services/session.service.ts

const SESSION_TTL = 60 * 60 * 2; // 2시간 (네이버 세션 유효시간 고려)
const SESSION_PREFIX = 'session:';

interface CachedSession {
  cookies: any[];
  createdAt: number;
  lastUsed: number;
}

// 세션 조회 (캐시 우선)
export async function getSession(accountId: string): Promise<any[] | null> {
  const key = SESSION_PREFIX + accountId;
  const cached = await redis.get(key);

  if (cached) {
    const session: CachedSession = JSON.parse(cached);

    // TTL 체크
    if (Date.now() - session.createdAt < SESSION_TTL * 1000) {
      // lastUsed 갱신
      session.lastUsed = Date.now();
      await redis.setex(key, SESSION_TTL, JSON.stringify(session));
      return session.cookies;
    }
  }

  return null; // 캐시 미스 또는 만료
}

// 세션 저장
export async function saveSession(accountId: string, cookies: any[]): Promise<void> {
  const key = SESSION_PREFIX + accountId;
  const session: CachedSession = {
    cookies,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };

  await redis.setex(key, SESSION_TTL, JSON.stringify(session));
}

// 세션 무효화
export async function invalidateSession(accountId: string): Promise<void> {
  await redis.del(SESSION_PREFIX + accountId);
}
```

### 로그인 플로우

```typescript
// src/services/naver-auth.service.ts

export async function getValidCookies(
  accountId: string,
  password: string
): Promise<{ cookies: any[]; fromCache: boolean }> {

  // 1. 캐시 확인
  const cached = await getSession(accountId);
  if (cached) {
    return { cookies: cached, fromCache: true };
  }

  // 2. Rate limit 체크
  const canLogin = await checkRateLimit(accountId);
  if (!canLogin) {
    throw new Error('로그인 시도 횟수 초과. 1분 후 재시도하세요.');
  }

  // 3. 새 로그인
  const result = await naverLogin(accountId, password);
  if (!result.success) {
    throw new Error(result.message);
  }

  // 4. 세션 캐시
  await saveSession(accountId, result.cookies);

  return { cookies: result.cookies, fromCache: false };
}
```

### Rate Limit 규칙

```typescript
const RATE_LIMIT = 3;        // 분당 최대 로그인 시도
const RATE_WINDOW = 60;      // 초
const RATE_PREFIX = 'rate:login:';

export async function checkRateLimit(accountId: string): Promise<boolean> {
  const key = RATE_PREFIX + accountId;
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, RATE_WINDOW);
  }

  return count <= RATE_LIMIT;
}
```

### 세션 실패 시 재로그인

```typescript
// publish.worker.ts

export async function processPublish(job: Job<PublishJobData>) {
  const { account, manuscriptId, scheduledAt } = job.data;

  let cookies = await getSession(account.id);

  // 세션으로 발행 시도
  if (cookies) {
    const result = await writePost({ cookies, ... });

    if (result.success) {
      return result;
    }

    // 세션 만료로 실패 시 → 무효화
    if (result.message.includes('로그인') || result.message.includes('session')) {
      await invalidateSession(account.id);
      cookies = null;
    }
  }

  // 재로그인 후 재시도
  if (!cookies) {
    const auth = await getValidCookies(account.id, account.password);
    const result = await writePost({ cookies: auth.cookies, ... });
    return result;
  }
}
```

---

## 3. 데이터 모델 (MongoDB)

### Schedule 스키마

```typescript
// src/schemas/schedule.schema.ts

const ScheduleSchema = new Schema({
  // 식별자
  _id: { type: String, default: () => `sch_${randomUUID()}` },

  // 계정 (비밀번호는 저장 안 함!)
  accountId: { type: String, required: true, index: true },

  // 스케줄 설정
  startDate: { type: Date, required: true },
  startHour: { type: Number, required: true },
  postsPerDay: { type: Number, required: true },
  intervalHours: { type: Number, required: true },

  // 상태
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true,
  },

  // 통계
  totalJobs: { type: Number, default: 0 },
  completedJobs: { type: Number, default: 0 },
  failedJobs: { type: Number, default: 0 },

  // 타임스탬프
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
```

### ScheduleJob 스키마 (개별 작업)

```typescript
const ScheduleJobSchema = new Schema({
  _id: { type: String, default: () => `job_${randomUUID()}` },

  // 관계
  scheduleId: { type: String, required: true, index: true },

  // 작업 정보
  keyword: { type: String, required: true },
  scheduledAt: { type: Date, required: true, index: true },

  // BullMQ 연결
  generateJobId: { type: String },  // BullMQ job ID
  publishJobId: { type: String },   // BullMQ job ID

  // 결과
  manuscriptId: { type: String },   // 생성된 원고 ID
  postUrl: { type: String },        // 발행된 포스트 URL

  // 상태
  status: {
    type: String,
    enum: ['pending', 'generating', 'generated', 'publishing', 'published', 'failed'],
    default: 'pending',
  },
  error: { type: String },

  // 타임스탬프
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
});
```

### 관계 다이어그램

```
Schedule (1) ───────< ScheduleJob (N)
    │                      │
    │                      │ manuscriptId
    │                      ▼
    │               Manuscript (원고 서버 DB)
    │
    └── accountId
```

---

## 4. 에러 처리

### 재시도 불가능한 에러

```typescript
const NON_RETRYABLE_ERRORS = [
  '계정 잠금',
  '비밀번호 오류',
  '캡차 필요',
  '존재하지 않는 계정',
];

// Worker에서
export async function processPublish(job: Job) {
  try {
    // ...
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // 재시도 불가능한 에러는 바로 실패 처리
    if (NON_RETRYABLE_ERRORS.some(e => message.includes(e))) {
      await updateJobStatus(job.data.jobId, 'failed', message);
      throw new UnrecoverableError(message); // BullMQ에서 재시도 안 함
    }

    throw error; // 일반 에러는 재시도
  }
}
```

---

## 5. 추가 기능 (기존 Python에서 이관)

### 5.1 ZIP 업로드 스케줄 발행

기존 Python: `routers/bot/upload_schedule.py`

```typescript
// POST /upload-schedule (multipart/form-data)
// ZIP 파일 업로드 → 원고 추출 → 스케줄 발행

interface UploadScheduleRequest {
  file: File;           // ZIP 파일
  accountId: string;
  password: string;
  startDate: string;    // "2025-01-07"
  startHour: number;    // 10
  postsPerDay: number;  // 3
  intervalHours: number; // 2
}

// ZIP 구조
// upload.zip
// ├── 키워드1/
// │   ├── 키워드1.txt   ← 첫 줄=제목, 나머지=본문
// │   └── 1.png, 2.png  ← 이미지
// └── 키워드2/
//     └── ...
```

### 5.2 로컬 이미지 업로드 (Playwright)

기존 Python: `routers/auth/blog_write.py`

```typescript
// 이미지를 부제 위치에 삽입

// 부제 패턴 감지
function isSubheading(line: string): boolean {
  const patterns = [
    /^\d+\.\s/,          // 1. 2. 3.
    /^[①②③④⑤⑥⑦⑧⑨⑩]/, // 원문자
    /^【\d+】/,          // 【1】【2】
    /^\[\d+\]/,          // [1] [2]
    /^▶\s*\d+/,          // ▶1 ▶2
  ];
  return patterns.some(p => p.test(line.trim()));
}

// 부제 순서대로 이미지 매핑
function matchImagesToSubheadings(
  paragraphs: string[],
  images: string[]
): Map<number, string> {
  const result = new Map();
  const subheadingIndices = paragraphs
    .map((p, i) => isSubheading(p) ? i : -1)
    .filter(i => i >= 0);

  subheadingIndices.forEach((idx, i) => {
    if (i < images.length) {
      result.set(idx, images[i]);
    }
  });

  return result;
}
```

### 5.3 큐 관리 API (추가 엔드포인트)

기존 Python: `routers/bot/queue.py`

```typescript
// 기획서에 없는 추가 API

// 진행중인 큐 목록
GET /queues
→ { count: 3, queues: [...] }

// 큐 상세
GET /queues/:id
→ { queueId, meta, manuscripts: [...] }

// 큐 생성 (원고 ID 지정)
POST /queues/create
{ manuscriptIds: ["001", "002"], accountId?, scheduleDate? }

// 전체 pending을 큐로
POST /queues/create-all
{ accountId?, scheduleDate? }

// 큐 발행 시작
POST /queues/:id/start
{ account: { id, password }, useSchedule: true, ... }

// 큐 삭제 (pending으로 복원)
DELETE /queues/:id
→ { restored: ["001", "002"] }
```

### 5.4 예약 시간 지났으면 즉시 발행

```typescript
// 발행 시점에 예약 시간이 이미 지났으면 즉시 발행으로 전환

function shouldPublishImmediately(scheduleTime?: Date): boolean {
  if (!scheduleTime) return true;
  return scheduleTime <= new Date();
}

// Worker에서
if (shouldPublishImmediately(scheduledAt)) {
  logger.warn('예약 시간 지남 → 즉시 발행', { scheduledAt });
  await writePost({ ...params, scheduleTime: undefined }); // 즉시
} else {
  await writePost({ ...params, scheduleTime: scheduledAt }); // 예약
}
```

### 5.5 파일 시스템 원고 관리 (선택)

기존 Python: 파일 시스템 기반
```
manuscripts/
├── pending/      ← 대기중 원고
├── completed/    ← 발행 완료
└── failed/       ← 발행 실패
```

Node.js: **MongoDB만 사용해도 됨** (더 간단)
- 파일 시스템 관리 복잡도 ↓
- 이미지는 S3 URL로 저장

---

## 6. 전체 API 명세 (정리)

### 스케줄

| Method | Path | 설명 |
|--------|------|------|
| POST | /schedules | 스케줄 생성 (키워드 기반) |
| GET | /schedules/:id | 스케줄 상세 |
| DELETE | /schedules/:id | 스케줄 취소 |
| POST | /upload-schedule | ZIP 업로드 스케줄 |

### 큐

| Method | Path | 설명 |
|--------|------|------|
| GET | /queues | 큐 목록 |
| GET | /queues/:id | 큐 상세 |
| POST | /queues/create | 큐 생성 |
| POST | /queues/create-all | 전체 pending → 큐 |
| POST | /queues/:id/start | 큐 발행 시작 |
| DELETE | /queues/:id | 큐 삭제 |

### 상태

| Method | Path | 설명 |
|--------|------|------|
| GET | /queues/stats | BullMQ 큐 통계 |
| GET | /health | 서버 상태 |

---

## 요약: 반드시 지켜야 할 것

| 항목 | 규칙 |
|------|------|
| **서버 역할** | 클라이언트 HTTP 요청을 받는 웹 API 서버 |
| **큐 타이밍** | generate는 즉시/선행, publish만 scheduledAt delay |
| **세션 캐싱** | Redis에 2시간 TTL, 실패 시 재로그인 |
| **데이터 모델** | Schedule ↔ ScheduleJob ↔ BullMQ jobId 연결 |
| **예약 시간 경과** | 이미 지난 시간이면 즉시 발행으로 전환 |
| **이미지 삽입** | 부제 패턴 감지 → 부제 아래에 이미지 삽입 |
