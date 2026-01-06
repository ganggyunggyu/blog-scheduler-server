# 블로그 자동발행 스케줄링 서버 기획서

## 1. 프로젝트 개요

### 1.1 목적

기존 Python 블로그 분석기에서 자동발행/스케줄링 기능을 분리하여 Node.js 기반의 독립 서버로 구축

### 1.2 배경

- 현재 원고 생성(AI)과 스케줄링(Playwright)이 한 서버에 혼재
- 책임 분리 필요: 원고 생성은 stateless API, 스케줄링은 stateful 작업
- Playwright는 Node.js가 원조 → 더 안정적인 동작 기대

### 1.3 아키텍처

```
┌─────────────────────┐     HTTP      ┌─────────────────────┐
│   Scheduler Server  │ ───────────→  │  원고 생성 서버     │
│   (Node.js/Fastify) │               │     (Python)        │
└─────────────────────┘               └─────────────────────┘
         │                                     │
         │ Playwright                          │ AI API
         ▼                                     ▼
   ┌───────────┐                    ┌──────────────────┐
   │   Naver   │                    │ GPT/Claude/Grok  │
   │   Blog    │                    │    Gemini 등     │
   └───────────┘                    └──────────────────┘
         │
         │
         ▼
   ┌───────────┐
   │   Redis   │  ← 작업 큐 (BullMQ)
   └───────────┘
```

---

## 2. 기술 스택

### 2.1 Core

| 기술       | 버전   | 용도                         |
| ---------- | ------ | ---------------------------- |
| Node.js    | 20 LTS | 런타임                       |
| TypeScript | 5.x    | 타입 안정성                  |
| Fastify    | 5.x    | 웹 프레임워크 (경량, 고성능) |

### 2.2 스케줄링 & 큐

| 기술       | 용도                                        |
| ---------- | ------------------------------------------- |
| **BullMQ** | Redis 기반 작업 큐 (재시도, 지연, 우선순위) |
| **Redis**  | 큐 백엔드, 세션 캐시                        |

### 2.3 브라우저 자동화

| 기술           | 용도                         |
| -------------- | ---------------------------- |
| **Playwright** | 네이버 로그인, 블로그 글쓰기 |

### 2.4 데이터 & 검증

| 기술                   | 용도                |
| ---------------------- | ------------------- |
| **MongoDB** + Mongoose | 스케줄/큐 상태 저장 |
| **Zod**                | 런타임 스키마 검증  |

### 2.5 기타

| 기술         | 용도                      |
| ------------ | ------------------------- |
| **Axios**    | 원고 서버 API 호출        |
| **date-fns** | 날짜/시간 계산            |
| **PM2**      | 프로세스 관리, 클러스터링 |

### 2.6 Fastify 선택 이유

| 비교            | Express | NestJS | Fastify       |
| --------------- | ------- | ------ | ------------- |
| 성능            | 보통    | 보통   | **최고**      |
| 구조화          | 자유    | 강제   | 자유+플러그인 |
| 보일러플레이트  | 적음    | 많음   | **적음**      |
| 백그라운드 작업 | -       | -      | **적합**      |

- 스케줄링 서버는 요청 처리보다 백그라운드 작업 위주
- NestJS의 DI/모듈 오버헤드 불필요
- BullMQ는 프레임워크 독립적으로 동작

---

## 3. 핵심 기능

### 3.1 원고 생성 요청 (외부 API 호출)

```typescript
// 원고 서버(Python)에 HTTP 요청
POST http://원고서버:8000/generate/grok
{
  "service": "위고비",
  "keyword": "위고비 다이어트 효과",
  "ref": ""
}
```

### 3.2 네이버 로그인 (Playwright)

- headless: false (봇 탐지 우회)
- 쿠키 추출 → Redis에 캐싱 (세션 재사용)
- Rate limiting (분당 5회)

### 3.3 블로그 글쓰기 (Playwright)

