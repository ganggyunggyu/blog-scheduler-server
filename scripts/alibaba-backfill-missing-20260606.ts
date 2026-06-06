import 'dotenv/config';
import mongoose from 'mongoose';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';
import { buildScheduleGenerateJobId } from '../src/services/schedule-idempotency.service.js';
import { formatKst } from '../src/services/schedule.service.js';
import { getGenerateQueue, getPublishQueue, closeAllQueues } from '../src/queues/queue-manager.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const SERVICE = 'alibaba-backfill-rescue-20260606';
const REF = 'keyword-plan-unpublished-backfill-0606-images';
const CATEGORY = '기타';
const IMAGE_COUNT = 5;
const DELAY_BETWEEN_POSTS_SECONDS = 180;
const MIN_START_AT = '2026-06-06T22:00:00+09:00';
const IMAGE_DATE_CODE = '0606';
const GAP_MINUTES = 35;
const ACCOUNT_STAGGER_MINUTES = 5;
const MONITOR_INTERVAL_MS = 30_000;
const MONITOR_TIMEOUT_MS = 12 * 60 * 60 * 1000;

interface AccountDoc {
  accountId: string;
  password: string;
  blogId?: string;
  nickname?: string;
  isActive?: boolean;
}

interface MissingTarget {
  originalDate: string;
  accountId: string;
  keyword: string;
}

interface TargetAccount {
  accountId: string;
  targets: MissingTarget[];
}

const group246 = ['mad1651', 'weed3122', 'individual14144'];
const group135 = ['crvfwy7062', 'heavymouse448', 'rqr1io45'];

const rows246: Array<{ date: string; keywords: string[] }> = [
  { date: '2026-05-18', keywords: ['타오바오', '1688', '타오바오 직구방법'] },
  { date: '2026-05-19', keywords: ['타오바오 한국어', '1688사이트', '1688 사이트'] },
  { date: '2026-05-20', keywords: ['타오바오 회원가입', '1688구매대행', '타오바오구매대행'] },
  { date: '2026-05-21', keywords: ['타오바오 구매대행', 'TAOBAO', '타오바오 직구'] },
  { date: '2026-05-22', keywords: ['타오바오직구', '타오바오 배대지', '타오바오배대지'] },
  { date: '2026-05-23', keywords: ['타오바오 한국어 설정', '1688배송대행', '타오바오 배송기간'] },
  { date: '2026-05-24', keywords: ['타오바오 환불', '타오바오배대지추천', '1688.COM'] },
  { date: '2026-05-25', keywords: ['타오바오 주소입력', '타오바오 코리아', '타오바오배송조회'] },
  { date: '2026-05-26', keywords: ['타오바오 배송', '타오바오직배송', '1688회원가입'] },
  { date: '2026-05-27', keywords: ['1688결제대행', '1688구매대행업체', '1688배대지'] },
  { date: '2026-05-28', keywords: ['타오바오할인코드', '타오바오 구매방법', '타오바오한국직배송'] },
  { date: '2026-05-29', keywords: ['타오바오가입', '타오바오 배송비', '타오바오 쿠폰'] },
  { date: '2026-05-30', keywords: ['1688닷컴', '도매꾹1688', '중국 배대지'] },
  { date: '2026-05-31', keywords: ['중국구매대행', '중국쇼핑몰', '중국이우시장'] },
  { date: '2026-06-01', keywords: ['중국도매사이트', '중국OEM', '중국배대지추천'] },
  { date: '2026-06-02', keywords: ['중국배송대행', '중국직구', '이우배대지'] },
  { date: '2026-06-03', keywords: ['중국소싱', '중국직구사이트', '중국수입대행'] },
  { date: '2026-06-04', keywords: ['해외직구 통관조회', '네이버 해외직구', '해외직구'] },
  { date: '2026-06-05', keywords: ['배대지', '구매대행', '해외구매대행'] },
  { date: '2026-06-06', keywords: ['직구배송조회', '직구사이트', '해외직구 사이트'] },
];

