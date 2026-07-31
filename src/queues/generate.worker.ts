import { Job, UnrecoverableError } from 'bullmq';
import path from 'path';
import { prepareJob, prepareProvidedJob, prepareProductImages, generateAndDownloadAIImages, fetchBodyImagesFromAI, getCategory, type ImageSource, type ManuscriptType, type PreparedProductData, type ProvidedManuscript, type MultiImageData } from '../services/manuscript.service.js';
import { lookupBlogUtmUrl } from '../services/google-sheets.service.js';
import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema.js';
import { getPublishQueue, drainAccountQueues } from './queue-manager.js';
import { getValidCookies } from '../services/naver-auth.service.js';
import { failAccountSchedules } from '../services/schedule-failure.service.js';
import { assessLoginFailure } from '../services/login-failure.service.js';
import { buildSchedulePublishJobId } from '../services/schedule-idempotency.service.js';
import { logger } from '../lib/logging/logger.js';
import { getFallbackSlideImageCount } from '../services/naver-blog-pipeline.js';
import { buildProvidedProductData, hasMultiImageData, hasPreparedBodyImages, needsBodyImageFallback } from '../services/local-publish-assets.service.js';

export interface GenerateJobData {
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
  blogName?: string;
  /** 맛집1/맛집2 에서 조사 대상 업체를 고정할 때만 채움. */
  businessName?: string;
  /** 다붓 Project id. 있으면 manuscriptType 대신 이 프로젝트로 원고를 뽑음. */
  projectId?: string;
  /**
   * 프로젝트를 소유한 다붓 계정 id. 다붓이 프로젝트를 owner_id 로 격리해 읽어서
   * 이게 없으면 프로젝트 경로가 401 로 떨어짐. 토큰이 아니라 id 만 싣는다.
   */
  ownerId?: string;
  /** 계정별로 만든 본문 블록 순서. 발행 잡으로 그대로 넘김. */
  contentBlocks?: string[];
  providedManuscript?: ProvidedManuscript;
  providedMultiImages?: MultiImageData;
  imageDateCode?: string;
}

const log = logger.child({ scope: 'Generate' });

class LoginPrecheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginPrecheckError';
  }
}

const markGenerateJobRetryPending = async (
  scheduleJobId: string,
  reason: string,
): Promise<void> => {
  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
    $set: { status: 'pending', error: reason },
    $unset: { completedAt: 1 },
  });
};

