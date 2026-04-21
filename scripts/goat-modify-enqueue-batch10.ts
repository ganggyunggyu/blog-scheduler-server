import 'dotenv/config';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { format } from 'date-fns';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';

const PLAN_PATH = '/tmp/goat-today-batch.json';
const JOBS_DIR = path.resolve(process.cwd(), 'jobs');
const LIMIT = Number(process.argv[2] ?? 10);

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

const createJobDir = (keyword: string): string => {
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2');
  const safe = keyword.replace(/[^\w가-힣]/g, '_').slice(0, 20);
  const dir = path.join(JOBS_DIR, `${ts}_${safe}_modify`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    keyword, mode: 'modify-goat-batch', createdAt: new Date().toISOString(), status: 'pending',
  }, null, 2));
  return dir;
};

const main = async () => {
  const all: Plan[] = JSON.parse(readFileSync(PLAN_PATH, 'utf-8'));
  // 원고 준비된 것만
  const withMs = all.filter((p) => existsSync(`/tmp/goat-manuscript-${p.newKeyword}.json`));
  console.log(`원고 준비: ${withMs.length}/${all.length}`);

  // 계정별 라운드로빈 (계정당 골고루 뽑기)
  const byAcc = new Map<string, Plan[]>();
  for (const p of withMs) {
    if (!byAcc.has(p.accountId)) byAcc.set(p.accountId, []);
    byAcc.get(p.accountId)!.push(p);
  }
  const batch: Plan[] = [];
  outer: while (batch.length < LIMIT) {
    let any = false;
    for (const [, items] of byAcc) {
      if (items.length === 0) continue;
      batch.push(items.shift()!);
      any = true;
      if (batch.length >= LIMIT) break outer;
    }
    if (!any) break;
  }
  console.log(`선정: ${batch.length}개\n`);

  await mongoose.connect(process.env.MONGO_URI!);
  const scheduleDate = format(new Date(), 'yyyy-MM-dd');
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const startBaseMs = Date.now() + 3 * 60 * 1000; // 3분 뒤 시작

  for (const [index, p] of batch.entries()) {
    const ms: Manuscript = JSON.parse(readFileSync(`/tmp/goat-manuscript-${p.newKeyword}.json`, 'utf-8'));
    const jobDir = createJobDir(p.newKeyword);
    // 10개를 1분 간격으로 순차 스케쥴 (짧은 텀)
    const scheduledAt = new Date(startBaseMs + index * 60 * 1000).toISOString();

    const schedule = await ScheduleModel.create({
      accountId: p.accountId,
      service: 'modify-goat-batch10',
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
      keyword: p.newKeyword,
      category: '한려담원',
      scheduledAt,
      slot: 1,
      status: 'pending',
    });

    const safeAcc = p.accountId.replace(/[^a-zA-Z0-9]/g, '_');
    const queue = new Queue(`generate_${safeAcc}`, { connection });
    const job = await queue.add('generate', {
      scheduleId: schedule._id,
      scheduleJobId: scheduleJob._id,
      keyword: p.newKeyword,
      category: '한려담원',
      account: { id: p.accountId, password: p.password, blogId: p.blogId },
      service: 'modify-goat-batch10',
      ref: '',
      generateImages: true,
      imageCount: 5,
      imageSource: 'product',
      manuscriptType: 'hanryeodamwon',
      delayBetweenPostsSeconds: 10,
      scheduledAt,
      mode: 'update',
      logNo: p.logNo,
      keywordCategory: '한려담원',
      blogName: p.nickname,
      providedManuscript: { title: ms.title, content: ms.content },
    }, {
      delay: Math.max(0, new Date(scheduledAt).getTime() - Date.now()),
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    });
    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, { generateJobId: String(job.id) });
    console.log(`  [${index + 1}/${batch.length}] ${p.nickname.padEnd(14)} logNo=${p.logNo} kw=${p.newKeyword.padEnd(14)} at=${scheduledAt.slice(11, 19)}`);
    await queue.close();
  }

  await connection.quit();
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
