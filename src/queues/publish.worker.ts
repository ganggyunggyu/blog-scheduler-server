import { Job, UnrecoverableError } from 'bullmq';
import { NON_RETRYABLE_ERRORS } from './constants';
import { getSession, invalidateSession } from '../services/session.service';
import { getValidCookies } from '../services/naver-auth.service';
import { writePost } from '../services/naver-blog.service';
import { updateJobStatus } from '../services/manuscript.service';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema';
import { logger } from '../lib/logger';

interface PublishJobData {
  scheduleId: string;
  scheduleJobId: string;
  account: { id: string; password: string };
  jobDir: string;
  manuscript: { title: string; content: string; images?: string[] };
  throttleSeconds?: number;
  scheduledAt: string; // 네이버 예약발행 시간 (ISO format)
}

const log = logger.child({ scope: 'Publish' });

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


export async function processPublish(job: Job<PublishJobData>) {
  const { scheduleId, scheduleJobId, account, jobDir, manuscript, throttleSeconds, scheduledAt } = job.data;
  const maskedAccount = account.id.slice(0, 3) + '***';

  log.info('start', {
    jobId: job.id,
    scheduleId,
    scheduleJobId,
    jobDir,
    titlePreview: manuscript.title.slice(0, 30),
  });

  await markScheduleProcessing(scheduleId);
  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, { status: 'publishing' });

  if (throttleSeconds && throttleSeconds > 0) {
    log.info('throttle', { seconds: throttleSeconds });
    await new Promise((resolve) => setTimeout(resolve, throttleSeconds * 1000));
  }

  try {
    let cookies = await getSession(account.id);

    if (cookies) {
      log.info('session.cache', { account: maskedAccount });
      const result = await writePost({
        cookies,
        title: manuscript.title,
        content: manuscript.content,
        images: manuscript.images,
        scheduleTime: scheduledAt, // 네이버 예약발행 시간
      });

      if (result.success) {
        log.info('completed', { jobId: job.id, postUrl: result.postUrl });
        await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
          status: 'published',
          postUrl: result.postUrl,
          completedAt: new Date(),
        });
        await updateScheduleCompletion(scheduleId, false);
        await updateJobStatus(jobDir, 'success', { postUrl: result.postUrl });
        return result;
      }

      if (isSessionError(result.message)) {
        log.warn('session.expired', { account: maskedAccount });
        await invalidateSession(account.id);
        cookies = null;
      } else {
        throw new Error(result.message);
      }
    }

    log.info('auth.start', { account: maskedAccount });
    const auth = await getValidCookies(account.id, account.password);
    log.info('auth.success', { account: maskedAccount, fromCache: auth.fromCache });

    const publishResult = await writePost({
      cookies: auth.cookies,
      title: manuscript.title,
      content: manuscript.content,
      images: manuscript.images,
      scheduleTime: scheduledAt, // 네이버 예약발행 시간
    });

    if (!publishResult.success) {
      throw new Error(publishResult.message);
    }

    log.info('completed', { jobId: job.id, postUrl: publishResult.postUrl });

    await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
      status: 'published',
      postUrl: publishResult.postUrl,
      completedAt: new Date(),
    });
    await updateScheduleCompletion(scheduleId, false);
    await updateJobStatus(jobDir, 'success', { postUrl: publishResult.postUrl });

    return publishResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('failed', { jobId: job.id, message });

    await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
      status: 'failed',
      error: message,
      completedAt: new Date(),
    });
    await updateScheduleCompletion(scheduleId, true);
    await updateJobStatus(jobDir, 'failed', { error: message });

    if (NON_RETRYABLE_ERRORS.some((pattern) => message.includes(pattern))) {
      log.error('failed.non_retryable', { jobId: job.id, message });
      throw new UnrecoverableError(message);
    }

    throw error;
  }
}
