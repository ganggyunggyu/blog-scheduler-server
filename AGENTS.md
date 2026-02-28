# scheduler-server — Project Knowledge Base

**Generated:** 2026-02-24 | **Commit:** 651f62c | **Branch:** main

## OVERVIEW

Naver Blog 예약 발행 자동화 서버. Fastify HTTP API → BullMQ 큐(generate/publish) → Playwright(Chromium)로 네이버 블로그 예약 등록. 원고 생성은 외부 Python 서버(`blog_analyzer`) 위임.

## STRUCTURE

```
scheduler-server/
├── src/
│   ├── server.ts              # Entry point, graceful shutdown
│   ├── app.ts                 # Fastify factory, BullBoard, route registration
│   ├── config/                # env(Zod), mongo, redis connections
│   ├── constants/             # CSS selectors, account presets
│   ├── lib/
│   │   ├── browser/           # Singleton Playwright browser instance
│   │   ├── logging/           # Custom structured logger (pino-like)
│   │   ├── naver-editor/      # ★ 15-module Playwright UI automation library → has AGENTS.md
│   │   └── utils/             # Progress bar
│   ├── queues/                # ★ BullMQ queue manager + workers → has AGENTS.md
│   ├── routes/                # Fastify route handlers (schedule, queue)
│   ├── schemas/               # Mongoose models + Zod DTOs
│   ├── services/              # ★ Business logic (schedule, manuscript, auth, blog) → has AGENTS.md
│   └── types/                 # ProductMetadata interfaces
├── test/
│   ├── unit/                  # node:test — schedule calculation
│   ├── integration/           # auth, manuscript, product-image, category
│   └── e2e/                   # editor write, publish pipeline, multi-upload
├── data/jobs/                 # Runtime: downloaded images per job (gitignored)
├── scripts/                   # One-off utilities (DOM explorer, category upload)
├── Dockerfile                 # Node 20 Alpine, multi-stage
└── docker-compose.yml         # scheduler + Redis 7 + MongoDB 7
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| API endpoints 추가/수정 | `src/routes/` | Fastify plugin pattern, Zod validation in `schemas/dto.ts` |
| 큐/워커 수정 | `src/queues/` | Per-account 큐 격리, see queues/AGENTS.md |
| 네이버 에디터 자동화 | `src/lib/naver-editor/` | 15 modules, see naver-editor/AGENTS.md |
| 스케줄 계산 로직 | `src/services/schedule.service.ts` | KST date math with date-fns |
| 원고 생성 연동 | `src/services/manuscript.service.ts` | Python API contract |
| 로그인/세션 | `src/services/naver-auth.service.ts` + `session.service.ts` | Redis cookie cache, rate limiting |
| CSS 셀렉터 변경 | `src/constants/selectors.ts` | 네이버 UI 변경 시 여기만 수정 |
| 환경변수 추가 | `src/config/env.ts` | Zod schema, startup 시 validation |
| Mongoose 모델 변경 | `src/schemas/schedule.schema.ts` | Schedule + ScheduleJob |
| 테스트 추가 | `test/{unit,integration,e2e}/` | `node:test` + `tsx`, no Jest |

## DATA FLOW

```
POST /schedules
  → schedule.service.calculateSchedule() → MongoDB(Schedule + ScheduleJob[])
  → enqueue generate jobs (per keyword, per account)

generate worker (concurrency=1 per account):
  → naverLogin() precheck (cookie cache or fresh login)
  → manuscript.service.callManuscriptAPI() → Python server
  → product-image.service (download images to data/jobs/)
  → enqueue publish job

publish worker (concurrency=1 per account):
  → getValidCookies() → Playwright browser context
  → naver-blog.service.writePost() → lib/naver-editor/*
  → set reservation time via datepicker → confirm publish
  → update ScheduleJob(status=published, postUrl)
```

## CONVENTIONS

- **ESM only** — `"type": "module"` in package.json, all imports use `.js` extension
- **Arrow functions** — No `function` keyword. `const fn = () => {}`
- **Functional services** — No classes, no DI container. Pure functions with side effects
- **Logger pattern** — `const log = logger.child({ scope: 'ModuleName' })` at module top
- **Barrel exports** — Only in `routes/index.ts`, `queues/index.ts`, `lib/naver-editor/index.ts`
- **ID format** — `sch_<uuid>` for schedules, `job_<uuid>` for jobs
- **Testing** — `node:test` (built-in), run with `tsx --test`. No Jest/Vitest

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** `toISOString()` for business times — converts to UTC, causes KST drift. Use ISO with offset: `2025-01-07T10:00:00+09:00`
- **NEVER** persist passwords in MongoDB — passwords only in BullMQ job data (Redis), never logged
- **NEVER** use BullMQ `delay` for time alignment — only for throttling between posts
- **NEVER** implement LLM/generation logic here — call Python `blog_analyzer` server
- **NEVER** wait for `scheduledAt` to run job — jobs run immediately, set reservation UI to `scheduledAt`
- **NEVER** `as any`, `@ts-ignore`, `@ts-expect-error`

## UNIQUE STYLES

- **Per-account queue isolation** — Dynamic queue names: `generate_{safeAccountId}`, `publish_{safeAccountId}`
- **Non-retryable error detection** — `계정 잠금`, `비밀번호 오류`, `캡차 필요`, `존재하지 않는 계정` → job fails immediately, no retry
- **Singleton browser + per-job context** — One Chromium instance, each job gets fresh `BrowserContext`
- **Account presets** — `constants/account-presets.ts` maps account IDs to category/blogId/mvpn metadata
- **Keyword parsing** — `keyword[category]` syntax supported (e.g. `스마일라식[건강]`)

## COMMANDS

```bash
pnpm dev              # tsx watch src/server.ts (hot reload)
pnpm build            # tsc -p tsconfig.build.json → dist/
pnpm start            # node dist/server.js
pnpm test             # tsx --test test/unit/**/*.test.ts
pnpm typecheck        # tsc (no emit, type validation only)
```

## EXTERNAL DEPENDENCIES

| Service | URL (env var) | Purpose |
|---------|---------------|---------|
| Python manuscript server | `MANUSCRIPT_API_URL` (default: localhost:8000) | `POST /generate/{type}` — 원고 생성 |
| Image API | `IMAGE_API_URL` (default: localhost:3001) | `POST /api/image/*` — 이미지 생성/검색 |
| MongoDB | `MONGO_URI` (required, no default) | Schedule + ScheduleJob persistence |
| Redis | `REDIS_HOST:REDIS_PORT` (default: localhost:6379) | BullMQ queues + session cache |

## NOTES

- `TZ=Asia/Seoul` is set at process level in `config/env.ts` — all Date operations assume KST
- BullBoard admin UI at `/admin/queues` — visual queue monitoring
- Graceful shutdown order: HTTP → Queues → Browser → Redis → MongoDB
- `data/jobs/` contains downloaded images per job run — large, gitignored
- Docker build: `docker-compose up` starts scheduler + Redis + MongoDB
- Playwright `PLAYWRIGHT_HEADLESS=false` by default in dev (for debugging)
- Session TTL: 2 hours. Rate limit: 3 logins per 60s per account
