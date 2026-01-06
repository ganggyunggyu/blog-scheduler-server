import type { FastifyInstance } from 'fastify';
import { createScheduleSchema, executeScheduleSchema, scheduleQuerySchema } from '../schemas/dto';
import { createSchedule } from '../services/schedule.service';
import { generateQueue, publishQueue } from '../queues/queues';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema';

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
      jobs: Array<{ id: string; keyword: string; scheduledAt: string; day: number; slot: number }>;
    }> = [];

    let totalJobs = 0;

    for (const queue of body.queues) {
      const { schedule, jobs } = await createSchedule({
        accountId: queue.account.id,
        service: body.service,
        ref: body.ref,
        startDate: body.startDate,
        startHour: body.startHour,
        postsPerDay: body.postsPerDay,
        intervalHours: body.intervalHours,
        leadTimeMinutes: body.leadTimeMinutes,
        generateImages: body.generateImages,
        imageCount: body.imageCount,
        delayBetweenPostsSeconds: body.delayBetweenPostsSeconds,
        keywords: queue.keywords,
      });

      totalJobs += jobs.length;

      for (const jobItem of jobs) {
        const scheduledAt = jobItem.scheduledAt;

        const generateJob = await generateQueue.add(
          'generate',
          {
            scheduleId: schedule._id,
            scheduleJobId: jobItem._id,
            keyword: jobItem.keyword,
            account: queue.account,
            scheduledAt,
            service: body.service,
            ref: body.ref,
            generateImages: body.generateImages,
            imageCount: body.imageCount,
            delayBetweenPostsSeconds: body.delayBetweenPostsSeconds,
          }
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
          day: jobItem.day,
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

  app.get('/schedules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    const schedule = await ScheduleModel.findById(id);
    if (!schedule) {
      return reply.status(404).send({ message: 'Schedule not found' });
    }

    const jobs = await ScheduleJobModel.find({ scheduleId: id }).sort({ day: 1, slot: 1 });
    return { schedule, jobs };
  });

  app.delete('/schedules/:id', async (req, reply) => {
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

  app.post('/schedules/:id/execute', async (req, reply) => {
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
      const generateJob = await generateQueue.add('generate', {
        scheduleId: schedule._id,
        scheduleJobId: jobItem._id,
        keyword: jobItem.keyword,
        account: body.account,
        scheduledAt: jobItem.scheduledAt,
        service: schedule.service,
        ref: schedule.ref,
        generateImages: schedule.generateImages,
        imageCount: schedule.imageCount,
        delayBetweenPostsSeconds: schedule.delayBetweenPostsSeconds,
      });

      await ScheduleJobModel.findByIdAndUpdate(jobItem._id, {
        generateJobId: String(generateJob.id),
      });
    }

    return { success: true, enqueued: jobs.length };
  });
}
