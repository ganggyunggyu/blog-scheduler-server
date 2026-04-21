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
const PER_ACCOUNT = Number(process.argv[2] ?? 10);

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
    keyword, mode: 'modify-goat-perAcc', createdAt: new Date().toISOString(), status: 'pending',
  }, null, 2));
  return dir;
};

const main = async () => {
  const all: Plan[] = JSON.parse(readFileSync(PLAN_PATH, 'utf-8'));

  // 계정별 grouping 후 앞 PER_ACCOUNT개만
  const byAcc = new Map<string, Plan[]>();
  for (const p of all) {
    if (!byAcc.has(p.accountId)) byAcc.set(p.accountId, []);
    byAcc.get(p.accountId)!.push(p);
  }

  await mongoose.connect(process.env.MONGO_URI!);

  // 이미 enqueue된 logNo 제외 (modify-goat-* 시리즈)
  const existingJobs = await mongoose.connection.db!
    .collection('schedules')
    .find({ service: { $regex: /^modify-goat-/ } })
    .toArray();
  const scheduleIds = existingJobs.map((s) => s._id);
  const usedJobs = await mongoose.connection.db!
    .collection('schedulejobs')
    .find({ scheduleId: { $in: scheduleIds } })
    .toArray();
  const usedLogNos = new Set<string>();
  // logNo is stored on originalPlan? We stored keyword, not logNo.
  // 대신 keyword+accountId 조합으로 중복 방지
  const usedKeyAcc = new Set<string>();
  for (const sj of usedJobs) {
    const sch = existingJobs.find((s) => s._id === sj.scheduleId);
    if (sch) usedKeyAcc.add(`${sch.accountId}|${sj.keyword}`);
  }

  // 계정당 앞 PER_ACCOUNT개 선택, 이미 처리한 것 제외
  const selected: Plan[] = [];
  for (const [acc, items] of byAcc) {
    let count = 0;
    for (const p of items) {
      if (count >= PER_ACCOUNT) break;
      const key = `${acc}|${p.newKeyword}`;
      if (usedKeyAcc.has(key)) {
        count += 1; // 이미 처리됨 = 카운트 포함
        continue;
      }
      if (!existsSync(`/tmp/goat-manuscript-${p.newKeyword}.json`)) continue; // 원고 없음 → 스킵
      selected.push(p);
      count += 1;
    }
    console.log(`  ${items[0].nickname.padEnd(14)} - 기존 처리 + 원고 준비 = 계정당 선택 ${selected.filter((s) => s.accountId === acc).length}개`);
  }

  console.log(`\n추가 enqueue 대상: ${selected.length}개\n`);

  if (selected.length === 0) {
    console.log('enqueue할 대상 없음');
    await mongoose.disconnect();
    process.exit(0);
  }

  const scheduleDate = format(new Date(), 'yyyy-MM-dd');
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  // 계정별로 순차(1분 간격) 스케줄
  const accOffset = new Map<string, number>();
  const startBase = Date.now() + 60 * 1000;

  for (const p of selected) {
    const ms: Manuscript = JSON.parse(readFileSync(`/tmp/goat-manuscript-${p.newKeyword}.json`, 'utf-8'));
    const jobDir = createJobDir(p.newKeyword);
    const offset = accOffset.get(p.accountId) ?? 0;
    accOffset.set(p.accountId, offset + 1);
    const scheduledAt = new Date(startBase + offset * 60 * 1000).toISOString();

    const schedule = await ScheduleModel.create({
      accountId: p.accountId,
      service: 'modify-goat-perAcc',
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
      service: 'modify-goat-perAcc',
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
    console.log(`  ${p.nickname.padEnd(14)} kw=${p.newKeyword.padEnd(14)} logNo=${p.logNo} at=${scheduledAt.slice(11, 19)}`);
    await queue.close();
  }

  await connection.quit();
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
