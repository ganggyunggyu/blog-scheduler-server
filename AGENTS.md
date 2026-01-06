# blog-bot (scheduler-server) — Implementation Guide for Codex

## 0) Goal
Build a new Node.js service under `scheduler-server/` that:
- Manages schedules for Naver Blog posting
- Uses Playwright (Chromium) to **pre-register reservation posts immediately** (v1)
- Calls the existing Python server (`blog_analyzer`) for manuscript generation (and optionally image generation)

This repo (`blog-bot`) contains only the planning docs right now:
- `scheduler-server-spec.md` (product/spec)
- `scheduler-server-prompt.md` (agent prompt / scaffold)

## 1) Key Decisions (v1)
### 1.1 Reservation strategy (must-follow)
- **Do NOT wait until `scheduledAt` to run a job.**
- When a job runs, Playwright opens Naver’s write page and sets the **reservation UI** to `scheduledAt`, then submits the reservation.
- The scheduler server is responsible for “schedule management + reservation registration”, not “publishing at exact time”.

### 1.2 Timezone and datetime format
- Treat all schedule times as **KST (Asia/Seoul)**.
- Set process timezone: `TZ=Asia/Seoul`.
- When storing/transporting times use an ISO string **with offset** (e.g. `2025-01-07T10:00:00+09:00`).
- Avoid `toISOString()` for business times (it converts to UTC and causes drift).

### 1.3 Queue design
Use BullMQ + Redis with two queues:
- `generate`: call Python manuscript server, parse `title/content`, prepare images (download to local files if needed)
- `reserve`: login (cookie reuse) + Playwright reservation registration

Important:
- BullMQ `delay` may be used **only for throttling** (e.g., spacing reservations), not to align with `scheduledAt`.
- Keep Playwright concurrency low (start with `concurrency=1` for `reserve` worker).

## 2) Scope Split (Python vs Node)
### 2.1 Python server (blog_analyzer)
The scheduler server must treat the Python server as an external dependency.

Use it for:
- Manuscript generation (example): `POST {MANUSCRIPT_API_URL}/generate/grok` with `{ service, keyword, ref }`
  - Contract: response contains `content` (assume “first line = title, rest = body”)
- (Optional) Image generation: `POST {MANUSCRIPT_API_URL}/generate/image` with `{ keyword }` (and optional `category`)
  - Response: image URLs (permanent); scheduler server downloads them to local temp files for Playwright upload (download can be deferred until reservation execution)

Do NOT implement LLM generation logic inside the Node scheduler.

### 2.2 Node scheduler-server
Owns:
- Schedule calculation and persistence
- Queueing and retries
- Session/cookie caching
- Naver UI automation via Playwright

## 3) Public API (scheduler-server)
Implement these endpoints (Fastify):
- `POST /schedules`
  - Creates schedules for one or more accounts and enqueues jobs immediately.
  - Request body (v1):
    - `service` (string, default `"default"`)
    - `ref` (string, default `""`)
    - `queues`: `{ account: { id, password }, keywords: string[] }[]`
    - `startDate` (`YYYY-MM-DD`), `startHour`, `postsPerDay`, `intervalHours`
    - `generateImages` (boolean), `imageCount` (number)
    - `delayBetweenPostsSeconds` (number, throttle only)
- `GET /schedules/:id` (load schedule status and items)
- `DELETE /schedules/:id`
  - v1 behavior:
    - If not yet reserved: remove pending jobs + mark schedule/items as `canceled`
    - If already reserved on Naver: mark as `canceled` only (true remote cancellation is a later feature)
- `POST /schedules/:id/execute` (optional; manually triggers immediate reservation registration for pending items)
- `GET /queues/stats` (BullMQ job counts per queue)
- `GET /health`

## 4) Data Model (MongoDB)
Persist schedules and per-item execution results.

Minimum fields:
- Schedule:
  - `status`: `pending | processing | completed | partial | failed | canceled`
  - `service`, `ref`, schedule settings, account id (masked), created/updated timestamps
- ScheduleItem:
  - `keyword`, `scheduledAt` (KST string), `day`, `slot`
  - `status`: `pending | generating | generated | reserving | reserved | failed | canceled`
  - BullMQ `generateJobId` / `reserveJobId`
  - result fields: `postUrl` (if available), error message, timestamps

Security rule:
- Do not persist raw passwords in MongoDB.
- If passwords must be used, keep them only in BullMQ job data (Redis) and never log them.

## 5) Playwright Automation Requirements
Port behavior from `blog_analyzer` (baseline references):
- Login: `blog_analyzer/routers/auth/naver.py`
- Write/reservation: `blog_analyzer/routers/auth/blog_write.py`

Implementation requirements:
- Use `https://blog.naver.com/GoBlogWrite.naver` and `mainFrame`.
- Handle popups before typing.
- Reservation flow:
  - Open publish overlay
  - Set visibility
  - Activate reservation mode (schedule radio)
  - Set date via datepicker if target date != today
  - Set time via hour/minute selects (minute rounded down to 10)
  - Confirm reservation
- Images:
  - Download URLs to local files
  - Upload via Playwright file chooser
  - v1 can keep it simple (upload sequentially), but if matching current behavior is required, port:
    - subheading detection
    - image-to-subheading mapping and insertion

Operational constraints:
- Close contexts/pages deterministically.
- Prefer a singleton `Browser` with per-job `BrowserContext`.
- Start with low concurrency and add rate limiting (per account and/or per IP) if needed.

## 6) Implementation Checklist (preferred order)
1. Scaffold `scheduler-server/` with TypeScript + Fastify + Zod env validation.
2. Add Redis + BullMQ queues (`generate`, `reserve`) and worker bootstrap.
3. Add MongoDB connection + Mongoose models for schedules.
4. Implement `schedule.service` to calculate and persist schedule items (KST-safe).
5. Implement `manuscript.service`:
   - call Python generate endpoint
   - parse `title/content`
   - call image endpoint and store image URLs (download to temp files only when running Playwright)
6. Implement `naver-auth.service` + Redis cookie cache (TTL).
7. Implement `naver-blog.service` reservation writer (ported UI logic).
8. Implement routes (`/schedules`, `/queues/stats`, `/health`) with consistent error handling.
9. Add minimal unit tests only for schedule calculation (no Playwright E2E unless explicitly requested).

Recommended execution timing (v1):
- Prefer generating manuscripts **right before the reservation registration job runs** (freshness + less waste), but ensure the job runs with enough buffer for retries (e.g. schedule a `reserveAt = scheduledAt - LEAD_TIME` in later versions).
- If a job is retried after generation succeeded, reuse the stored result (persist `manuscriptId/title/content/imageUrls` on the schedule item) to avoid regenerating.

## 7) Local execution rules
- Do not start servers, previews, or browsers unless the user explicitly asks.
- Network operations (package installs, downloads) may require approval depending on the environment.