const markGenerateJobFailed = async (
  scheduleId: string,
  scheduleJobId: string,
  reason: string,
): Promise<void> => {
  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
    status: 'failed',
    error: reason,
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
};

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
    blogName,
    businessName,
    projectId,
    ownerId,
    contentBlocks,
    providedManuscript,
    providedMultiImages,
    imageDateCode,
  } = job.data;
  const maskedAccount = account.id.slice(0, 3) + '***';

  log.info('start', {
    jobId: job.id,
    keyword,
    scheduleId,
    scheduleJobId,
    generateImages,
  });

  const [schedule, scheduleJob] = await Promise.all([
    ScheduleModel.findById(scheduleId).select('status').lean(),
    ScheduleJobModel.findById(scheduleJobId).select('status').lean(),
  ]);

  if (schedule?.status === 'cancelled' || scheduleJob?.status === 'cancelled') {
    log.warn('cancelled.skip', { jobId: job.id, scheduleId, scheduleJobId });
    return { scheduleJobId, skipped: true };
  }

  await ScheduleModel.findOneAndUpdate({ _id: scheduleId, status: 'pending' }, { status: 'processing' });

  await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
    $set: { status: 'generating' },
    $unset: { error: 1, completedAt: 1 },
  });

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
      const dateCodeForImages = imageDateCode ?? scheduledAt.slice(5, 7) + scheduledAt.slice(8, 10);
      const productData = await prepareProductImages({
        keyword,
        imagesDir,
        blogId,
        category: providedCategory,
        dateCode: dateCodeForImages,
        blogName,
        manuscriptType,
      });
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
      }, {
        jobId: buildSchedulePublishJobId(scheduleJobId),
      });

      log.info('publish.queued', { jobId: job.id, publishJobId: publishJob.id, mode });
      return { scheduleJobId, publishJobId: publishJob.id };
    }

    const prepared = providedManuscript
      ? await prepareProvidedJob(
        keyword,
        service,
        ref,
        providedManuscript,
        imageSource === 'product' ? false : generateImages,
        imageCount,
        imageSource,
        manuscriptType,
      )
      : await prepareJob(
        keyword,
        service,
        ref,
        imageSource === 'product' ? false : generateImages,
        imageCount,
        imageSource,
        manuscriptType,
        category,
        { businessName, blogName, projectId, ownerId },
      );
    log.info('job.prepared', {
      jobDir: prepared.jobDir,
      title: prepared.title.slice(0, 30),
      images: prepared.images.length,
      source: providedManuscript ? 'manual' : 'api',
    });

    // product 이미지: 모든 상품 이미지 다운로드
    const hasProvidedImages = hasMultiImageData(providedMultiImages);
    let productData: PreparedProductData | null = buildProvidedProductData(providedMultiImages);
    if (productData) {
      log.info('local.images.prepared', {
        individual: productData.multiImages.individual?.length ?? 0,
        slide: productData.multiImages.slide?.length ?? 0,
        collage: productData.multiImages.collage?.length ?? 0,
      });
    }

    if (imageSource === 'product' && !hasProvidedImages) {
      const imagesDir = path.join(prepared.jobDir, 'images');
      const blogId = account.blogId || account.id;
      const dateCodeForProduct = imageDateCode ?? scheduledAt.slice(5, 7) + scheduledAt.slice(8, 10);
      productData = await prepareProductImages({
        keyword,
        imagesDir,
        blogId,
        category: providedCategory,
        dateCode: dateCodeForProduct,
        blogName,
        manuscriptType,
      });
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

    const fallbackSlideImageCount = getFallbackSlideImageCount(keywordCategory);
    if (!hasProvidedImages && fallbackSlideImageCount && productData && (!productData.multiImages.slide || productData.multiImages.slide.length === 0)) {
      const slideDir = path.join(prepared.jobDir, 'images', 'slide');
      const fs = await import('fs/promises');
      await fs.mkdir(slideDir, { recursive: true });
      productData.multiImages.slide = await generateAndDownloadAIImages(keyword, fallbackSlideImageCount, slideDir, category);
      log.info('product.fallback.slide.ai', { count: productData.multiImages.slide.length });
    }

    const bodyImages = productData ? productData.bodyImages : prepared.images;
    if (needsBodyImageFallback({ keywordCategory, bodyImages, multiImages: productData?.multiImages }) && imageSource !== 'local') {
      const imagesDir = path.join(prepared.jobDir, 'images');
      const fallbackImages = await fetchBodyImagesFromAI(keyword, 5, imagesDir);
      if (fallbackImages.length === 0) {
        const aiImages = await generateAndDownloadAIImages(keyword, imageCount, imagesDir, category);
        if (productData) {
          productData.bodyImages = aiImages;
        } else {
          prepared.images = aiImages;
        }
        log.info('fallback.body.ai-gen', { count: aiImages.length });
      } else {
        if (productData) {
          productData.bodyImages = fallbackImages;
        } else {
          prepared.images = fallbackImages;
        }
        log.info('fallback.body.s3', { count: fallbackImages.length });
      }
    }

    const hasAlibabaImages = productData
      ? hasPreparedBodyImages(productData)
      : prepared.images.length > 0;
    if (manuscriptType === 'alibaba' && !hasAlibabaImages) {
      throw new Error(`alibaba image data missing: keyword=${keyword}`);
    }

    await ScheduleJobModel.findByIdAndUpdate(scheduleJobId, {
      status: 'generated',
      manuscriptId: prepared.manuscriptId,
    });

    let metadata = productData?.metadata;

    if (manuscriptType === 'hanryeodamwon' && blogName) {
      const dateCode = scheduledAt.slice(5, 7) + scheduledAt.slice(8, 10);
      const utmUrl = await lookupBlogUtmUrl(dateCode, blogName, keyword);
      if (utmUrl) {
        metadata = { ...metadata, url: utmUrl };
        log.info('utm.applied', { keyword, blogName, dateCode, url: utmUrl.slice(0, 60) });
      }
    }

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
      manuscriptType,
      contentBlocks,
      throttleSeconds: delayBetweenPostsSeconds,
      scheduledAt,
      mode,
      logNo,
      metadata,
    }, {
      jobId: buildSchedulePublishJobId(scheduleJobId),
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
      const assessment = assessLoginFailure(message, { forceLoginContext: true });
      const reason = assessment.normalizedMessage;

      log.error('login.precheck.failed', {
        jobId: job.id,
        account: maskedAccount,
        message: reason,
        category: assessment.category,
        retryable: assessment.retryable,
        scope: assessment.scope,
      });

      if (assessment.scope === 'account') {
        await markGenerateJobFailed(scheduleId, scheduleJobId, reason);
        await failAccountSchedules(account.id, reason);
        await drainAccountQueues(account.id);
        throw new UnrecoverableError(reason);
      }

      if (!isFinalAttempt && assessment.retryable) {
        await markGenerateJobRetryPending(scheduleJobId, reason);
        log.warn('login.precheck.retry', {
          jobId: job.id,
          account: maskedAccount,
          attempt: job.attemptsMade + 1,
          attempts,
          message: reason,
        });
        throw new Error(reason);
      }

      await markGenerateJobFailed(scheduleId, scheduleJobId, reason);

      if (!assessment.retryable) {
        throw new UnrecoverableError(reason);
      }

      throw new Error(reason);
    }

    log.error('failed', {
      jobId: job.id,
      attempt: job.attemptsMade + 1,
      attempts,
      message,
    });

    if (!isFinalAttempt) {
      await markGenerateJobRetryPending(scheduleJobId, message);
    }

    if (isFinalAttempt) {
      log.error('failed.permanent', { jobId: job.id, attempts });
      await markGenerateJobFailed(scheduleId, scheduleJobId, message);
    }

    throw error;
  }
};
