import 'dotenv/config';
import mongoose from 'mongoose';
import type { Queue } from 'bullmq';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';
import { buildScheduleGenerateJobId } from '../src/services/schedule-idempotency.service.js';
import { getGenerateQueue, closeAllQueues } from '../src/queues/queue-manager.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const SERVICE = 'alibaba-20260528-repair';
const REF = 'bottom-image-spacing-fix';
const CATEGORY = '기타';
const IMAGE_COUNT = 5;
const DELAY_BETWEEN_POSTS_SECONDS = 10;
const MONITOR_INTERVAL_MS = 30_000;
const MONITOR_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const SCHEDULED_AT_BASE = '2026-05-28T15:00:00+09:00';

interface RepairTarget {
  keyword: string;
  logNo: string;
}

const TARGETS = new Map<string, RepairTarget[]>([
  ['rqr1io45', [
    { keyword: '글로벌소싱', logNo: '224299041992' },
    { keyword: '해외직구관세납부방법', logNo: '224299047493' },
    { keyword: '배대지 사이트', logNo: '224299051974' },
  ]],
  ['weed3122', [
    { keyword: '타오바오할인코드', logNo: '224299040973' },
    { keyword: '타오바오 구매방법', logNo: '224299045198' },
    { keyword: '타오바오한국직배송', logNo: '224299048669' },
  ]],
  ['mad1651', [
    { keyword: '타오바오할인코드', logNo: '224299050358' },
    { keyword: '타오바오 구매방법', logNo: '224299039889' },
    { keyword: '타오바오한국직배송', logNo: '224299044027' },
  ]],
  ['individual14144', [
    { keyword: '타오바오할인코드', logNo: '224299041302' },
    { keyword: '타오바오 구매방법', logNo: '224299045314' },
    { keyword: '타오바오한국직배송', logNo: '224299050160' },
  ]],
  ['heavymouse448', [
    { keyword: '글로벌소싱', logNo: '224299041916' },
    { keyword: '해외직구관세납부방법', logNo: '224299046160' },
    { keyword: '배대지 사이트', logNo: '224299050493' },
  ]],
  ['crvfwy7062', [
    { keyword: '글로벌소싱', logNo: '224299041531' },
    { keyword: '해외직구관세납부방법', logNo: '224299046007' },
    { keyword: '배대지 사이트', logNo: '224299051445' },
  ]],
]);

