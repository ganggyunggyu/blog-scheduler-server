import 'dotenv/config';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { format } from 'date-fns';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';

const LIST_PATH = '/tmp/goat-published-list.json';
const JOBS_DIR = path.resolve(process.cwd(), 'jobs');

interface Item {
  accountId: string;
  password: string;
  blogId: string;
  nickname: string;
  keyword: string;
  logNo: string;
  postUrl: string;
}

const createJobDir = (keyword: string): string => {
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2');
  const safe = keyword.replace(/[^\w가-힣]/g, '_').slice(0, 20);
  const dir = path.join(JOBS_DIR, `${ts}_${safe}_retitle`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    keyword, mode: 'modify-goat-retitle', createdAt: new Date().toISOString(), status: 'pending',
  }, null, 2));
  return dir;
};

const main = async () => {
  const list: Item[] = JSON.parse(readFileSync(LIST_PATH, 'utf-8'));
  const withMs = list.filter((it) => existsSync(`/tmp/goat-manuscript-${it.keyword}.json`));
  console.log(`list ${list.length}, 원고 준비 ${withMs.length}\n`);

  await mongoose.connect(process.env.MONGO_URI!);
  const scheduleDate = format(new Date(), 'yyyy-MM-dd');
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const startBase = Date.now() + 60 * 1000;
  const accOffset = new Map<string, number>();

  for (const it of withMs) {
    const ms = JSON.parse(readFileSync(`/tmp/goat-manuscript-${it.keyword}.json`, 'utf-8'));
    const jobDir = createJobDir(it.keyword);
    const offset = accOffset.get(it.accountId) ?? 0;
    accOffset.set(it.accountId, offset + 1);
    const scheduledAt = new Date(startBase + offset * 60 * 1000).toISOString();

    const schedule = await ScheduleModel.create({
      accountId: it.accountId, service: 'modify-goat-retitle', ref: '', scheduleDate,
      generateImages: true, imageCount: 5, delayBetweenPostsSeconds: 10,
      totalJobs: 1, status: 'pending',
    });
    const scheduleJob = await ScheduleJobModel.create({
      scheduleId: schedule._id, keyword: it.keyword, category: '한려담원',
      scheduledAt, slot: 1, status: 'pending',
    });

    const safeAcc = it.accountId.replace(/[^a-zA-Z0-9]/g, '_');
    const queue = new Queue(`generate_${safeAcc}`, { connection });
    const job = await queue.add('generate', {
      scheduleId: schedule._id, scheduleJobId: scheduleJob._id,
      keyword: it.keyword, category: '한려담원',
      account: { id: it.accountId, password: it.password, blogId: it.blogId },
      service: 'modify-goat-retitle', ref: '',
      generateImages: true, imageCount: 5, imageSource: 'product',
      manuscriptType: 'hanryeodamwon', delayBetweenPostsSeconds: 10,
      scheduledAt, mode: 'update', logNo: it.logNo,
      keywordCategory: '한려담원', blogName: it.nickname,
      providedManuscript: { title: ms.title, content: ms.content },
    }, {
      delay: Math.max(0, new Date(scheduledAt).getTime() - Date.now()),
      attempts: 3, backoff: { type: 'exponential', delay: 30000 },
    });
    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, { generateJobId: String(job.id) });
    console.log(`  ${it.nickname.padEnd(14)} kw=${it.keyword.padEnd(14)} title="${ms.title}" logNo=${it.logNo}`);
    await queue.close();
  }

  await connection.quit();
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
