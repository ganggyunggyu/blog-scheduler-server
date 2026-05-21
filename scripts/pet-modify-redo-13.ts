import 'dotenv/config';
import mongoose from 'mongoose';
import { format } from 'date-fns';
import type { Queue } from 'bullmq';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';
import { formatKst } from '../src/services/schedule.service.js';
import { buildScheduleGenerateJobId } from '../src/services/schedule-idempotency.service.js';
import { getGenerateQueue, closeAllQueues } from '../src/queues/queue-manager.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const SERVICE = 'pet-modify-redo';
const REF = '2026-05-21-redo';
const CATEGORY = '애견';
const KEYWORD_CATEGORY = '애견';
const MANUSCRIPT_TYPE = 'default';
const IMAGE_SOURCE = 'product';
const IMAGE_COUNT = 5;
const DELAY_BETWEEN_POSTS_SECONDS = 10;
const MONITOR_INTERVAL_MS = 30_000;
const MONITOR_TIMEOUT_MS = 4 * 60 * 60 * 1000;

interface Entry {
  blogId: string;
  keyword: string;
  logNo: string;
}

const ENTRIES: Entry[] = [
  { blogId: 'k7d9x2m4', keyword: '닥스훈트', logNo: '224291818922' },
  { blogId: 'k7d9x2m4', keyword: '강아지품종', logNo: '224291821391' },
  { blogId: 'fail5644', keyword: '검은고양이', logNo: '224291822471' },
  { blogId: 'fail5644', keyword: '도베르만', logNo: '224291819650' },
  { blogId: 'n7c3w8z2', keyword: '애견', logNo: '224291820762' },
  { blogId: 'compare14310', keyword: '랙돌분양가', logNo: '224291819288' },
  { blogId: 'respawnking9', keyword: '포메라니안분양', logNo: '224291819694' },
  { blogId: 'ahffkdlek12', keyword: '강아지종류', logNo: '224291822249' },
  { blogId: 'ahsxkfldk12', keyword: '러시안블루분양', logNo: '224291822480' },
  { blogId: 'ahsxkfldk12', keyword: '말티즈', logNo: '224291819617' },
  { blogId: 'ghostrush7', keyword: '말티푸분양가', logNo: '224291819396' },
  { blogId: 'ghostrush7', keyword: '골든두들', logNo: '224291822315' },
  { blogId: 'ahfflwl123', keyword: '고양이종류', logNo: '224291820240' },
];

interface AccountDoc {
  accountId: string;
  password: string;
  blogId?: string;
  nickname?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const resolveAccounts = async (blogIds: string[]): Promise<Map<string, AccountDoc>> => {
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const docs = await cafeDb
    .collection<AccountDoc & { isActive?: boolean }>('accounts')
    .find(
      { $or: [{ accountId: { $in: blogIds } }, { blogId: { $in: blogIds } }] },
      { projection: { accountId: 1, password: 1, blogId: 1, nickname: 1 } },
    )
    .toArray();

  const byBlogId = new Map<string, AccountDoc>();
  for (const doc of docs) {
    const key = doc.blogId || doc.accountId;
    byBlogId.set(key, doc);
  }

  const missing = blogIds.filter((id) => !byBlogId.get(id)?.password);
  if (missing.length > 0) {
    throw new Error(`계정 또는 비밀번호 없음: ${missing.join(', ')}`);
  }
  return byBlogId;
};

const addGenerateJob = async (
  queue: Queue,
  account: AccountDoc,
  scheduleId: string,
  scheduleJobId: string,
  entry: Entry,
  scheduledAt: string,
  jobId: string,
): Promise<void> => {
  const generateJob = await queue.add(
    'generate',
    {
      scheduleId,
      scheduleJobId,
      keyword: entry.keyword,
      category: CATEGORY,
      account: {
        id: account.accountId,
        password: account.password,
        blogId: account.blogId || account.accountId,
      },
      service: SERVICE,
      ref: REF,
      generateImages: true,
      imageCount: IMAGE_COUNT,
      imageSource: IMAGE_SOURCE,
      manuscriptType: MANUSCRIPT_TYPE,
      delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
      scheduledAt,
      mode: 'update',
      logNo: entry.logNo,
      keywordCategory: KEYWORD_CATEGORY,
      blogName: account.nickname || account.accountId,
    },
    { jobId },
  );

  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
    generateJobId: String(generateJob.id),
    status: 'pending',
    $unset: { error: 1, completedAt: 1 },
  });
};

const queueEntry = async (account: AccountDoc, entry: Entry): Promise<string> => {
  const scheduleDate = format(new Date(), 'yyyy-MM-dd');
  const queue = getGenerateQueue(account.accountId);
  const scheduledAt = formatKst(new Date());

  const schedule = await ScheduleModel.create({
    accountId: account.accountId,
    service: SERVICE,
    ref: `${REF}-${entry.keyword}-${Date.now()}`,
    scheduleDate,
    generateImages: true,
    imageCount: IMAGE_COUNT,
    delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
    totalJobs: 1,
    status: 'pending',
  });

  const scheduleJob = await ScheduleJobModel.create({
    scheduleId: schedule._id,
    keyword: entry.keyword,
    category: CATEGORY,
    scheduledAt,
    slot: 1,
    status: 'pending',
  });

  await addGenerateJob(
    queue,
    account,
    String(schedule._id),
    String(scheduleJob._id),
    entry,
    scheduledAt,
    buildScheduleGenerateJobId(String(scheduleJob._id)),
  );

  console.log(`[queued] ${account.nickname || account.accountId} kw=${entry.keyword} logNo=${entry.logNo}`);
  return String(schedule._id);
};

const waitForSchedule = async (scheduleId: string, label: string): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MONITOR_TIMEOUT_MS) {
    const jobs = await ScheduleJobModel.find({ scheduleId }, { status: 1 });
    const total = jobs.length;
    const published = jobs.filter((j) => j.status === 'published').length;
    const failed = jobs.filter((j) => j.status === 'failed').length;
    if (total > 0 && published + failed >= total) {
      console.log(`[done] ${label} published=${published} failed=${failed}`);
      return;
    }
    await sleep(MONITOR_INTERVAL_MS);
  }
  throw new Error(`타임아웃: ${label}`);
};

const processAccountSequential = async (
  account: AccountDoc,
  entries: Entry[],
): Promise<void> => {
  for (const entry of entries) {
    const scheduleId = await queueEntry(account, entry);
    await waitForSchedule(scheduleId, `${account.nickname}/${entry.keyword}`);
  }
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);

  const blogIds = [...new Set(ENTRIES.map((e) => e.blogId))];
  const accounts = await resolveAccounts(blogIds);

  const groups = new Map<string, Entry[]>();
  for (const entry of ENTRIES) {
    const list = groups.get(entry.blogId) ?? [];
    list.push(entry);
    groups.set(entry.blogId, list);
  }

  await Promise.all(
    [...groups.entries()].map(([blogId, entries]) => {
      const account = accounts.get(blogId);
      if (!account) {
        console.error(`[skip] blogId=${blogId} 계정 없음`);
        return Promise.resolve();
      }
      return processAccountSequential(account, entries);
    }),
  );
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