interface AccountDoc {
  accountId: string;
  password: string;
  blogId?: string;
  nickname?: string;
  isActive?: boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const scheduledAtForSlot = (slot: number): string => {
  const date = new Date(SCHEDULED_AT_BASE);
  date.setMinutes(date.getMinutes() + (slot - 1) * 10);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00+09:00`;
};

const resolveAccounts = async (): Promise<AccountDoc[]> => {
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const ids = [...TARGETS.keys()];
  const accounts = await cafeDb.collection<AccountDoc>('accounts')
    .find(
      {
        accountId: { $in: ids },
        isActive: { $ne: false },
      },
      {
        projection: {
          accountId: 1,
          password: 1,
          blogId: 1,
          nickname: 1,
          isActive: 1,
        },
      },
    )
    .toArray();

  const byId = new Map(accounts.map((account) => [account.accountId, account]));
  const missing = ids.filter((id) => !byId.get(id)?.password);
  if (missing.length > 0) {
    throw new Error(`계정 또는 비밀번호 없음: ${missing.join(', ')}`);
  }

  return ids.map((id) => byId.get(id)!);
};

const addGenerateJob = async (
  queue: Queue,
  account: AccountDoc,
  scheduleId: string,
  scheduleJobId: string,
  target: RepairTarget,
  slot: number,
): Promise<void> => {
  const accountId = account.accountId;
  const blogId = account.blogId || accountId;
  const scheduledAt = scheduledAtForSlot(slot);

  const generateJob = await queue.add('generate', {
    scheduleId,
    scheduleJobId,
    keyword: target.keyword,
    category: CATEGORY,
    account: {
      id: accountId,
      password: account.password,
      blogId,
    },
    service: SERVICE,
    ref: REF,
    generateImages: true,
    imageCount: IMAGE_COUNT,
    imageSource: 'product',
    manuscriptType: 'alibaba',
    delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
    scheduledAt,
    mode: 'update',
    logNo: target.logNo,
    keywordCategory: CATEGORY,
    blogName: account.nickname || accountId,
  }, {
    jobId: buildScheduleGenerateJobId(scheduleJobId),
  });

  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
    generateJobId: String(generateJob.id),
    status: 'pending',
    $unset: { error: 1, completedAt: 1 },
  });
};

const createAccountSchedule = async (account: AccountDoc): Promise<string> => {
  const targets = TARGETS.get(account.accountId);
  if (!targets?.length) {
    throw new Error(`repair target 없음: ${account.accountId}`);
  }

  const existing = await ScheduleModel.findOne({
    accountId: account.accountId,
    service: SERVICE,
    ref: REF,
  }).lean<{ _id: string; status: string }>();

  if (existing) {
    await ScheduleJobModel.deleteMany({ scheduleId: existing._id, status: { $ne: 'publishing' } });
    await ScheduleModel.findByIdAndUpdate(existing._id, {
      status: 'pending',
      completedJobs: 0,
      failedJobs: 0,
      totalJobs: targets.length,
    });
  }

  const schedule = existing
    ? await ScheduleModel.findById(existing._id)
    : await ScheduleModel.create({
      accountId: account.accountId,
      service: SERVICE,
      ref: REF,
      scheduleDate: '2026-05-28',
      generateImages: true,
      imageCount: IMAGE_COUNT,
      delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
      totalJobs: targets.length,
      status: 'pending',
    });

  if (!schedule) {
    throw new Error(`schedule 생성 실패: ${account.accountId}`);
  }

  const queue = getGenerateQueue(account.accountId);

  for (let index = 0; index < targets.length; index += 1) {
    const slot = index + 1;
    const target = targets[index];
    const scheduleJob = await ScheduleJobModel.create({
      scheduleId: schedule._id,
      keyword: target.keyword,
      category: CATEGORY,
      scheduledAt: scheduledAtForSlot(slot),
      slot,
      status: 'pending',
    });

    await addGenerateJob(queue, account, String(schedule._id), String(scheduleJob._id), target, slot);
    console.log(`[queued] ${account.nickname || account.accountId} ${slot}/${targets.length} logNo=${target.logNo} kw=${target.keyword}`);
  }

  return String(schedule._id);
};

const summarize = async (scheduleIds: string[]): Promise<{ done: boolean; text: string }> => {
  const jobs = await ScheduleJobModel.find(
    { scheduleId: { $in: scheduleIds } },
    { status: 1 },
  );

  const counts = new Map<string, number>();
  for (const job of jobs) {
    counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  }

  const total = jobs.length;
  const published = counts.get('published') ?? 0;
  const failed = counts.get('failed') ?? 0;
  const generating = counts.get('generating') ?? 0;
  const generated = counts.get('generated') ?? 0;
  const publishing = counts.get('publishing') ?? 0;
  const pending = counts.get('pending') ?? 0;
  const done = total > 0 && published + failed >= total;
  const text = `total=${total} published=${published} failed=${failed} pending=${pending} generating=${generating} generated=${generated} publishing=${publishing}`;

  return { done, text };
};

const waitForCompletion = async (scheduleIds: string[]): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MONITOR_TIMEOUT_MS) {
    const summary = await summarize(scheduleIds);
    console.log(`[monitor] ${summary.text}`);
    if (summary.done) {
      return;
    }
    await sleep(MONITOR_INTERVAL_MS);
  }

  throw new Error('수정 작업 모니터링 타임아웃');
};

const main = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URI!);
  const accounts = await resolveAccounts();
  const scheduleIds: string[] = [];

  for (const account of accounts) {
    const scheduleId = await createAccountSchedule(account);
    scheduleIds.push(scheduleId);
  }

  await waitForCompletion(scheduleIds);
};

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[fatal] ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllQueues().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  });
