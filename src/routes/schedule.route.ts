import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
// [Legacy: BullMQ delay 방식] import { parseISO } from 'date-fns';
import { createScheduleSchema, executeScheduleSchema, scheduleQuerySchema } from '../schemas/dto';
import { createSchedule } from '../services/schedule.service';
import { generateQueue, publishQueue } from '../queues/queues';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema';

// [Legacy: BullMQ delay 방식 - 현재는 네이버 예약발행 UI 사용]
// function calculateDelay(scheduledAt: string): number {
//   const targetTime = parseISO(scheduledAt).getTime();
//   const now = Date.now();
//   return Math.max(0, targetTime - now);
// }

const pythonCompatSchema = z.object({
  queues: z.array(
    z.object({
      account: z.object({ id: z.string(), password: z.string() }),
      keywords: z.array(z.string()),
    })
  ),
  schedule_date: z.string().optional(),
  service: z.string().default('default'),
  ref: z.string().default(''),
  generate_images: z.boolean().default(true),
  image_count: z.number().default(5),
  delay_between_posts: z.number().default(10),
});

function maskAccountId(accountId: string): string {
  const [user, domain] = accountId.split('@');
  if (domain) {
    return `${user.slice(0, 3)}***@${domain}`;
  }
  return `${accountId.slice(0, 3)}***`;
}

