import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import mongoose from 'mongoose';
import { format } from 'date-fns';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';

const PLAN_PATH = '/tmp/goat-modify-single.json';

interface Plan {
  accountId: string;
  password: string;
  blogId: string;
  nickname: string;
  logNo: string;
  oldTitle: string;
  oldKeyword: string;
  newKeyword: string;
}

interface Manuscript { keyword: string; title: string; content: string }

const main = async () => {
  if (!existsSync(PLAN_PATH)) throw new Error(`plan not found: ${PLAN_PATH}`);
  const plan: Plan = JSON.parse(readFileSync(PLAN_PATH, 'utf-8'));

  const manuscriptPath = `/tmp/goat-manuscript-${plan.newKeyword}.json`;
  if (!existsSync(manuscriptPath)) throw new Error(`manuscript not found: ${manuscriptPath}`);
  const manuscript: Manuscript = JSON.parse(readFileSync(manuscriptPath, 'utf-8'));

  console.log(`단일 테스트 enqueue`);
  console.log(`  계정: ${plan.nickname} (${plan.accountId})`);
  console.log(`  logNo: ${plan.logNo}`);
  console.log(`  새 키워드: ${plan.newKeyword}`);
  console.log(`  title: ${manuscript.title}`);
  console.log(`  content: ${manuscript.content.length}자\n`);

  await mongoose.connect(process.env.MONGO_URI!);
  const scheduleDate = format(new Date(), 'yyyy-MM-dd');
  const scheduledAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();

  const schedule = await ScheduleModel.create({
    accountId: plan.accountId,
    service: 'modify-goat-single',
    ref: '',
    scheduleDate,
    generateImages: true,
    imageCount: 5,
    delayBetweenPostsSeconds: 10,
    totalJobs: 1,
    status: 'pending',
  });

  const scheduleJob = await ScheduleJobModel.create({
    scheduleId: schedule._id,
    keyword: plan.newKeyword,
    category: '한려담원',
    scheduledAt,
    slot: 1,
    status: 'pending',
  });

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const safeAccountId = plan.accountId.replace(/[^a-zA-Z0-9]/g, '_');
  const queueName = `generate_${safeAccountId}`;
  const queue = new Queue(queueName, { connection });

  const generateJob = await queue.add('generate', {
    scheduleId: schedule._id,
    scheduleJobId: scheduleJob._id,
    keyword: plan.newKeyword,
    category: '한려담원',
    account: { id: plan.accountId, password: plan.password, blogId: plan.blogId },
    service: 'modify-goat-single',
    ref: '',
    generateImages: true,
    imageCount: 5,
    imageSource: 'product',
    manuscriptType: 'hanryeodamwon',
    delayBetweenPostsSeconds: 10,
    scheduledAt,
    mode: 'update',
    logNo: plan.logNo,
    keywordCategory: '한려담원',
    blogName: plan.nickname,
    providedManuscript: {
      title: manuscript.title,
      content: manuscript.content,
    },
  }, {
    delay: Math.max(0, new Date(scheduledAt).getTime() - Date.now()),
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
  });

  await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, {
    generateJobId: String(generateJob.id),
  });

  console.log(`generate job enqueued`);
  console.log(`  scheduleId: ${schedule._id}`);
  console.log(`  jobId: ${generateJob.id}`);
  console.log(`  scheduledAt: ${scheduledAt}`);
  console.log(`  queue: ${queueName}`);

  await queue.close();
  await connection.quit();
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
