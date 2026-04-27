import { Job, UnrecoverableError } from 'bullmq';
import { NON_RETRYABLE_ERRORS } from './constants.js';
import { getSession, invalidateSession } from '../services/session.service.js';
import { getValidCookies } from '../services/naver-auth.service.js';
import { writePost, updatePost, updatePostImages } from '../services/naver-blog.service.js';
import { updateJobStatus } from '../services/manuscript.service.js';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema.js';
import { drainAccountQueues } from './queue-manager.js';
import { failAccountSchedules } from '../services/schedule-failure.service.js';
import { logger } from '../lib/logging/logger.js';
import { summarizeScheduleProgress, type ScheduleJobStatus } from './publish-progress.js';
import type { ProductMetadata } from '../types/metadata.js';
import type { MultiImageData, ExcludeLibraryLinkItem } from '../services/manuscript.service.js';
import { assessLoginFailure } from '../services/login-failure.service.js';
import type { ManuscriptType } from '../services/manuscript.service.js';

export interface PublishJobData {
  scheduleId: string;
  scheduleJobId: string;
  account: { id: string; password: string; blogId?: string };
  jobDir: string;
  manuscript: { title: string; content: string; images?: string[] };
  multiImages?: MultiImageData;
  excludeLibrary?: string[];
  excludeLibraryLink?: ExcludeLibraryLinkItem[];
  category?: string;
  throttleSeconds?: number;
  scheduledAt: string;
  mode?: 'create' | 'update' | 'image-replace';
  logNo?: string;
  metadata?: ProductMetadata;
  keywordCategory?: string;
  manuscriptType?: ManuscriptType;
}

const log = logger.child({ scope: 'Publish' });

const isSessionError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('login') ||
    normalized.includes('session') ||
    message.includes('로그인') ||
    message.includes('세션') ||
    message.includes('mainFrame') ||
    (normalized.includes('frame') && normalized.includes('not found'))
  );
};

const NON_RETRYABLE_PUBLISH_ERROR_PATTERNS = [
  '이미지 업로드 실패',
  '이미지 전송 오류',
  'image transfer error',
  '용량 초과 오류',
];

const isNonRetryablePublishError = (message: string): boolean => {
  if (NON_RETRYABLE_PUBLISH_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
    return true;
  }

  return message.includes('elementHandle.click') && message.includes('se-popup-transfer-error');
};

const markScheduleProcessing = async (scheduleId: string): Promise<void> => {
  await ScheduleModel.findOneAndUpdate(
    { _id: scheduleId, status: { $ne: 'cancelled' } },
    { status: 'processing' }
  );
};

const syncScheduleProgress = async (scheduleId: string): Promise<void> => {
  const [schedule, jobs] = await Promise.all([
    ScheduleModel.findById(scheduleId, { status: 1, totalJobs: 1 }),
    ScheduleJobModel.find({ scheduleId }, { status: 1 }),
  ]);

  if (!schedule || schedule.status === 'cancelled') return;

  const summary = summarizeScheduleProgress(
    jobs.map((job) => job.status as ScheduleJobStatus),
    schedule.totalJobs,
  );

  await ScheduleModel.findByIdAndUpdate(scheduleId, {
    status: summary.status,
    completedJobs: summary.completedJobs,
    failedJobs: summary.failedJobs,
  });
};

const markPublishJobRetryReady = async (
  scheduleId: string,
  scheduleJobId: string,
  reason: string,
): Promise<void> => {
  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
    $set: { status: 'generated', error: reason },
    $unset: { completedAt: 1 },
  });
  await syncScheduleProgress(scheduleId);
};

const markPublishJobFailed = async (
  scheduleId: string,
  scheduleJobId: string,
  reason: string,
): Promise<void> => {
  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
    status: 'failed',
    error: reason,
    completedAt: new Date(),
  });
  await syncScheduleProgress(scheduleId);
};

const executePost = async (
  mode: 'create' | 'update' | 'image-replace',
  cookies: unknown[],
  manuscript: { title: string; content: string; images?: string[] },
  category?: string,
  scheduledAt?: string,
  blogId?: string,
  logNo?: string,
  metadata?: ProductMetadata,
  multiImages?: MultiImageData,
  excludeLibrary?: string[],
  excludeLibraryLink?: ExcludeLibraryLinkItem[],
  keywordCategory?: string,
  manuscriptType?: ManuscriptType
) => {
  if (mode === 'image-replace' && blogId && logNo) {
    return updatePostImages({
      cookies,
      blogId,
      logNo,
      images: manuscript.images || [],
      category,
    });
  }
  if (mode === 'update' && blogId && logNo) {
    return updatePost({
      cookies,
      blogId,
      logNo,
      title: manuscript.title,
      content: manuscript.content,
      images: manuscript.images,
      multiImages,
      excludeLibrary,
      excludeLibraryLink,
      category,
      metadata,
      keywordCategory,
      manuscriptType,
    });
  }
  return writePost({
    cookies,
    title: manuscript.title,
    content: manuscript.content,
    images: manuscript.images,
    multiImages,
    excludeLibrary,
    excludeLibraryLink,
    category,
    scheduleTime: scheduledAt,
    metadata,
    keywordCategory,
    manuscriptType,
  });
};