- 쿠키 기반 인증
- 제목/본문/이미지 입력
- 예약발행 시간 설정
- 공개/비공개 설정

### 3.3.1 예약발행 방식 (v1: “미리 예약글 등록”)

- **BullMQ delay로 `scheduledAt`까지 기다리지 않는다.**
- 작업 실행 시점(지금)에는 Playwright로 네이버 글쓰기 화면에 들어가서 **예약발행 UI로 `scheduledAt`을 설정**하고 “예약 등록”까지 끝낸다.
- 따라서 서버가 `scheduledAt` 시각에 살아있을 필요가 없고(네이버가 예약 처리), 이 서버는 “스케줄 관리 + 예약 등록”에 집중한다.
- `scheduledAt`은 **KST(Asia/Seoul)** 기준으로 취급한다. (`TZ=Asia/Seoul` 권장)

### 3.4 스케줄 큐 (BullMQ)

```typescript
// 작업 큐 구조
{
  name: 'reserve', // 예약글 등록
  data: {
    accountId: 'user@naver.com',
    // 원고는 Python 서버에서 생성 후 title/content로 파싱 (첫 줄=제목)
    keyword: '위고비 다이어트 효과',
    scheduledAt: '2025-01-07T10:00:00+09:00', // KST 권장
  },
  opts: {
    attempts: 3,     // 실패 시 3회 재시도
    backoff: { type: 'exponential', delay: 60000 }
  }
}
```

### 3.5 배치 스케줄 생성

```typescript
// 입력: 키워드 10개, 하루 3개씩, 1-2시간 간격 랜덤으로
// 출력: 4일간 스케줄 자동 계산
[
  { keyword: '키워드1', scheduledAt: '2025-01-07T10:00' },
  { keyword: '키워드2', scheduledAt: '2025-01-07T12:00' },
  { keyword: '키워드3', scheduledAt: '2025-01-07T14:00' },
  { keyword: '키워드4', scheduledAt: '2025-01-08T10:00' },
  // ...
];
```

---

## 4. API 명세

### 4.1 스케줄 생성

```
POST /schedules
```

```json
{
  "service": "위고비",
  "ref": "",
  "queues": [
    {
      "account": { "id": "user@naver.com", "password": "..." },
      "keywords": ["키워드1", "키워드2", "키워드3"]
    }
  ],
  "startDate": "2025-01-07",
  "startHour": 10,
  "postsPerDay": 3,
  "intervalHours": 2,
  "generateImages": true,
  "imageCount": 5,
  "delayBetweenPostsSeconds": 10
}
```

### 4.2 스케줄 조회

```
GET /schedules/:id
GET /schedules?accountId=xxx&status=pending
```

### 4.3 스케줄 취소

```
DELETE /schedules/:id
```

> v1 기준: 아직 예약 등록이 안 된 작업은 취소 가능(큐 제거). 이미 네이버에 “예약글 등록”이 끝난 건 별도 Playwright 플로우가 필요하므로 우선 상태만 `canceled`로 마킹한다(추후 확장).

### 4.4 큐 상태 조회

```
GET /queues/stats
```

```json
{
  "generate": { "waiting": 5, "active": 1, "completed": 20, "failed": 2 },
  "reserve": { "waiting": 10, "active": 2, "completed": 50, "failed": 3 }
}
```

### 4.5 수동 실행

```
POST /schedules/:id/execute
```

### 4.6 Health Check

```
GET /health
```

```json
{
  "status": "ok",
  "timestamp": "2025-01-07T10:00:00.000Z"
}
```

---

## 5. 디렉토리 구조

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
├── test/
│   ├── e2e/
│   └── unit/
│
├── docker-compose.yml      # Redis + MongoDB
├── Dockerfile
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 6. 환경변수

