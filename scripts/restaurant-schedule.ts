import 'dotenv/config';
import axios from 'axios';
import { readFile } from 'fs/promises';
import {
  assertRestaurantPlan,
  buildRestaurantPlanItems,
  type RestaurantAccountPlan,
  type RestaurantTarget,
} from '../src/services/restaurant-plan.service.js';

/**
 * 맛집 자동발행 스케쥴 등록기.
 *
 * 플랜 JSON 하나를 받아서 업체명 중복을 먼저 막고, 계정별로 맛집1/맛집2 를
 * 번갈아 배정한 뒤 `/bot/auto-schedule` 에 넣음.
 * 비밀번호가 들어 있는 플랜 파일은 레포 밖에 두고 경로만 넘김.
 */

const SCHEDULER_URL = process.env.SCHEDULER_URL ?? 'http://localhost:8001';

interface PlanAccount {
  accountId: string;
  password: string;
  region: string;
  blogCharacter: string;
  startOffset?: number;
  targets: RestaurantTarget[];
}

interface PlanFile {
  scheduleDate?: string;
  scheduleMode?: '1' | '2' | '3' | '2121';
  accounts: PlanAccount[];
}

interface ScheduleResponse {
  success: boolean;
  message?: string;
  totalJobs?: number;
  schedules?: Array<{
    scheduleId: string;
    account: string;
    reused: boolean;
    totalJobs: number;
    jobs: Array<{ keyword: string; scheduledAt: string; slot: number }>;
  }>;
}

const main = async (): Promise<void> => {
  const planPath = process.argv[2];
  const isDryRun = process.argv.includes('--dry-run');
  if (!planPath) {
    throw new Error('사용법: tsx scripts/restaurant-schedule.ts <plan.json> [--dry-run]');
  }

  const plan = JSON.parse(await readFile(planPath, 'utf8')) as PlanFile;
  const scheduleMode = plan.scheduleMode ?? '2';

  const accountPlans: RestaurantAccountPlan[] = plan.accounts.map((account, index) => ({
    accountId: account.accountId,
    region: account.region,
    blogCharacter: account.blogCharacter,
    items: buildRestaurantPlanItems(account.targets, account.startOffset ?? index % 2),
  }));

  assertRestaurantPlan(accountPlans);

  const totalItems = accountPlans.reduce((sum, accountPlan) => sum + accountPlan.items.length, 0);
  console.log(`[plan] 계정 ${accountPlans.length}개 / 글 ${totalItems}개 / 모드 ${scheduleMode} / 시작일 ${plan.scheduleDate ?? '오늘'}`);

  accountPlans.forEach((accountPlan) => {
    console.log(`\n[${accountPlan.accountId}] ${accountPlan.region} (맛집2 캐릭터: ${accountPlan.blogCharacter})`);
    accountPlan.items.forEach((item, index) => {
      const label = item.manuscriptType === 'restaurant1' ? '맛집1' : '맛집2';
      console.log(`  ${String(index + 1).padStart(2)}. ${label} | ${item.keyword} | ${item.businessName}`);
    });
  });

  if (isDryRun) {
    console.log('\n[dry-run] 등록하지 않고 종료함');
    return;
  }

  for (let index = 0; index < plan.accounts.length; index += 1) {
    const account = plan.accounts[index];
    const accountPlan = accountPlans[index];

    const payload = {
      queues: [
        {
          account: { id: account.accountId, password: account.password },
          keywords: accountPlan.items.map((item) => item.keyword),
          item_options: accountPlan.items.map((item) => ({
            businessName: item.businessName,
            manuscriptType: item.manuscriptType,
          })),
          blog_name: account.blogCharacter,
        },
      ],
      schedule_date: plan.scheduleDate,
      schedule_mode: scheduleMode,
      service: 'restaurant',
      generate_images: true,
      image_count: 5,
      image_source: 'google',
      manuscript_type: 'restaurant1',
      delay_between_posts: 10,
      keyword_category: '맛집',
    };

    const { data } = await axios.post<ScheduleResponse>(
      `${SCHEDULER_URL}/bot/auto-schedule`,
      payload,
      { timeout: 120000 },
    );

    if (!data.success) {
      console.error(`[fail] ${account.accountId}: ${data.message ?? 'unknown'}`);
      continue;
    }

    const schedule = data.schedules?.[0];
    console.log(
      `[ok] ${account.accountId} scheduleId=${schedule?.scheduleId} jobs=${schedule?.totalJobs} reused=${schedule?.reused}`,
    );
    schedule?.jobs.forEach((job) => {
      console.log(`     ${job.slot}. ${job.scheduledAt} ${job.keyword}`);
    });
  }
};

main().catch((error) => {
  const message = axios.isAxiosError(error)
    ? JSON.stringify(error.response?.data ?? error.message)
    : error instanceof Error
      ? error.message
      : String(error);
  console.error('[error]', message);
  process.exit(1);
});
