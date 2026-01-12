import { Job, UnrecoverableError } from 'bullmq';
import { prepareJob } from '../services/manuscript.service';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema';
import { getPublishQueue, drainAccountQueues } from './queue-manager';
import { getValidCookies } from '../services/naver-auth.service';
import { failAccountSchedules } from '../services/schedule-failure.service';
import { logger } from '../lib/logger';

interface GenerateJobData {
  scheduleId: string;
  scheduleJobId: string;
  keyword: string;
  category?: string;
  account: { id: string; password: string };
  service: string;
  ref: string;
  generateImages: boolean;
  imageCount: number;
  delayBetweenPostsSeconds: number;
  scheduledAt: string;
}

const log = logger.child({ scope: 'Generate' });

class LoginPrecheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginPrecheckError';
  }
}

const normalizeLoginFailure = (message: string): string =>
  message.includes('로그인') ? message : `로그인 실패: ${message}`;

export const processGenerate = async (job: Job<GenerateJobData>) => {
  const {
    scheduleId,
    scheduleJobId,
    keyword,
    category,
    account,
    service,
    ref,
    generateImages,
    imageCount,
    delayBetweenPostsSeconds,
    scheduledAt,
  } = job.data;
  const maskedAccount = account.id.slice(0, 3) + '***';

  log.info('start', {
    jobId: job.id,
    keyword,
    scheduleId,
    scheduleJobId,
  });

  await ScheduleModel.findOneAndUpdate({ _id: scheduleId, status: 'pending' }, { status: 'processing' });

  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, { status: 'generating' });

  try {
    log.info('login.precheck.start', { account: maskedAccount });
    try {
      await getValidCookies(account.id, account.password);
      log.info('login.precheck.success', { account: maskedAccount });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LoginPrecheckError(message);
    }

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

    const accountPublishQueue = getPublishQueue(account.id);
    const publishJob = await accountPublishQueue.add('publish', {
      scheduleId,
      scheduleJobId,
      account,
      jobDir: prepared.jobDir,
      manuscript: {
        title: prepared.title,
        content: prepared.content,
        images: prepared.images,
      },
      category,
      throttleSeconds: delayBetweenPostsSeconds,
      scheduledAt,
    });

    await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
      publishJobId: String(publishJob.id),
    });

    log.info('publish.queued', { jobId: job.id, publishJobId: publishJob.id });

    return { scheduleJobId, publishJobId: publishJob.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= attempts;

    if (error instanceof LoginPrecheckError) {
      const reason = normalizeLoginFailure(message);
      log.error('login.precheck.failed', {
        jobId: job.id,
        account: maskedAccount,
        message: reason,
      });

      await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
        status: 'failed',
        error: reason,
        completedAt: new Date(),
      });

      await failAccountSchedules(account.id, reason);
      await drainAccountQueues(account.id);

      throw new UnrecoverableError(reason);
    }

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
};
