# queues — BullMQ Job Processing

## OVERVIEW

Per-account isolated BullMQ queues with generate→publish two-phase pipeline.

## FILE MAP

| File | Purpose |
|------|---------|
| `queue-manager.ts` | Queue/worker lifecycle: create, close, get stats. Dynamic queue creation per account. Exports: `getOrCreateQueues()`, `closeAllQueues()`, `getAllQueues()`, `initializeExistingQueues()` |
| `generate.worker.ts` | Phase 1 worker: login precheck → call manuscript API → download images → enqueue publish job. Updates ScheduleJob status: `pending→generating→generated` |
| `publish.worker.ts` | Phase 2 worker: get cookies → Playwright writePost/updatePost/updatePostImages → update ScheduleJob status: `generated→publishing→published`. Handles 3 modes: create, update, image-replace |
| `constants.ts` | Queue names (GENERATE, PUBLISH), default job options (3 attempts, exponential backoff 60s), non-retryable error patterns |
| `index.ts` | Barrel export for queue-manager functions |

## QUEUE ARCHITECTURE

- **Dynamic queue names**: `generate_{safeAccountId}`, `publish_{safeAccountId}` — safeAccountId replaces `@` and `.` with `_`
- **Concurrency**: 1 for both queues (sequential per account, parallel across accounts)
- **Job options**: 3 attempts, exponential backoff starting at 60s, keep 100 completed / 50 failed
- **Throttling**: generate worker enqueues publish job with `delay: delayBetweenPostsSeconds * 1000`

## JOB DATA CONTRACTS

```ts
type GenerateJobData = {
  scheduleId: string;
  scheduleJobId: string;
  keyword: string;
  category?: string;
  account: { id: string; password: string; blogId?: string };
  service: string;
  ref: string;
  generateImages: boolean;
  imageCount: number;
  delayBetweenPostsSeconds: number;
  scheduledAt: string; // ISO with +09:00 offset
  mode: 'create' | 'update' | 'image-replace';
};

type PublishJobData = {
  scheduleId: string;
  scheduleJobId: string;
  account: { id: string; password: string; blogId?: string };
  manuscript: { title: string; content: string; images: string[] };
  scheduledAt: string;
  mode: 'create' | 'update' | 'image-replace';
  category?: string;
  metadata?: Record<string, unknown>;
};
```

## ERROR HANDLING

- **Non-retryable patterns** (immediate fail, no retry): `계정 잠금`, `비밀번호 오류`, `캡차 필요`, `존재하지 않는 계정`
- `failAccountSchedules()` called on non-retryable auth errors — fails ALL pending jobs for that account
- On generate failure: `ScheduleJob.status → 'failed'`, `Schedule.failedJobs++`
- On publish failure with retries remaining: BullMQ auto-retries with exponential backoff
- On final failure: Schedule checked for completion — all jobs done → status `'completed'` or `'failed'`

## ANTI-PATTERNS

- **NEVER** use `delay` to align with `scheduledAt` — delay is ONLY for throttling between consecutive posts
- **NEVER** pass passwords outside job data — passwords live only in Redis job payload, never logged
- **NEVER** increase concurrency above 1 without testing — Naver rate-limits aggressively
