import { Job } from 'bullmq';
import { generateManuscript, prepareImages } from '../services/manuscript.service';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema';
import { publishQueue } from './queues';
import { logger } from '../lib/logger';

interface GenerateJobData {
  scheduleId: string;
  scheduleJobId: string;
  keyword: string;
  account: { id: string; password: string };
  scheduledAt: string;
  service: string;
  ref: string;
  generateImages: boolean;
  imageCount: number;
  delayBetweenPostsSeconds: number;
}

export async function processGenerate(job: Job<GenerateJobData>) {
  const {
    scheduleId,
    scheduleJobId,
    keyword,
    account,
    scheduledAt,
    service,
    ref,
    generateImages,
    imageCount,
    delayBetweenPostsSeconds,
  } = job.data;

  logger.info(`[Generate] Starting job ${job.id} for keyword: ${keyword}`);

  await ScheduleModel.findOneAndUpdate(
    { _id: scheduleId, status: 'pending' },
    { status: 'processing' }
  );

  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, { status: 'generating' });

  try {
    logger.info(`[Generate] Generating manuscript for: ${keyword}`);
    const manuscript = await generateManuscript(keyword, service, ref);
    logger.info(`[Generate] Manuscript generated: ${manuscript.title.slice(0, 30)}...`);

    const images = generateImages ? await prepareImages(keyword, imageCount) : [];
    if (images.length > 0) {
      logger.info(`[Generate] Downloaded ${images.length} images`);
    }

    await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
      status: 'generated',
      manuscriptId: manuscript.id,
    });

    const publishJob = await publishQueue.add(
      'publish',
      {
        scheduleId,
        scheduleJobId,
        account,
        manuscript: {
          title: manuscript.title,
          content: manuscript.content,
          images,
        },
        scheduledAt,
        throttleSeconds: delayBetweenPostsSeconds,
      }
    );

    await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
      publishJobId: String(publishJob.id),
    });

    logger.info(`[Generate] Job ${job.id} completed, publish job ${publishJob.id} queued`);

    return { scheduleJobId, publishJobId: publishJob.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= attempts;

    logger.error(`[Generate] Job ${job.id} failed (attempt ${job.attemptsMade + 1}/${attempts}): ${message}`);

    if (isFinalAttempt) {
      logger.error(`[Generate] Job ${job.id} permanently failed after ${attempts} attempts`);

      await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
        status: 'failed',
        error: message,
        completedAt: new Date(),
      });

      const schedule = await ScheduleModel.findByIdAndUpdate(
        scheduleId,
        { $inc: { failedJobs: 1 } },
        { new: true }
      );

      if (schedule && schedule.status !== 'cancelled') {
        const done = schedule.completedJobs + schedule.failedJobs;
        if (done >= schedule.totalJobs) {
          await ScheduleModel.findByIdAndUpdate(scheduleId, { status: 'failed' });
        }
      }
    }

    throw error;
  }
}
