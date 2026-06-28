import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { getGenerateQueue, getPublishQueue, closeAllQueues } from '../src/queues/queue-manager.js';
import { buildScheduleGenerateJobId } from '../src/services/schedule-idempotency.service.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const ACCOUNT_ID = 'n7c3w8z2';
const SOURCE_GENERATE_JOB_ID = 'generate_job_80396cf0-1a27-4432-8132-9556e7047103';
const TARGET_SCHEDULE_ID = 'sch_23ed17fa-4e6f-4f71-bab8-128aa68d4a04';
const TARGET_JOB_ID = 'job_4ff7b5c8-d6ad-4348-bc0d-b21873535906';

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const providedManuscript = {
  title: '스핑크스고양이 분양 전 꼭 알아야 할 성격과 관리 포인트',
  content: [
    '스핑크스고양이는 털이 거의 없어 보이는 독특한 외모 때문에 처음부터 관심을 많이 받는 묘종입니다. 다만 외모만 보고 결정하기보다는 생활 환경, 관리 시간, 초기 비용을 함께 따져보는 과정이 필요합니다.',
    '가장 먼저 봐야 할 부분은 체온 관리입니다. 털이 풍성한 고양이보다 추위와 직사광선에 예민할 수 있어 실내 온도와 계절별 보온 준비를 신경 써야 합니다. 옷이나 담요를 준비하더라도 고양이가 불편해하지 않는지 천천히 적응시키는 편이 좋습니다.',
    '피부 관리도 중요한 편입니다. 피지와 먼지가 피부에 남기 쉬워 주기적인 목욕이나 닦아주기가 필요할 수 있습니다. 너무 잦은 세정은 오히려 부담이 될 수 있으니 입양 전 관리 주기와 방법을 충분히 안내받는 것이 좋습니다.',
    '성격은 사람을 좋아하고 호기심이 많은 편으로 알려져 있지만, 개체마다 차이가 큽니다. 가족 구성원의 생활 패턴, 집에 머무는 시간, 다른 반려동물과의 합사 가능성까지 함께 확인하면 적응 스트레스를 줄이는 데 도움이 됩니다.',
    '스핑크스고양이 분양을 알아볼 때는 분양가만 비교하기보다 건강 기록, 예방 관리, 부모묘 정보, 사후 상담 가능 여부를 함께 확인해야 합니다. 처음 고양이를 키운다면 관리가 쉬운지보다 내가 꾸준히 관리할 수 있는지부터 점검하는 것이 안전합니다.',
  ].join('\n\n'),
};

const main = async (): Promise<void> => {
  await mongoose.connect(env.MONGO_URI);
  const connection = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });

  try {
    const rawGenerateQueue = new Queue(`generate_${ACCOUNT_ID}`, { connection });
    const sourceJob = await rawGenerateQueue.getJob(SOURCE_GENERATE_JOB_ID);
    if (!sourceJob?.data?.account?.password) {
      throw new Error('source runtime credential is unavailable');
    }

    const account = sourceJob.data.account;
    const generateQueue = getGenerateQueue(ACCOUNT_ID);
    getPublishQueue(ACCOUNT_ID);

    const db = mongoose.connection.db;
    if (!db) throw new Error('db missing');
    const targetJob = await db.collection('schedulejobs').findOne({ _id: TARGET_JOB_ID });
    if (!targetJob) throw new Error('target job missing');

    await db.collection('schedulejobs').updateOne(
      { _id: TARGET_JOB_ID },
      {
        $set: { status: 'pending', generateJobId: `${buildScheduleGenerateJobId(TARGET_JOB_ID)}_provided_${Date.now()}` },
        $unset: { error: 1, completedAt: 1 },
      },
    );

    const refreshed = await db.collection('schedulejobs').findOne({ _id: TARGET_JOB_ID });
    const generateJobId = refreshed?.generateJobId;
    if (!generateJobId) throw new Error('generateJobId missing');

    await generateQueue.add('generate', {
      scheduleId: TARGET_SCHEDULE_ID,
      scheduleJobId: TARGET_JOB_ID,
      keyword: '스핑크스고양이',
      category: '애견',
      keywordCategory: '애견',
      account,
      service: 'pet-sheet-sunday-20260628',
      ref: 'pet-sheet-provided-sphynx-2026-06-28',
      generateImages: true,
      imageCount: 5,
      imageSource: 'product',
      manuscriptType: 'pet',
      delayBetweenPostsSeconds: 10,
      scheduledAt: '2026-06-28T12:13:00+09:00',
      blogName: '고양이밥1',
      providedManuscript,
      imageDateCode: '0628',
    }, {
      jobId: generateJobId,
    });

    await rawGenerateQueue.close();

    for (let tick = 0; tick < 120; tick += 1) {
      const jobs = await db.collection('schedulejobs').find(
        { scheduleId: TARGET_SCHEDULE_ID },
        { projection: { keyword: 1, status: 1, postUrl: 1, error: 1, updatedAt: 1, publishJobId: 1 } },
      ).toArray();
      console.log(JSON.stringify({
        tick,
        jobs: jobs.map((job) => ({
          keyword: job.keyword,
          status: job.status,
          postUrl: job.postUrl,
          error: job.error,
          updatedAt: job.updatedAt,
          publishJobId: job.publishJobId,
        })),
      }));
      const target = jobs.find((job) => job.keyword === '스핑크스고양이');
      if (target && ['published', 'failed', 'cancelled'].includes(target.status)) {
        return;
      }
      await sleep(10_000);
    }
  } finally {
    await closeAllQueues().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await connection.quit().catch(() => undefined);
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
