import { Job } from 'bullmq';
import { prepareJob } from '../services/manuscript.service';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema';
import { publishQueue } from './queues';
import { logger } from '../lib/logger';

interface GenerateJobData {
  scheduleId: string;
  scheduleJobId: string;
  keyword: string;
  account: { id: string; password: string };
  service: string;
  ref: string;
  generateImages: boolean;
  imageCount: number;
  delayBetweenPostsSeconds: number;
  scheduledAt: string; // 네이버 예약발행 시간 (ISO format)
}

const log = logger.child({ scope: 'Generate' });

export async function processGenerate(job: Job<GenerateJobData>) {
  const {
    scheduleId,
    scheduleJobId,
    keyword,
    account,
    service,
    ref,
    generateImages,
    imageCount,
    delayBetweenPostsSeconds,
    scheduledAt,
  } = job.data;

  log.info('start', {
    jobId: job.id,
    keyword,
    scheduleId,
    scheduleJobId,
  });

  await ScheduleModel.findOneAndUpdate(
    { _id: scheduleId, status: 'pending' },
    { status: 'processing' }
  );

  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, { status: 'generating' });

  try {
    // 원고 + 이미지를 한 폴더에 준비
    const prepared = await prepareJob(keyword, service, ref, generateImages, imageCount);
    log.info('job.prepared', {
      jobDir: prepared.jobDir,
      title: prepared.title.slice(0, 30),
      images: prepared.images.length,
    });

    await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
      status: 'generated',
      manuscriptId: prepared.manuscriptId,
    });

    const publishJob = await publishQueue.add(
      'publish',
      {
        scheduleId,
        scheduleJobId,
        account,
        jobDir: prepared.jobDir,
        manuscript: {
          title: prepared.title,
          content: prepared.content,
          images: prepared.images,
        },
        throttleSeconds: delayBetweenPostsSeconds,
        scheduledAt, // 네이버 예약발행 시간 전달
      }
    );

    await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
      publishJobId: String(publishJob.id),
    });

    log.info('publish.queued', { jobId: job.id, publishJobId: publishJob.id });

    return { scheduleJobId, publishJobId: publishJob.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= attempts;

    log.error('failed', {
      jobId: job.id,
      attempt: job.attemptsMade + 1,
      attempts,
      message,
    });

    if (isFinalAttempt) {
      log.error('failed.permanent', { jobId: job.id, attempts });

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