```env
# 서버
PORT=3000
NODE_ENV=production
TZ=Asia/Seoul

# Redis (BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# MongoDB
MONGO_URI=mongodb://localhost:27017/scheduler

# 원고 생성 서버 (Python)
MANUSCRIPT_API_URL=http://localhost:8000

# Playwright
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_SLOW_MO=100
```

---

## 7. BullMQ 큐 설계

### 7.1 큐 종류

| 큐 이름    | 용도                            |
| ---------- | ------------------------------- |
| `generate` | 원고 생성 요청                  |
| `reserve`  | 네이버 예약글 등록 (Playwright) |

### 7.2 작업 흐름

```
1. POST /schedules 요청
   ↓
2. 스케줄 계산 (date-fns)
   ↓
3. generate 큐에 원고 생성 작업 추가
   ↓
4. Worker: 원고 서버 API 호출
   ↓
5. reserve 큐에 예약 등록 작업 추가 (delay 없음)
   ↓
6. Worker: Playwright로 “예약글 등록” (네이버 예약 UI)
   ↓
7. MongoDB에 결과 저장
```

### 7.3 재시도 정책

```typescript
{
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 60000  // 1분 → 2분 → 4분
  },
  removeOnComplete: 100,
  removeOnFail: 50
}
```

---

## 8. Playwright 셀렉터 (기존 Python에서 이관)

```typescript
// src/constants/selectors.ts
export const SELECTORS = {
  // 로그인
  login: {
    id: '#id',
    pw: '#pw',
    btn: '.btn_login',
    captcha: '#captcha',
  },

  // 블로그 에디터
  editor: {
    title: '.se-title-input',
    content: '.se-text-paragraph',
    imageUpload: 'input[type="file"]',
  },

  // 발행
  publish: {
    btn: "button.publish_btn__m9KHH, button[data-click-area='tpb.publish']",
    confirm: "button.confirm_btn__WEaBq, button[data-testid='seOnePublishBtn']",
    publicRadio: 'input#open_public',
    scheduleRadio: "label[for='radio_time2'], label.radio_label__mB6ia",
    hourSelect: 'select.hour_option__J_heO',
    minuteSelect: 'select.minute_option__Vb3xB',
    dateInput: 'input.input_date__QmA0s',
    datepickerNextMonth: 'button.ui-datepicker-next',
    datepickerPrevMonth: 'button.ui-datepicker-prev',
    datepickerYear: 'span.ui-datepicker-year',
    datepickerMonth: 'span.ui-datepicker-month',
  },

  // 팝업
  popup: {
    cancel: 'button.se-popup-button-cancel',
    helpClose: 'button.se-help-panel-close-button',
  },
};
```

---

## 9. 기존 Python 서버 수정사항

### 유지

- `/generate/*` 엔드포인트 모두 유지
- AI 서비스 로직 유지

### 제거 가능 (추후)

- `routers/bot/` 디렉토리 전체
- `routers/auth/naver.py`
- `routers/auth/blog_write.py`

### 추가 (선택)

- CORS 설정 (스케줄러 서버 허용)

---

## 10. 마이그레이션 계획

### Phase 1: 신규 서버 구축

1. Fastify 프로젝트 초기화
2. BullMQ + Redis 연동
3. Playwright 네이버 로그인/글쓰기 구현
4. 원고 서버 API 호출 서비스

### Phase 2: 테스트

1. 단위 테스트 (서비스)
2. E2E 테스트 (Playwright)
3. 부하 테스트 (큐 처리량)

### Phase 3: 운영

1. Docker Compose 배포
2. PM2 클러스터링
3. 모니터링 (Bull Board)

### Phase 4: 정리

1. Python 서버에서 bot 관련 코드 제거
2. 문서 정리

---

## 11. 참고 자료

- [Fastify 공식 문서](https://fastify.dev/)
- [BullMQ 공식 문서](https://docs.bullmq.io/)
- [Playwright 공식 문서](https://playwright.dev/)
- 기존 Python 코드: `routers/bot/`, `routers/auth/`
