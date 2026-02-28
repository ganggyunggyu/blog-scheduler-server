# services — Business Logic Layer

## OVERVIEW

Functional services (no classes, no DI) handling scheduling, manuscript generation, auth, and blog operations.

## SERVICE MAP

| File | Responsibility |
|------|---------------|
| `schedule.service.ts` | Schedule calculation and persistence. `calculateSchedule()` computes time slots using date-fns KST math. `parseKeywordWithCategory()` extracts `keyword[category]` syntax. Creates Schedule + ScheduleJob[] in MongoDB. |
| `manuscript.service.ts` | Python API integration. `callManuscriptAPI()` calls `POST {MANUSCRIPT_API_URL}/generate/{type}`. Supports multiple engines: grok, keigo, hanryeodamwon, nyangnyang, kimdongpal. `prepareProductImages()` and `generateAndDownloadAIImages()` handle image orchestration. |
| `naver-auth.service.ts` | Naver login via Playwright. `naverLogin()` navigates to nid.naver.com, inputs credentials, detects captcha/2FA/lockout. `getValidCookies()` checks Redis cache first, fresh login only if needed. |
| `session.service.ts` | Redis session cache. `getSession()` / `saveSession()` / `invalidateSession()` with TTL (default 2h). `checkRateLimit()` enforces login rate limit (3 per 60s per account). |
| `naver-blog.service.ts` | Blog post operations via Playwright. `writePost()` creates new reservation post. `updatePost()` modifies existing post. `updatePostImages()` replaces images only. Orchestrates naver-editor modules. |
| `product-image.service.ts` | Image API integration. `getProductData()` fetches from IMAGE_API_URL. `downloadImagesToDir()` downloads images to `data/jobs/{timestamp}_{keyword}/images/`. |
| `schedule-failure.service.ts` | Account-level failure management. `failAccountSchedules()` marks all pending jobs for an account as failed when non-retryable error occurs (account lock, wrong password). |

## PATTERNS

- All services export plain arrow functions (no class instances)
- Each service file has `const log = logger.child({ scope: 'ServiceName' })` at top
- External API calls use axios with error wrapping
- Mongoose operations use the models from `schemas/schedule.schema.ts`

## ANTI-PATTERNS

- **NEVER** use `toISOString()` in schedule calculation — use date-fns `format()` with KST offset
- **NEVER** call manuscript/image APIs directly from workers — always go through service functions
- **NEVER** store passwords in MongoDB via services — passwords only in BullMQ job data
- **NEVER** retry login manually in service code — `getValidCookies()` handles cache + retry internally

## GOTCHAS

- `callManuscriptAPI()` response format: first line of `content` field = title, rest = body
- `getValidCookies()` returns cached cookies OR triggers fresh login — caller should not login directly
- `calculateSchedule()` distributes keywords across time slots respecting postsPerDay limit
- Image download creates directories under `data/jobs/` which is gitignored and can grow large
