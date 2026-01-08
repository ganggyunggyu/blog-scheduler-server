import { format, isSameDay, setHours, setMinutes, setSeconds } from 'date-fns';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema';

const SCHEDULE_MODE = '2';

const getPostsPerDay = (mode: string, dayOffset: number): number => {
  switch (mode) {
    case '2':
      return 2;
    case '3':
      return 3;
    case '2121':
      return dayOffset % 2 === 0 ? 2 : 1;
    default:
      return 3;
  }
};

export interface ScheduleItem {
  keyword: string;
  category?: string;
  scheduledAt: Date;
  slot: number;
}

export const parseKeywordWithCategory = (input: string): { keyword: string; category?: string } => {
  const trimmed = input.trim();

  if (trimmed.includes(':')) {
    const colonIndex = trimmed.lastIndexOf(':');
    const keyword = trimmed.slice(0, colonIndex).trim();
    const category = trimmed.slice(colonIndex + 1).trim();

    if (keyword && category) {
      return { keyword, category };
    }
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length <= 1) {
    return { keyword: trimmed };
  }
  const category = parts.pop()!;
  return {
    keyword: parts.join(' '),
    category,
  };
};

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

const randomBetween = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const addMinutesWithCap = (base: Date, minutes: number): Date => {
  const result = new Date(base.getTime() + minutes * 60 * 1000);

  if (result.getDate() !== base.getDate()) {
    return setSeconds(setMinutes(setHours(base, 23), 55), 0);
  }

  if (result.getHours() === 23 && result.getMinutes() > 55) {
    return setSeconds(setMinutes(setHours(result, 23), 55), 0);
  }

  return result;
};

export const calculateSchedule = (keywords: string[], scheduleDate?: string): ScheduleItem[] => {
  const now = new Date();
  const baseDate = scheduleDate ? new Date(`${scheduleDate}T00:00:00`) : now;

  const schedule: ScheduleItem[] = [];
  let keywordIndex = 0;
  let dayOffset = 0;

  while (keywordIndex < keywords.length) {
    const targetDate = new Date(baseDate);
    targetDate.setDate(targetDate.getDate() + dayOffset);

    const postsPerDay = getPostsPerDay(SCHEDULE_MODE, dayOffset);

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

    const minScheduleTime = new Date(now.getTime() + 30 * 60 * 1000);
    if (currentTime < minScheduleTime) {
      currentTime = new Date(minScheduleTime);
    }

    while (keywordIndex < keywords.length && postsThisDay < postsPerDay) {
      if (currentTime.getHours() === 23 && currentTime.getMinutes() >= 55) {
        break;
      }

      const parsed = parseKeywordWithCategory(keywords[keywordIndex]);
      schedule.push({
        keyword: parsed.keyword,
        category: parsed.category,
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
};

export const formatKst = (date: Date): string => format(date, "yyyy-MM-dd'T'HH:mm:ssXXX");

export const createSchedule = async (input: CreateScheduleInput) => {
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
      category: item.category,
      scheduledAt: formatKst(item.scheduledAt),
      slot: item.slot,
      status: 'pending',
    }))
  );

  return { schedule, jobs, items };
};