export const processPublish = async (job: Job<PublishJobData>) => {
  const { scheduleId, scheduleJobId, account, jobDir, manuscript, multiImages, excludeLibrary, excludeLibraryLink, category, throttleSeconds, scheduledAt, mode = 'create', logNo, metadata, keywordCategory, manuscriptType } = job.data;
  const blogId = account.blogId || account.id.split('@')[0];
  const maskedAccount = account.id.slice(0, 3) + '***';
  const attempts = job.opts.attempts ?? 1;
  const isFinalAttempt = job.attemptsMade + 1 >= attempts;

  log.info('start', {
    jobId: job.id,
    scheduleId,
    scheduleJobId,
    jobDir,
    titlePreview: manuscript.title.slice(0, 30),
  });

  const existing = await ScheduleJobModel.findById(scheduleJobId);
  if (existing?.status === 'published' && existing?.postUrl) {
    log.warn('already.published', { scheduleJobId, postUrl: existing.postUrl });
    return { success: true, postUrl: existing.postUrl };
  }

  await markScheduleProcessing(scheduleId);
  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
    $set: { status: 'publishing' },
    $unset: { error: 1, completedAt: 1 },
  });
  await syncScheduleProgress(scheduleId);

  if (throttleSeconds && throttleSeconds > 0) {
    log.info('throttle', { seconds: throttleSeconds });
    await new Promise((resolve) => setTimeout(resolve, throttleSeconds * 1000));
  }

  try {
    let cookies = await getSession(account.id);

    if (cookies) {
      log.info('session.cache', { account: maskedAccount, mode });
      const result = await executePost(mode, cookies, manuscript, category, scheduledAt, blogId, logNo, metadata, multiImages, excludeLibrary, excludeLibraryLink, keywordCategory, manuscriptType);

      if (result.success) {
        log.info('completed', { jobId: job.id, postUrl: result.postUrl });
        await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
          $set: {
            status: 'published',
            postUrl: result.postUrl,
            completedAt: new Date(),
          },
          $unset: { error: 1 },
        });
        await syncScheduleProgress(scheduleId);
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

    log.info('auth.start', { account: maskedAccount, mode });
    const auth = await getValidCookies(account.id, account.password);
    log.info('auth.success', { account: maskedAccount, fromCache: auth.fromCache });

    const publishResult = await executePost(mode, auth.cookies, manuscript, category, scheduledAt, blogId, logNo, metadata, multiImages, excludeLibrary, excludeLibraryLink, keywordCategory, manuscriptType);

    if (!publishResult.success) {
      throw new Error(publishResult.message);
    }

    log.info('completed', { jobId: job.id, postUrl: publishResult.postUrl });

    await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
      $set: {
        status: 'published',
        postUrl: publishResult.postUrl,
        completedAt: new Date(),
      },
      $unset: { error: 1 },
    });
    await syncScheduleProgress(scheduleId);
    await updateJobStatus(jobDir, 'success', { postUrl: publishResult.postUrl });

    return publishResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const loginAssessment = assessLoginFailure(message);
    log.error('failed', { jobId: job.id, message });

    if (loginAssessment.isLoginFailure) {
      const reason = loginAssessment.normalizedMessage;

      if (loginAssessment.scope === 'account') {
        await markPublishJobFailed(scheduleId, scheduleJobId, reason);
        await updateJobStatus(jobDir, 'failed', { error: reason });
        await failAccountSchedules(account.id, reason);
        await drainAccountQueues(account.id);
        log.warn('login.failure.account', {
          account: maskedAccount,
          category: loginAssessment.category,
          message: reason,
        });
        throw new UnrecoverableError(reason);
      }

      if (loginAssessment.retryable && !isFinalAttempt) {
        await markPublishJobRetryReady(scheduleId, scheduleJobId, reason);
        log.warn('login.failure.retry', {
          account: maskedAccount,
          category: loginAssessment.category,
          attempt: job.attemptsMade + 1,
          attempts,
          message: reason,
        });
        throw new Error(reason);
      }

      await markPublishJobFailed(scheduleId, scheduleJobId, reason);
      await updateJobStatus(jobDir, 'failed', { error: reason });

      if (!loginAssessment.retryable) {
        throw new UnrecoverableError(reason);
      }

      throw new Error(reason);
    }

    if (NON_RETRYABLE_ERRORS.some((pattern) => message.includes(pattern))) {
      await markPublishJobFailed(scheduleId, scheduleJobId, message);
      await updateJobStatus(jobDir, 'failed', { error: message });
      log.error('failed.non_retryable', { jobId: job.id, message });
      throw new UnrecoverableError(message);
    }

    if (isNonRetryablePublishError(message)) {
      await markPublishJobFailed(scheduleId, scheduleJobId, message);
      await updateJobStatus(jobDir, 'failed', { error: message });
      log.error('failed.non_retryable.publish', { jobId: job.id, message });
      throw new UnrecoverableError(message);
    }

    if (isFinalAttempt) {
      await markPublishJobFailed(scheduleId, scheduleJobId, message);
      await updateJobStatus(jobDir, 'failed', { error: message });
    } else {
      await markPublishJobRetryReady(scheduleId, scheduleJobId, message);
    }

    throw error;
  }
};