export async function scheduleRoutes(app: FastifyInstance) {
  app.post('/schedules', async (req) => {
    const body = createScheduleSchema.parse(req.body);

    const results: Array<{
      scheduleId: string;
      account: string;
      totalJobs: number;
      jobs: Array<{ id: string; keyword: string; scheduledAt: string; slot: number }>;
    }> = [];

    let totalJobs = 0;

    for (const queue of body.queues) {
      const { schedule, jobs } = await createSchedule({
        accountId: queue.account.id,
        service: body.service,
        ref: body.ref,
        scheduleDate: body.scheduleDate,
        generateImages: body.generateImages,
        imageCount: body.imageCount,
        delayBetweenPostsSeconds: body.delayBetweenPostsSeconds,
        keywords: queue.keywords,
      });

      totalJobs += jobs.length;

      for (const jobItem of jobs) {
        // [Legacy: BullMQ delay 방식]
        // const delay = calculateDelay(jobItem.scheduledAt);

        const generateJob = await generateQueue.add(
          'generate',
          {
            scheduleId: schedule._id,
            scheduleJobId: jobItem._id,
            keyword: jobItem.keyword,
            account: queue.account,
            service: body.service,
            ref: body.ref,
            generateImages: body.generateImages,
            imageCount: body.imageCount,
            delayBetweenPostsSeconds: body.delayBetweenPostsSeconds,
            scheduledAt: jobItem.scheduledAt, // 네이버 예약발행 시간 전달
          }
          // [Legacy: BullMQ delay 방식] { delay }
        );

        await ScheduleJobModel.findByIdAndUpdate(jobItem._id, {
          generateJobId: String(generateJob.id),
        });
      }

      results.push({
        scheduleId: String(schedule._id),
        account: maskAccountId(queue.account.id),
        totalJobs: jobs.length,
        jobs: jobs.map((jobItem) => ({
          id: String(jobItem._id),
          keyword: jobItem.keyword,
          scheduledAt: jobItem.scheduledAt,
          slot: jobItem.slot,
        })),
      });
    }

    return { success: true, totalJobs, schedules: results };
  });

  app.get('/schedules', async (req) => {
    const query = scheduleQuerySchema.parse(req.query);
    const filter: Record<string, string> = {};

    if (query.accountId) filter.accountId = query.accountId;
    if (query.status) filter.status = query.status;

    const schedules = await ScheduleModel.find(filter).sort({ createdAt: -1 }).limit(50);
    return { schedules };
  });

  app.get('/schedules/:id', async (req, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const schedule = await ScheduleModel.findById(id);
    if (!schedule) {
      return reply.status(404).send({ message: 'Schedule not found' });
    }

    const jobs = await ScheduleJobModel.find({ scheduleId: id }).sort({ day: 1, slot: 1 });
    return { schedule, jobs };
  });

  app.delete('/schedules/:id', async (req, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const schedule = await ScheduleModel.findById(id);
    if (!schedule) {
      return reply.status(404).send({ message: 'Schedule not found' });
    }

    const jobs = await ScheduleJobModel.find({ scheduleId: id });

    for (const jobItem of jobs) {
      if (jobItem.generateJobId) {
        await generateQueue.remove(jobItem.generateJobId).catch(() => {});
      }
      if (jobItem.publishJobId) {
        await publishQueue.remove(jobItem.publishJobId).catch(() => {});
      }
    }

    await ScheduleJobModel.updateMany(
      { scheduleId: id },
      { status: 'cancelled', error: 'cancelled' }
    );

    await ScheduleModel.findByIdAndUpdate(id, { status: 'cancelled' });

    return { success: true, id };
  });

  app.post('/schedules/:id/execute', async (req, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = executeScheduleSchema.parse(req.body ?? {});

    const schedule = await ScheduleModel.findById(id);
    if (!schedule) {
      return reply.status(404).send({ message: 'Schedule not found' });
    }

    if (body.account.id !== schedule.accountId) {
      return reply.status(400).send({ message: 'Account mismatch' });
    }

    const jobs = await ScheduleJobModel.find({ scheduleId: id, status: 'pending' });

    for (const jobItem of jobs) {
      // [Legacy: BullMQ delay 방식]
      // const delay = calculateDelay(jobItem.scheduledAt);

      const generateJob = await generateQueue.add(
        'generate',
        {
          scheduleId: schedule._id,
          scheduleJobId: jobItem._id,
          keyword: jobItem.keyword,
          account: body.account,
          service: schedule.service,
          ref: schedule.ref,
          generateImages: schedule.generateImages,
          imageCount: schedule.imageCount,
          delayBetweenPostsSeconds: schedule.delayBetweenPostsSeconds,
          scheduledAt: jobItem.scheduledAt, // 네이버 예약발행 시간 전달
        }
        // [Legacy: BullMQ delay 방식] { delay }
      );

      await ScheduleJobModel.findByIdAndUpdate(jobItem._id, {
        generateJobId: String(generateJob.id),
      });
    }

    return { success: true, enqueued: jobs.length };
  });

  // Python 호환 라우트 (/bot/auto-schedule)
  app.post('/bot/auto-schedule', async (req: { body: unknown }) => {
    const body = pythonCompatSchema.parse(req.body);

    const results: Array<{
      scheduleId: string;
      account: string;
      totalJobs: number;
      jobs: Array<{ id: string; keyword: string; scheduledAt: string; slot: number }>;
    }> = [];

    let totalJobs = 0;

    for (const queue of body.queues) {
      const { schedule, jobs } = await createSchedule({
        accountId: queue.account.id,
        service: body.service,
        ref: body.ref,
        scheduleDate: body.schedule_date,
        generateImages: body.generate_images,
        imageCount: body.image_count,
        delayBetweenPostsSeconds: body.delay_between_posts,
        keywords: queue.keywords,
      });

      totalJobs += jobs.length;

      for (const jobItem of jobs) {
        // [Legacy: BullMQ delay 방식]
        // const delay = calculateDelay(jobItem.scheduledAt);

        const generateJob = await generateQueue.add(
          'generate',
          {
            scheduleId: schedule._id,
            scheduleJobId: jobItem._id,
            keyword: jobItem.keyword,
            account: queue.account,
            service: body.service,
            ref: body.ref,
            generateImages: body.generate_images,
            imageCount: body.image_count,
            delayBetweenPostsSeconds: body.delay_between_posts,
            scheduledAt: jobItem.scheduledAt, // 네이버 예약발행 시간 전달
          }
          // [Legacy: BullMQ delay 방식] { delay }
        );

        await ScheduleJobModel.findByIdAndUpdate(jobItem._id, {
          generateJobId: String(generateJob.id),
        });
      }

      results.push({
        scheduleId: String(schedule._id),
        account: maskAccountId(queue.account.id),
        totalJobs: jobs.length,
        jobs: jobs.map((jobItem: { _id: unknown; keyword: string; scheduledAt: string; slot: number }) => ({
          id: String(jobItem._id),
          keyword: jobItem.keyword,
          scheduledAt: jobItem.scheduledAt,
          slot: jobItem.slot,
        })),
      });
    }

    return { success: true, totalJobs, schedules: results };
  });
}
