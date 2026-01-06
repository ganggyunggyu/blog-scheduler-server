import { addDays, addHours, format, parseISO, setHours, setMinutes } from 'date-fns';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema';

export interface ScheduleItem {
  keyword: string;
  scheduledAt: Date;
  day: number;
  slot: number;
}

export interface CreateScheduleInput {
  accountId: string;
  service: string;
  ref: string;
  startDate: string;
  startHour: number;
  postsPerDay: number;
  intervalHours: number;
  leadTimeMinutes: number;
  generateImages: boolean;
  imageCount: number;
  delayBetweenPostsSeconds: number;
  keywords: string[];
}

export function calculateSchedule(
  keywords: string[],
  startDate: string,
  startHour: number,
  postsPerDay: number,
  intervalHours: number
): ScheduleItem[] {
  const baseDate = setMinutes(setHours(parseISO(`${startDate}T00:00:00`), startHour), 0);
  const schedule: ScheduleItem[] = [];

  let keywordIdx = 0;
  let day = 0;

  while (keywordIdx < keywords.length) {
    const dayBase = addDays(baseDate, day);

    for (let slot = 0; slot < postsPerDay && keywordIdx < keywords.length; slot += 1) {
      const scheduledAt = addHours(dayBase, slot * intervalHours);

      schedule.push({
        keyword: keywords[keywordIdx],
        scheduledAt,
        day: day + 1,
        slot: slot + 1,
      });

      keywordIdx += 1;
    }

    day += 1;
  }

  return schedule;
}

export function formatKst(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

export async function createSchedule(input: CreateScheduleInput) {
  const items = calculateSchedule(
    input.keywords,
    input.startDate,
    input.startHour,
    input.postsPerDay,
    input.intervalHours
  );

  const schedule = await ScheduleModel.create({
    accountId: input.accountId,
    service: input.service,
    ref: input.ref,
    startDate: input.startDate,
    startHour: input.startHour,
    postsPerDay: input.postsPerDay,
    intervalHours: input.intervalHours,
    leadTimeMinutes: input.leadTimeMinutes,
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
      day: item.day,
      slot: item.slot,
      status: 'pending',
    }))
  );

  return { schedule, jobs, items };
}
