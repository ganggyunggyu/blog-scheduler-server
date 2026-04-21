import 'dotenv/config';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { format } from 'date-fns';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';
import { getPublishQueue } from '../src/queues/queue-manager.js';

const PLAN_PATH = '/tmp/goat-modify-plan.json';
const JOBS_DIR = path.resolve(process.cwd(), 'jobs');

interface PlanItem {
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

const loadManuscript = (keyword: string): Manuscript => {
  const p = `/tmp/goat-manuscript-${keyword}.json`;
  if (!existsSync(p)) throw new Error(`manuscript not found: ${p}`);
  return JSON.parse(readFileSync(p, 'utf-8')) as Manuscript;
};

const createJobDir = (keyword: string): string => {
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2');
  const safe = keyword.replace(/[^\w가-힣]/g, '_').slice(0, 20);
  const dir = path.join(JOBS_DIR, `${ts}_${safe}_modify`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    keyword,
    mode: 'modify',
    createdAt: new Date().toISOString(),
    status: 'pending',
  }, null, 2));
  return dir;
};

const main = async () => {
  if (!existsSync(PLAN_PATH)) throw new Error(`plan not found: ${PLAN_PATH}`);
  const plan: PlanItem[] = JSON.parse(readFileSync(PLAN_PATH, 'utf-8'));
  console.log(`plan ${plan.length}개 로드\n`);

  const items = plan.map((p) => ({ plan: p, manuscript: loadManuscript(p.newKeyword) }));
  console.log(`원고 ${items.length}개 로드 완료\n`);

  await mongoose.connect(process.env.MONGO_URI!);
  const nowIso = new Date().toISOString();
  const scheduleDate = format(new Date(), 'yyyy-MM-dd');

  const scheduledAtBase = Date.now() + 3 * 60 * 1000;

  for (const [index, { plan: p, manuscript }] of items.entries()) {
    const jobDir = createJobDir(p.newKeyword);
    const scheduledAt = new Date(scheduledAtBase + index * 5 * 1000).toISOString();

    const schedule = await ScheduleModel.create({
      accountId: p.accountId,
      service: 'modify-test',
      ref: '',
      scheduleDate,
      generateImages: false,
      imageCount: 0,
      delayBetweenPostsSeconds: 0,
      totalJobs: 1,
      status: 'pending',
    });

    const scheduleJob = await ScheduleJobModel.create({
      scheduleId: schedule._id,
      keyword: p.newKeyword,
      category: '한려담원',
      scheduledAt,
      slot: 1,
      status: 'generated',
    });

    const queue = getPublishQueue(p.accountId);
    const publishJob = await queue.add('publish', {
      scheduleId: schedule._id,
      scheduleJobId: scheduleJob._id,
      account: { id: p.accountId, password: p.password, blogId: p.blogId },
      jobDir,
      manuscript: {
        title: manuscript.title,
        content: manuscript.content,
      },
      category: '한려담원',
      scheduledAt,
      mode: 'update',
      logNo: p.logNo,
      keywordCategory: '한려담원',
      manuscriptType: 'hanryeodamwon',
    }, {
      delay: Math.max(0, new Date(scheduledAt).getTime() - Date.now()),
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    });

    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, {
      publishJobId: publishJob.id,
    });

    console.log(`  [${index + 1}/8] ${p.nickname.padEnd(14)} logNo=${p.logNo} | ${p.newKeyword}`);
    console.log(`        scheduleId=${schedule._id} jobId=${publishJob.id} at=${scheduledAt}`);
  }

  console.log(`\n모든 수정 job enqueue 완료. publish.worker가 순차 처리.`);
  console.log(`모니터링: curl -s http://localhost:8001/api/queues/dashboard | jq`);

  await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
