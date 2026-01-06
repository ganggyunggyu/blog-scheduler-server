import { Job, UnrecoverableError } from 'bullmq';
import { parseISO } from 'date-fns';
import { rm } from 'fs/promises';
import { NON_RETRYABLE_ERRORS } from './constants';
import { getSession, invalidateSession } from '../services/session.service';
import { getValidCookies } from '../services/naver-auth.service';
import { shouldPublishImmediately, writePost } from '../services/naver-blog.service';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema';
import { logger } from '../lib/logger';

interface PublishJobData {
  scheduleId: string;
  scheduleJobId: string;
  account: { id: string; password: string };
  manuscript: { title: string; content: string; images?: string[] };
  scheduledAt: string;
  throttleSeconds?: number;
}

function isSessionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('login') || normalized.includes('session') || message.includes('로그인');
}

async function markScheduleProcessing(scheduleId: string): Promise<void> {
  await ScheduleModel.findOneAndUpdate(
    { _id: scheduleId, status: 'pending' },
    { status: 'processing' }
  );
}

async function updateScheduleCompletion(scheduleId: string, failed: boolean): Promise<void> {
  const schedule = await ScheduleModel.findByIdAndUpdate(
    scheduleId,
    { $inc: failed ? { failedJobs: 1 } : { completedJobs: 1 } },
    { new: true }
  );

  if (!schedule || schedule.status === 'cancelled') return;

  const done = schedule.completedJobs + schedule.failedJobs;
  if (done >= schedule.totalJobs) {
    const status = schedule.failedJobs > 0 ? 'failed' : 'completed';
    await ScheduleModel.findByIdAndUpdate(scheduleId, { status });
  }
}

async function cleanupImages(images?: string[]): Promise<void> {
  if (!images || images.length === 0) return;
  await Promise.all(
    images.map(async (image) => {
      try {
        await rm(image, { force: true });
      } catch {
        return;
      }
    })
  );
}

export async function processPublish(job: Job<PublishJobData>) {
  const { scheduleId, scheduleJobId, account, manuscript, scheduledAt, throttleSeconds } = job.data;
  const maskedAccount = account.id.slice(0, 3) + '***';

  logger.info(`[Publish] Starting job ${job.id} for: ${manuscript.title.slice(0, 30)}...`);

  await markScheduleProcessing(scheduleId);
  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, { status: 'publishing' });

  if (throttleSeconds && throttleSeconds > 0) {
    logger.info(`[Publish] Throttling for ${throttleSeconds}s`);
    await new Promise((resolve) => setTimeout(resolve, throttleSeconds * 1000));
  }

  const scheduledTime = parseISO(scheduledAt);
  const scheduleTime = shouldPublishImmediately(scheduledTime) ? undefined : scheduledTime;

  if (scheduleTime) {
    logger.info(`[Publish] Scheduling for: ${scheduledAt}`);
  }

  try {
    let cookies = await getSession(account.id);

    if (cookies) {
      logger.info(`[Publish] Using cached session for ${maskedAccount}`);
      const result = await writePost({
        cookies,
        title: manuscript.title,
        content: manuscript.content,
        images: manuscript.images,
        scheduleTime,
      });

      if (result.success) {
        logger.info(`[Publish] Job ${job.id} completed: ${result.postUrl}`);
        await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
          status: 'published',
          postUrl: result.postUrl,
          completedAt: new Date(),
        });
        await updateScheduleCompletion(scheduleId, false);
        await cleanupImages(manuscript.images);
        return result;
      }

      if (isSessionError(result.message)) {
        logger.warn(`[Publish] Session expired for ${maskedAccount}, re-authenticating`);
        await invalidateSession(account.id);
        cookies = null;
      } else {
        throw new Error(result.message);
      }
    }

    logger.info(`[Publish] Authenticating ${maskedAccount}`);
    const auth = await getValidCookies(account.id, account.password);
    logger.info(`[Publish] Auth success, fromCache: ${auth.fromCache}`);

    const publishResult = await writePost({
      cookies: auth.cookies,
      title: manuscript.title,
      content: manuscript.content,
      images: manuscript.images,
      scheduleTime,
    });

    if (!publishResult.success) {
      throw new Error(publishResult.message);
    }

    logger.info(`[Publish] Job ${job.id} completed: ${publishResult.postUrl}`);

    await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
      status: 'published',
      postUrl: publishResult.postUrl,
      completedAt: new Date(),
    });
    await updateScheduleCompletion(scheduleId, false);
    await cleanupImages(manuscript.images);

    return publishResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Publish] Job ${job.id} failed: ${message}`);

    await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
      status: 'failed',
      error: message,
      completedAt: new Date(),
    });
    await updateScheduleCompletion(scheduleId, true);
    await cleanupImages(manuscript.images);

    if (NON_RETRYABLE_ERRORS.some((pattern) => message.includes(pattern))) {
      logger.error(`[Publish] Non-retryable error, marking as permanently failed`);
      throw new UnrecoverableError(message);
    }

    throw error;
  }
}
