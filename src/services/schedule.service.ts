import { format, isSameDay, setHours, setMinutes, setSeconds } from 'date-fns';
import { env } from '../config/env';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema';

export interface ScheduleItem {
  keyword: string;
  scheduledAt: Date;
  slot: number;
}

export interface CreateScheduleInput {
  accountId: string;
  service: string;
  ref: string;
  scheduleDate?: string;
  generateImages: boolean;
  imageCount: number;
  delayBetweenPostsSeconds: number;
  keywords: string[];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function addMinutesWithCap(base: Date, minutes: number): Date {
  const result = new Date(base.getTime() + minutes * 60 * 1000);

  if (result.getDate() !== base.getDate()) {
    return setSeconds(setMinutes(setHours(base, 23), 55), 0);
  }

  if (result.getHours() === 23 && result.getMinutes() > 55) {
    return setSeconds(setMinutes(setHours(result, 23), 55), 0);
  }

  return result;
}

/**
 * 예약 시간 계산 (여러 날에 걸쳐 분배)
 * - 당일: 현재 시간 기준 다음 정시부터 1시간 간격
 * - 다른날: 오전 6~10시 사이 랜덤 시작, 2~3시간 랜덤 간격
 * - 하루 발행 개수: 2→1→2→1 패턴 반복
 * - 23:55 초과시 다음날로 넘김
 */
export function calculateSchedule(keywords: string[], scheduleDate?: string): ScheduleItem[] {
  const now = new Date();
  const baseDate = scheduleDate ? new Date(`${scheduleDate}T00:00:00`) : now;

  const schedule: ScheduleItem[] = [];
  let keywordIndex = 0;
  let dayOffset = 0;

  while (keywordIndex < keywords.length) {
    const targetDate = new Date(baseDate);
    targetDate.setDate(targetDate.getDate() + dayOffset);

    // 2→1→2→1 패턴: 짝수일(0,2,4...)은 2개, 홀수일(1,3,5...)은 1개
    const postsPerDay = dayOffset % 2 === 0 ? 2 : 1;

    const isToday = isSameDay(targetDate, now);
    let currentTime: Date;
    let intervalMinutes: number;

    if (isToday) {
      const nextHour = new Date(now);
      nextHour.setMinutes(0, 0, 0);
      nextHour.setHours(nextHour.getHours() + 1);
      currentTime = nextHour;
      intervalMinutes = 60;
    } else {
      const startHour = randomBetween(6, 10);
      currentTime = setSeconds(setMinutes(setHours(targetDate, startHour), 0), 0);
      intervalMinutes = randomBetween(120, 180);
    }

    let postsThisDay = 0;

    // 예약 시간이 현재보다 최소 30분 뒤여야 함
    const minScheduleTime = new Date(now.getTime() + 30 * 60 * 1000);
    if (currentTime < minScheduleTime) {
      currentTime = new Date(minScheduleTime);
    }

    while (keywordIndex < keywords.length && postsThisDay < postsPerDay) {
      // 23:55 초과하면 다음날로
      if (currentTime.getHours() === 23 && currentTime.getMinutes() >= 55) {
        break;
      }

      schedule.push({
        keyword: keywords[keywordIndex],
        scheduledAt: new Date(currentTime),
        slot: keywordIndex + 1,
      });

      keywordIndex += 1;
      postsThisDay += 1;
      currentTime = addMinutesWithCap(currentTime, intervalMinutes);
    }

    dayOffset += 1;
  }

  return schedule;
}

export function formatKst(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

export async function createSchedule(input: CreateScheduleInput) {
  const items = calculateSchedule(input.keywords, input.scheduleDate);

  const schedule = await ScheduleModel.create({
    accountId: input.accountId,
    service: input.service,
    ref: input.ref,
    scheduleDate: input.scheduleDate || format(new Date(), 'yyyy-MM-dd'),
    generateImages: input.generateImages,
    imageCount: input.imageCount,
    delayBetweenPostsSeconds: input.delayBetweenPostsSeconds,
    totalJobs: items.length,
    status: 'pending',
  });

  const jobs = await ScheduleJobModel.insertMany(
    items.map((item) => ({
      scheduleId: schedule._id,
      keyword: item.keyword,
      scheduledAt: formatKst(item.scheduledAt),
      slot: item.slot,
      status: 'pending',
    }))
  );

  return { schedule, jobs, items };
}
