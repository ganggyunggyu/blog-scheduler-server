import { Job, UnrecoverableError } from 'bullmq';
import path from 'path';
import { prepareJob, prepareProductImages, generateAndDownloadAIImages, fetchBodyImagesFromAI, getCategory, type ImageSource, type ManuscriptType, type PreparedProductData } from '../services/manuscript.service.js';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema.js';
import { getPublishQueue, drainAccountQueues } from './queue-manager.js';
import { getValidCookies } from '../services/naver-auth.service.js';
import { failAccountSchedules } from '../services/schedule-failure.service.js';
import { logger } from '../lib/logging/logger.js';

interface GenerateJobData {
  scheduleId: string;
  scheduleJobId: string;
  keyword: string;
  category?: string;
  account: { id: string; password: string; blogId?: string };
  service: string;
  ref: string;
  generateImages: boolean;
  imageCount: number;
  imageSource?: ImageSource;
  manuscriptType?: ManuscriptType;
  delayBetweenPostsSeconds: number;
  scheduledAt: string;
  mode?: 'create' | 'update' | 'image-replace';
  logNo?: string;
  keywordCategory?: string;
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
    imageSource = 'ai',
    manuscriptType = 'default',
    delayBetweenPostsSeconds,
    scheduledAt,
    mode = 'create',
    logNo,
    keywordCategory: providedCategory,
  } = job.data;
  const maskedAccount = account.id.slice(0, 3) + '***';

  log.info('start', {
    jobId: job.id,
    keyword,
    scheduleId,
    scheduleJobId,
    generateImages,
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

    if (mode === 'image-replace') {
      const os = await import('os');
      const fs = await import('fs/promises');
      const imagesDir = path.join(os.default.tmpdir(), `image_replace_${Date.now()}`);
      await fs.mkdir(imagesDir, { recursive: true });

      const blogId = account.blogId || account.id;
      const keywordCategory = providedCategory || await getCategory(keyword);
      const productData = await prepareProductImages(keyword, imagesDir, blogId, providedCategory);
      let bodyImages = productData.bodyImages;

      if (bodyImages.length === 0) {
        bodyImages = await generateAndDownloadAIImages(keyword, imageCount, imagesDir, category);
      }

      log.info('image-replace.prepared', { keyword, images: bodyImages.length });

      const accountPublishQueue = getPublishQueue(account.id);
      const publishJob = await accountPublishQueue.add('publish', {
        scheduleId,
        scheduleJobId,
        account,
        jobDir: imagesDir,
        manuscript: { title: '', content: '', images: bodyImages },
        keywordCategory,
        throttleSeconds: delayBetweenPostsSeconds,
        scheduledAt,
        mode,
        logNo,
      });

      log.info('publish.queued', { jobId: job.id, publishJobId: publishJob.id, mode });
      return { scheduleJobId, publishJobId: publishJob.id };
    }

    const prepared = await prepareJob(keyword, service, ref, imageSource === 'product' ? false : generateImages, imageCount, imageSource, manuscriptType, category);
    log.info('job.prepared', {
      jobDir: prepared.jobDir,
      title: prepared.title.slice(0, 30),
      images: prepared.images.length,
    });

    // product 이미지: 모든 상품 이미지 다운로드
    let productData: PreparedProductData | null = null;
    if (imageSource === 'product') {
      const imagesDir = path.join(prepared.jobDir, 'images');
      const blogId = account.blogId || account.id;
      productData = await prepareProductImages(keyword, imagesDir, blogId, providedCategory);
      log.info('product.prepared', {
        keyword,
        body: productData.bodyImages.length,
        excludeLib: productData.excludeLibrary.length,
        excludeLibLink: productData.excludeLibraryLink.length,
        individual: productData.multiImages.individual?.length ?? 0,
        slide: productData.multiImages.slide?.length ?? 0,
        collage: productData.multiImages.collage?.length ?? 0,
      });

      if (productData.bodyImages.length === 0) {
        productData.bodyImages = await generateAndDownloadAIImages(keyword, imageCount, imagesDir, category);
        log.info('product.fallback.ai', { count: productData.bodyImages.length });
      }
    }

    // 키워드 카테고리 판별 (프론트에서 지정한 값 우선)
    const keywordCategory = providedCategory || await getCategory(keyword);
    log.info('category.resolved', { keyword, keywordCategory, source: providedCategory ? 'provided' : 'api' });

    if (keywordCategory === '안과' && productData && (!productData.multiImages.slide || productData.multiImages.slide.length === 0)) {
      const slideDir = path.join(prepared.jobDir, 'images', 'slide');
      const fs = await import('fs/promises');
      await fs.mkdir(slideDir, { recursive: true });
      productData.multiImages.slide = await generateAndDownloadAIImages(keyword, 5, slideDir, category);
      log.info('product.fallback.slide.ai', { count: productData.multiImages.slide.length });
    }

    const bodyImages = productData ? productData.bodyImages : prepared.images;
    if (bodyImages.length === 0) {
      const imagesDir = path.join(prepared.jobDir, 'images');
      const fallbackImages = await fetchBodyImagesFromAI(keyword, 5, imagesDir);
      if (productData) {
        productData.bodyImages = fallbackImages;
      } else {
        prepared.images = fallbackImages;
      }
      log.info('fallback.body.ai', { count: fallbackImages.length });
    }

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
        images: productData ? productData.bodyImages : prepared.images,
      },
      multiImages: productData?.multiImages,
      excludeLibrary: productData?.excludeLibrary,
      excludeLibraryLink: productData?.excludeLibraryLink,
      category,
      keywordCategory,
      throttleSeconds: delayBetweenPostsSeconds,
      scheduledAt,
      mode,
      logNo,
      metadata: productData?.metadata,
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
