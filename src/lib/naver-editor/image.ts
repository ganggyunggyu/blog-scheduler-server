import type { Frame, Page } from 'playwright';
import { logger } from '../logging/logger.js';

const log = logger.child({ scope: 'Image' });

const IMAGE_BTN_SELECTORS = [
  'button[data-name="image"]',
  'button.se-toolbar-button-image',
  'button[data-name=image]',
  '.se-toolbar button[data-name="image"]',
];

// 이미지 타입
export type ImageType = 'list' | 'collage' | 'slide';

export interface MultiImageData {
  individual?: string[];
  slide?: string[];
  collage?: string[];
}

const IMAGE_TYPE_SELECTORS = {
  list: 'label[for="image-type-list"]',
  collage: 'label[for="image-type-collage"]',
  slide: 'label[for="image-type-slide"]',
};

const getImageTypeFromKey = (key: string): ImageType => {
  if (key === 'collage') return 'collage';
  if (key === 'slide') return 'slide';
  return 'list';
};

const selectImageType = async (frame: Frame, imageType: ImageType): Promise<boolean> => {
  try {
    const selector = IMAGE_TYPE_SELECTORS[imageType];
    const typeLabel = await frame.$(selector);

    if (typeLabel && (await typeLabel.isVisible())) {
      await typeLabel.click();
      log.info('imageType.selected', { type: imageType });
      return true;
    }

    log.warn('imageType.notFound', { type: imageType });
    return false;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('imageType.selectFailed', { type: imageType, message: msg });
    return false;
  }
};

const MAX_FILECHOOSER_RETRIES = 3;

const clickAndWaitForFileChooser = async (
  page: Page,
  frame: Frame,
): Promise<import('playwright').FileChooser> => {
  for (let attempt = 1; attempt <= MAX_FILECHOOSER_RETRIES; attempt++) {
    let imageBtn = null;
    for (const selector of IMAGE_BTN_SELECTORS) {
      imageBtn = await frame.$(selector);
      if (imageBtn) break;
    }

    if (!imageBtn) throw new Error('image button not found');

    await imageBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    try {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10000 }),
        imageBtn.click({ force: true }),
      ]);
      if (attempt > 1) log.info('filechooser.retry.ok', { attempt });
      return fileChooser;
    } catch {
      log.warn('filechooser.retry', { attempt, maxRetries: MAX_FILECHOOSER_RETRIES });
      if (attempt === MAX_FILECHOOSER_RETRIES) throw new Error(`filechooser failed after ${MAX_FILECHOOSER_RETRIES} retries`);
      await page.waitForTimeout(1500);
    }
  }

  throw new Error('filechooser unreachable');
};

export const uploadImage = async (
  page: Page,
  frame: Frame,
  imagePath: string
): Promise<boolean> => {
  const fileName = imagePath.split('/').pop();
  log.info('upload.start', { fileName, path: imagePath });

  const fs = await import('fs/promises');
  try {
    await fs.access(imagePath);
  } catch {
    log.warn('file.missing', { path: imagePath });
    return false;
  }

  try {
    const fileChooser = await clickAndWaitForFileChooser(page, frame);

    log.info('filechooser.ready');
    await fileChooser.setFiles(imagePath);
    await page.waitForTimeout(3000);

    log.info('upload.done', { fileName });
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('upload.failed', { fileName, message: msg });
    return false;
  }
};

// 다중 이미지 업로드 (한 번에 여러 파일)
export const uploadMultipleImages = async (
  page: Page,
  frame: Frame,
  imagePaths: string[],
  imageType: ImageType = 'list'
): Promise<{ success: number; failed: number }> => {
  log.info('multiUpload.start', { count: imagePaths.length, type: imageType });

  if (imagePaths.length === 0) {
    return { success: 0, failed: 0 };
  }

  const fs = await import('fs/promises');
  const validPaths: string[] = [];

  for (const imgPath of imagePaths) {
    try {
      await fs.access(imgPath);
      validPaths.push(imgPath);
    } catch {
      log.warn('file.missing', { path: imgPath });
    }
  }

  if (validPaths.length === 0) {
    log.warn('multiUpload.noValidFiles');
    return { success: 0, failed: imagePaths.length };
  }

  try {
    const fileChooser = await clickAndWaitForFileChooser(page, frame);

    await fileChooser.setFiles(validPaths);
    await page.waitForTimeout(1000);

    if (validPaths.length >= 2) {
      await page.waitForTimeout(1000);
      await selectImageType(frame, imageType);
      await page.waitForTimeout(500);
    }

    const waitTime = Math.min(validPaths.length * 3000, 30000);
    await page.waitForTimeout(waitTime);

    log.info('multiUpload.done', { count: validPaths.length, type: imageType });
    return { success: validPaths.length, failed: imagePaths.length - validPaths.length };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('multiUpload.failed', { message: msg });
    return { success: 0, failed: validPaths.length };
  }
};

// MultiImageData 구조로 업로드 (individual/slide/collage)
export const uploadFromMultiImageData = async (
  page: Page,
  frame: Frame,
  data: MultiImageData
): Promise<{ total: number; success: number; failed: number }> => {
  let total = 0;
  let success = 0;
  let failed = 0;

  const orderedKeys = ['individual', 'slide', 'collage'] as const;

  for (const key of orderedKeys) {
    const images = data[key];
    if (!images || images.length === 0) continue;

    const imageType = getImageTypeFromKey(key);
    log.info('multiUpload.group.start', { key, type: imageType, count: images.length });

    const result = await uploadMultipleImages(page, frame, images, imageType);
    total += images.length;
    success += result.success;
    failed += result.failed;

    await page.waitForTimeout(1000);
  }

  log.info('multiUpload.complete', { total, success, failed });
  return { total, success, failed };
};
