import { format, isSameDay, setHours, setMinutes, setSeconds } from 'date-fns';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema.js';
import { buildScheduleRequestFingerprint } from './schedule-idempotency.service.js';

export type ScheduleMode = '1' | '2' | '3' | '2121';
const DEFAULT_LEAD_TIME_MINUTES = 60;

const getPostsPerDay = (mode: ScheduleMode, dayOffset: number): number => {
  switch (mode) {
    case '1':
      return 1;
    case '2':
      return 2;
    case '3':
      return 3;
    case '2121':
      return dayOffset % 2 === 0 ? 2 : 1;
    default:
      return 2;
  }
};

export interface ScheduleItem {
  keyword: string;
  category?: string;
  scheduledAt: Date;
  slot: number;
}

interface FixedPublishTime {
  hours: number;
  minutes: number;
}

export interface ScheduleTimingOptions {
  fixedPublishTime?: FixedPublishTime;
}

export const parseKeywordWithCategory = (
  input: string
): { keyword: string; category?: string } => {
  const trimmed = input.trim();

  if (trimmed.includes(':')) {
    const colonIndex = trimmed.lastIndexOf(':');
    const keyword = trimmed.slice(0, colonIndex).trim();
    const category = trimmed.slice(colonIndex + 1).trim();

    if (keyword && category) {
      return { keyword, category };
    }
  }

  return { keyword: trimmed };
};

export interface CreateScheduleInput {
  accountId: string;
  service: string;
  ref: string;
  scheduleDate?: string;
  scheduleMode?: ScheduleMode;
  items?: ScheduleItem[];
  generateImages: boolean;
  imageCount: number;
  delayBetweenPostsSeconds: number;
  keywords: string[];
  imageSource?: 'ai' | 'google' | 'keyword' | 'product';
  manuscriptType?: string;
  keywordCategory?: string;
}

const randomBetween = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const applyFixedPublishTime = (
  base: Date,
  fixedPublishTime: FixedPublishTime,
): Date =>
  setSeconds(
    setMinutes(
      setHours(new Date(base), fixedPublishTime.hours),
      fixedPublishTime.minutes,
    ),
    0,
  );

export const buildScheduleTimingOptions = (
  _input: { manuscriptType?: string },
): ScheduleTimingOptions => ({});

const buildScheduleTimingKey = (options: ScheduleTimingOptions): string => {
  if (!options.fixedPublishTime) {
    return '';
  }

  return `fixed_${String(options.fixedPublishTime.hours).padStart(2, '0')}${String(options.fixedPublishTime.minutes).padStart(2, '0')}`;
};

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

const getLeadTimeMinutes = (): number => {
  const parsed = Number(process.env.LEAD_TIME_MINUTES);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LEAD_TIME_MINUTES;
  }

  return parsed;
};

export const calculateSchedule = (
  keywords: string[],
  scheduleDate?: string,
  scheduleMode: ScheduleMode = '2',
  options: ScheduleTimingOptions = {},
): ScheduleItem[] => {
  const now = new Date();
  const baseDate = scheduleDate ? new Date(`${scheduleDate}T00:00:00`) : now;

  const schedule: ScheduleItem[] = [];
  let keywordIndex = 0;
  let dayOffset = 0;

  while (keywordIndex < keywords.length) {
    const targetDate = new Date(baseDate);
    targetDate.setDate(targetDate.getDate() + dayOffset);

    const postsPerDay = getPostsPerDay(scheduleMode, dayOffset);

    const isToday = isSameDay(targetDate, now);
    let currentTime: Date;
    let intervalMinutes: number;

    if (options.fixedPublishTime) {
      currentTime = applyFixedPublishTime(targetDate, options.fixedPublishTime);
      intervalMinutes = 0;
    } else if (isToday) {
      const nextHour = new Date(now);
      nextHour.setMinutes(0, 0, 0);
      nextHour.setHours(nextHour.getHours() + 1);
      currentTime = nextHour;
      intervalMinutes = 60;
    } else {
      const startHour = randomBetween(6, 10);
      currentTime = setSeconds(
        setMinutes(setHours(targetDate, startHour), 0),
        0
      );
      intervalMinutes = randomBetween(120, 180);
    }

    let postsThisDay = 0;

    const minScheduleTime = new Date(now.getTime() + getLeadTimeMinutes() * 60 * 1000);
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

export const formatKst = (date: Date): string =>
  format(date, "yyyy-MM-dd'T'HH:mm:ssXXX");

export const createSchedule = async (input: CreateScheduleInput) => {
  const timingOptions = buildScheduleTimingOptions({
    manuscriptType: input.manuscriptType,
  });
  const items = input.items ?? calculateSchedule(
    input.keywords,
    input.scheduleDate,
    input.scheduleMode,
    timingOptions,
  );
  const requestFingerprint = buildScheduleRequestFingerprint({
    accountId: input.accountId,
    service: input.service,
    ref: input.ref,
    scheduleDate: input.scheduleDate,
    scheduleMode: input.scheduleMode,
    generateImages: input.generateImages,
    imageCount: input.imageCount,
    delayBetweenPostsSeconds: input.delayBetweenPostsSeconds,
    keywords: input.keywords,
    imageSource: input.imageSource,
    manuscriptType: input.manuscriptType,
    keywordCategory: input.keywordCategory,
    scheduleTimingKey: buildScheduleTimingKey(timingOptions),
  });

  const existingSchedule = await ScheduleModel.findOne({
    accountId: input.accountId,
    requestFingerprint,
    status: { $in: ['pending', 'processing'] },
  }).sort({ createdAt: -1 });

  if (existingSchedule) {
    const jobs = await ScheduleJobModel.find({ scheduleId: existingSchedule._id }).sort({ slot: 1 });
    const existingItems = jobs.map((job) => ({
      keyword: job.keyword,
      category: job.category,
      scheduledAt: new Date(job.scheduledAt),
      slot: job.slot,
    }));

    return { schedule: existingSchedule, jobs, items: existingItems, reused: true };
  }

  const schedule = await ScheduleModel.create({
    accountId: input.accountId,
    service: input.service,
    ref: input.ref,
    scheduleDate: input.scheduleDate || format(new Date(), 'yyyy-MM-dd'),
    requestFingerprint,
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

  return { schedule, jobs, items, reused: false };
};