const rows135: Array<{ date: string; keywords: string[] }> = [
  { date: '2026-05-18', keywords: ['해외직구관세기준', '해외직구관세', '국제배송조회'] },
  { date: '2026-05-19', keywords: ['해외직구 조회', '직구관세', '배송대행지'] },
  { date: '2026-05-20', keywords: ['해외직구여기로', '해외통관조회', '해외구매대행사이트'] },
  { date: '2026-05-21', keywords: ['배송대행', '해외직구구매대행', '구매대행부업'] },
  { date: '2026-05-22', keywords: ['해외직구통관배송조회', '해외직구세금', '국내구매대행'] },
  { date: '2026-05-23', keywords: ['해외배송대행', '해외구매', '배대지추천'] },
  { date: '2026-05-24', keywords: ['해외직구주소적는법', '구매대행사이트', '구매대행사업'] },
  { date: '2026-05-25', keywords: ['해외직구통관', '해외직구방법', '직구대행'] },
  { date: '2026-05-26', keywords: ['상품소싱', '해외직구사이트추천', '해외직구주소'] },
  { date: '2026-05-27', keywords: ['구매대행쇼핑몰', '해외직구 배송기간', '해외통관번호발급'] },
  { date: '2026-05-28', keywords: ['글로벌소싱', '해외직구관세납부방법', '배대지 사이트'] },
  { date: '2026-05-29', keywords: ['해외직구쇼핑몰', '구매대행업체', '한국배대지'] },
  { date: '2026-05-30', keywords: ['해외직구한도', '해외직구어플', '배대지비용'] },
  { date: '2026-05-31', keywords: ['구매대행프로그램', '해외직구네이버', '중국이우'] },
  { date: '2026-06-01', keywords: ['중국물류', '중국구매대행사이트', '중국무역대행'] },
  { date: '2026-06-02', keywords: ['중국구매대행추천', '중국수입대행업체', '중국택배'] },
  { date: '2026-06-03', keywords: ['위해배대지', '광저우박람회', '중국배송대행지'] },
  { date: '2026-06-04', keywords: ['중국온라인쇼핑몰', '중국사입', '중국1688'] },
  { date: '2026-06-05', keywords: ['중국공장', '중국쇼핑사이트', '중국수출'] },
  { date: '2026-06-06', keywords: ['중국무역', '상해박람회', '중국도매쇼핑몰'] },
];

const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * 60_000);

const buildStartDate = (): Date => {
  const minimum = Date.parse(MIN_START_AT);
  const rolling = Date.now() + 30 * 60_000;
  return new Date(Math.max(minimum, rolling));
};

const buildExpected = (): MissingTarget[] => {
  const expected: MissingTarget[] = [];
  for (const row of rows135) {
    for (const accountId of group135) {
      for (const keyword of row.keywords) {
        expected.push({ originalDate: row.date, accountId, keyword });
      }
    }
  }
  for (const row of rows246) {
    for (const accountId of group246) {
      for (const keyword of row.keywords) {
        expected.push({ originalDate: row.date, accountId, keyword });
      }
    }
  }
  return expected;
};

const findPublishedKeys = async (accountIds: string[]): Promise<Set<string>> => {
  const schedules = await ScheduleModel.find(
    { accountId: { $in: accountIds } },
    { _id: 1, accountId: 1 },
  ).lean();
  const scheduleAccount = new Map(schedules.map((schedule) => [String(schedule._id), schedule.accountId]));
  const jobs = await ScheduleJobModel.find(
    {
      scheduleId: { $in: schedules.map((schedule) => schedule._id) },
      status: 'published',
    },
    { scheduleId: 1, keyword: 1 },
  ).lean();
  const keys = new Set<string>();
  for (const job of jobs) {
    const accountId = scheduleAccount.get(String(job.scheduleId));
    if (accountId) {
      keys.add(`${accountId}\u0000${job.keyword}`);
    }
  }
  return keys;
};

const findExistingBackfillKeys = async (): Promise<Set<string>> => {
  const schedules = await ScheduleModel.find(
    { service: SERVICE, ref: REF, status: { $ne: 'cancelled' } },
    { _id: 1, accountId: 1 },
  ).lean();
  const scheduleAccount = new Map(schedules.map((schedule) => [String(schedule._id), schedule.accountId]));
  const jobs = await ScheduleJobModel.find(
    {
      scheduleId: { $in: schedules.map((schedule) => schedule._id) },
      status: { $ne: 'cancelled' },
    },
    { scheduleId: 1, keyword: 1 },
  ).lean();
  const keys = new Set<string>();
  for (const job of jobs) {
    const accountId = scheduleAccount.get(String(job.scheduleId));
    if (accountId) {
      keys.add(`${accountId}\u0000${job.keyword}`);
    }
  }
  return keys;
};

