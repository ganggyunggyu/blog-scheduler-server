import { z } from 'zod';
import { env } from '../config/env';

export const accountSchema = z.object({
  id: z.string().min(1),
  password: z.string().min(1),
});

export const createScheduleSchema = z.object({
  service: z.string().default('default'),
  ref: z.string().default(''),
  queues: z
    .array(
      z.object({
        account: accountSchema,
        keywords: z.array(z.string().min(1)).min(1),
      })
    )
    .min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().min(0).max(23).default(10),
  postsPerDay: z.number().min(1).max(10).default(3),
  intervalHours: z.number().min(1).max(12).default(2),
  generateImages: z.boolean().default(true),
  imageCount: z.number().min(1).max(10).default(5),
  delayBetweenPostsSeconds: z.number().min(0).max(600).default(10),
  leadTimeMinutes: z.number().min(0).max(24 * 60).default(env.LEAD_TIME_MINUTES),
});

export type CreateScheduleDto = z.infer<typeof createScheduleSchema>;

export const scheduleQuerySchema = z.object({
  accountId: z.string().optional(),
  status: z
    .enum(['pending', 'processing', 'completed', 'failed', 'cancelled'])
    .optional(),
});

export type ScheduleQueryDto = z.infer<typeof scheduleQuerySchema>;

export const executeScheduleSchema = z.object({
  account: accountSchema,
});

export type ExecuteScheduleDto = z.infer<typeof executeScheduleSchema>;