const resolveAccounts = async (accountIds: string[]): Promise<Map<string, AccountDoc>> => {
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const accounts = await cafeDb.collection<AccountDoc>('accounts')
    .find(
      {
        accountId: { $in: accountIds },
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
  const missing = accountIds.filter((accountId) => !byId.get(accountId)?.password);
  if (missing.length > 0) {
    throw new Error(`계정 또는 비밀번호 없음: ${missing.join(', ')}`);
  }
  return byId;
};

const groupTargetsByAccount = (targets: MissingTarget[]): TargetAccount[] => {
  const byAccount = new Map<string, MissingTarget[]>();
  for (const target of targets) {
    byAccount.set(target.accountId, [...(byAccount.get(target.accountId) ?? []), target]);
  }
  return [...byAccount.entries()].map(([accountId, accountTargets]) => ({
    accountId,
    targets: accountTargets.sort((a, b) => `${a.originalDate}\u0000${a.keyword}`.localeCompare(`${b.originalDate}\u0000${b.keyword}`)),
  }));
};

const enqueueAccount = async (
  account: AccountDoc,
  targets: MissingTarget[],
  accountIndex: number,
  startDate: Date,
): Promise<string> => {
  const accountId = account.accountId;
  const queue = getGenerateQueue(accountId);
  getPublishQueue(accountId);
  const start = addMinutes(startDate, accountIndex * ACCOUNT_STAGGER_MINUTES);
  const schedule = await ScheduleModel.create({
    accountId,
    service: SERVICE,
    ref: REF,
    scheduleDate: '2026-06-06',
    generateImages: true,
    imageCount: IMAGE_COUNT,
    delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
    totalJobs: targets.length,
    status: 'pending',
  });

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const scheduledAt = formatKst(addMinutes(start, index * GAP_MINUTES));
    const scheduleJob = await ScheduleJobModel.create({
      scheduleId: schedule._id,
      keyword: target.keyword,
      category: CATEGORY,
      scheduledAt,
      slot: index + 1,
      status: 'pending',
    });
    const generateJob = await queue.add('generate', {
      scheduleId: String(schedule._id),
      scheduleJobId: String(scheduleJob._id),
      keyword: target.keyword,
      category: CATEGORY,
      keywordCategory: CATEGORY,
      account: {
        id: accountId,
        password: account.password,
        blogId: account.blogId || accountId,
      },
      service: SERVICE,
      ref: `${REF}-${target.originalDate}`,
      generateImages: true,
      imageCount: IMAGE_COUNT,
      imageSource: 'product',
      imageDateCode: IMAGE_DATE_CODE,
      manuscriptType: 'alibaba',
      delayBetweenPostsSeconds: DELAY_BETWEEN_POSTS_SECONDS,
      scheduledAt,
      blogName: account.nickname || accountId,
    }, {
      jobId: buildScheduleGenerateJobId(String(scheduleJob._id)),
    });
    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, {
      generateJobId: String(generateJob.id),
    });
    console.log(`[queued] ${account.nickname || accountId} ${index + 1}/${targets.length} ${target.originalDate} ${scheduledAt} ${target.keyword}`);
  }
  return String(schedule._id);
};

const summarize = async (scheduleIds: string[]): Promise<{ done: boolean; text: string }> => {
  const jobs = await ScheduleJobModel.find(
    { scheduleId: { $in: scheduleIds } },
    { status: 1 },
  ).lean();
  const counts = new Map<string, number>();
  for (const job of jobs) {
    counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  }
  const total = jobs.length;
  const published = counts.get('published') ?? 0;
  const failed = counts.get('failed') ?? 0;
  const pending = counts.get('pending') ?? 0;
  const generating = counts.get('generating') ?? 0;
  const generated = counts.get('generated') ?? 0;
  const publishing = counts.get('publishing') ?? 0;
  const done = total > 0 && published + failed >= total;
  return {
    done,
    text: `total=${total} published=${published} failed=${failed} pending=${pending} generating=${generating} generated=${generated} publishing=${publishing}`,
  };
};

const waitForCompletion = async (scheduleIds: string[]): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MONITOR_TIMEOUT_MS) {
    const summary = await summarize(scheduleIds);
    console.log(`[monitor] ${summary.text}`);
    if (summary.done) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, MONITOR_INTERVAL_MS);
    });
  }
  throw new Error('monitor timeout');
};

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }
  await mongoose.connect(process.env.MONGO_URI);
  const expected = buildExpected();
  const accountIds = [...new Set(expected.map((target) => target.accountId))];
  const publishedKeys = await findPublishedKeys(accountIds);
  const existingBackfillKeys = await findExistingBackfillKeys();
  const missing = expected.filter((target) => {
    const key = `${target.accountId}\u0000${target.keyword}`;
    return !publishedKeys.has(key) && !existingBackfillKeys.has(key);
  });
  console.log(`[audit] expected=${expected.length} missingToQueue=${missing.length}`);
  if (missing.length === 0) {
    return;
  }

  const accounts = await resolveAccounts(accountIds);
  const startDate = buildStartDate();
  const scheduleIds: string[] = [];
  const groupedTargets = groupTargetsByAccount(missing);
  for (let index = 0; index < groupedTargets.length; index += 1) {
    const targetAccount = groupedTargets[index];
    const account = accounts.get(targetAccount.accountId);
    if (!account) {
      throw new Error(`계정 없음: ${targetAccount.accountId}`);
    }
    scheduleIds.push(await enqueueAccount(account, targetAccount.targets, index, startDate));
  }
  console.log(`[created] schedules=${scheduleIds.join(',')}`);
  await waitForCompletion(scheduleIds);
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser().catch(() => undefined);
    await closeAllQueues().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  });
