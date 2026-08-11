import type { Frame, Page } from 'playwright';
import { env } from '../../config/env.js';
import { logger } from '../logging/logger.js';
import { focusParagraphEndByIndex } from './editor.js';
import { isSubheading } from './subheading.js';

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
const IMAGE_UPLOAD_ATTEMPTS = 3;
const FILECHOOSER_TIMEOUT_MS = env.PLAYWRIGHT_ACTION_TIMEOUT_MS;
const IMAGE_CLICK_TIMEOUT_MS = env.PLAYWRIGHT_ACTION_TIMEOUT_MS;
const IMAGE_INSERT_TIMEOUT_MS = 12000;
const TRANSFER_ERROR_POPUP_SELECTOR =
  'div[data-group="popupLayer"][data-name="se-popup-transfer-error"]';
const TRANSFER_ERROR_DISMISS_RETRIES = 3;
const TRANSFER_ERROR_CLOSE_SELECTORS = [
  'button.se-popup-button-confirm',
  'button.se-popup-button-cancel',
  'button.se-popup-close-button',
  'button[class*="close"]',
];

const isTransferErrorPopupVisible = async (frame: Frame): Promise<boolean> => {
  const popup = await frame.$(TRANSFER_ERROR_POPUP_SELECTOR);
  if (!popup) return false;
  return popup.isVisible().catch(() => false);
};

const waitForTransferErrorPopupHidden = async (frame: Frame): Promise<boolean> => {
  try {
    await frame.locator(TRANSFER_ERROR_POPUP_SELECTOR).first().waitFor({ state: 'hidden', timeout: 1200 });
    return true;
  } catch {
    return false;
  }
};

const forceRemoveTransferErrorPopup = async (frame: Frame): Promise<number> => {
  try {
    return await frame.evaluate((selector) => {
      const targets = Array.from(document.querySelectorAll(selector));
      for (const el of targets) {
        const target = el as HTMLElement;
        target.style.pointerEvents = 'none';
        target.style.display = 'none';
        target.remove();
      }
      return targets.length;
    }, TRANSFER_ERROR_POPUP_SELECTOR);
  } catch {
    return 0;
  }
};

const getTransferErrorMessage = async (frame: Frame): Promise<string | null> => {
  const popup = await frame.$(TRANSFER_ERROR_POPUP_SELECTOR);
  if (!popup) return null;

  const isVisible = await popup.isVisible().catch(() => false);
  if (!isVisible) return null;

  const message = await popup.evaluate((el) => {
    const nodes = el.querySelectorAll('.se-popup-error-text, .se-popup-error-list li');
    const texts = Array.from(nodes)
      .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter(Boolean);

    if (texts.length > 0) {
      return texts.join(' | ');
    }

    return (el.textContent ?? '').replace(/\s+/g, ' ').trim() || null;
  });

  return message || null;
};

export const dismissTransferErrorPopup = async (
  page: Page,
  frame: Frame
): Promise<string | null> => {
  const initialVisible = await isTransferErrorPopupVisible(frame);
  if (!initialVisible) return null;

  const message = await getTransferErrorMessage(frame);

  for (let attempt = 1; attempt <= TRANSFER_ERROR_DISMISS_RETRIES; attempt++) {
    const popup = await frame.$(TRANSFER_ERROR_POPUP_SELECTOR);
    if (!popup) return message;

    const visible = await popup.isVisible().catch(() => false);
    if (!visible) return message;

    for (const selector of TRANSFER_ERROR_CLOSE_SELECTORS) {
      const btn = await popup.$(selector);
      if (!btn) continue;

      const btnVisible = await btn.isVisible().catch(() => false);
      if (!btnVisible) continue;

      try {
        await btn.click({ force: true, timeout: 1200 });
      } catch {
        // ignore and try next strategy
      }

      if (await waitForTransferErrorPopupHidden(frame)) {
        return message;
      }
    }

    await page.keyboard.press('Escape').catch(() => {});
    if (await waitForTransferErrorPopupHidden(frame)) {
      return message;
    }

    if (attempt < TRANSFER_ERROR_DISMISS_RETRIES) {
      await page.waitForTimeout(150);
    }
  }

  const removed = await forceRemoveTransferErrorPopup(frame);
  if (removed > 0) {
    log.warn('transferErrorPopup.forceRemoved', { removed, message: message ?? '' });
    await page.waitForTimeout(100);
  }

  return message;
};

const clickAndWaitForFileChooser = async (
  page: Page,
  frame: Frame,
): Promise<import('playwright').FileChooser> => {
  for (let attempt = 1; attempt <= MAX_FILECHOOSER_RETRIES; attempt++) {
    await dismissTransferErrorPopup(page, frame);

    let imageBtn = null;
    for (const selector of IMAGE_BTN_SELECTORS) {
      imageBtn = await frame.$(selector);
      if (imageBtn) break;
    }

    if (!imageBtn) throw new Error('image button not found');

    await imageBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    try {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: FILECHOOSER_TIMEOUT_MS }),
        imageBtn.click({ force: true, timeout: IMAGE_CLICK_TIMEOUT_MS }),
      ]);
      if (attempt > 1) log.info('filechooser.retry.ok', { attempt });
      return fileChooser;
    } catch (error) {
      const transferError = await dismissTransferErrorPopup(page, frame);
      if (transferError) {
        throw new Error(`image transfer error: ${transferError}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      log.warn('filechooser.retry', { attempt, maxRetries: MAX_FILECHOOSER_RETRIES, message });
      if (attempt === MAX_FILECHOOSER_RETRIES) throw new Error(`filechooser failed after ${MAX_FILECHOOSER_RETRIES} retries`);
      await page.waitForTimeout(2500);
    }
  }

  throw new Error('filechooser unreachable');
};

const IMAGE_COMPONENT_SELECTOR = '.se-component.se-image';

const countImageComponents = async (frame: Frame): Promise<number> => {
  try {
    return await frame.locator(IMAGE_COMPONENT_SELECTOR).count();
  } catch {
    return 0;
  }
};

const waitForImageComponentIncrease = async (
  frame: Frame,
  beforeCount: number,
): Promise<boolean> => {
  try {
    await frame.waitForFunction(
      ({ selector, before }) => document.querySelectorAll(selector).length > before,
      { selector: IMAGE_COMPONENT_SELECTOR, before: beforeCount },
      { timeout: IMAGE_INSERT_TIMEOUT_MS },
    );
    return true;
  } catch {
    return (await countImageComponents(frame)) > beforeCount;
  }
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

  for (let attempt = 1; attempt <= IMAGE_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const beforeCount = await countImageComponents(frame);
      const fileChooser = await clickAndWaitForFileChooser(page, frame);

      log.info('filechooser.ready', { attempt });
      await fileChooser.setFiles(imagePath);
      await page.waitForTimeout(8000);

      const transferError = await dismissTransferErrorPopup(page, frame);
      if (transferError) {
        log.warn('upload.transfer.error', { fileName, message: transferError, attempt });
      } else if (await waitForImageComponentIncrease(frame, beforeCount)) {
        const afterCount = await countImageComponents(frame);
        log.info('upload.done', { fileName, attempt, beforeCount, afterCount });
        return true;
      } else {
        const afterCount = await countImageComponents(frame);
        log.warn('upload.notInserted', { fileName, attempt, beforeCount, afterCount });
      }
    } catch (error) {
      const transferError = await dismissTransferErrorPopup(page, frame);
      const msg = error instanceof Error ? error.message : String(error);
      log.warn('upload.failed', { fileName, message: msg, transferError: transferError ?? '', attempt });
    }

    if (attempt < IMAGE_UPLOAD_ATTEMPTS) {
      await page.waitForTimeout(2000);
    }
  }

  log.warn('upload.exhausted', { fileName, attempts: IMAGE_UPLOAD_ATTEMPTS });
  return false;
};

export const removeImage = async (
  page: Page,
  frame: Frame,
  index: number
): Promise<boolean> => {
  await dismissTransferErrorPopup(page, frame);

  const images = await frame.$$(IMAGE_COMPONENT_SELECTOR);
  const target = images[index];
  if (!target) {
    log.warn('remove.target.missing', { index, total: images.length });
    return false;
  }

  try {
    await target.click({ timeout: IMAGE_CLICK_TIMEOUT_MS });
    await page.waitForTimeout(500);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
  } catch (error) {
    const transferError = await dismissTransferErrorPopup(page, frame);
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('remove.failed', {
      index,
      message: msg,
      transferError: transferError ?? '',
    });
    return false;
  }

  log.info('remove.done', { index });
  return true;
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

  for (let attempt = 1; attempt <= IMAGE_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const beforeCount = await countImageComponents(frame);
      const fileChooser = await clickAndWaitForFileChooser(page, frame);

      await fileChooser.setFiles(validPaths);
      await page.waitForTimeout(3000);

      if (validPaths.length >= 2) {
        await page.waitForTimeout(2000);
        await selectImageType(frame, imageType);
        await page.waitForTimeout(1000);
      }

      const waitTime = Math.min(validPaths.length * 5000, 45000);
      await page.waitForTimeout(waitTime);

      const transferError = await dismissTransferErrorPopup(page, frame);
      if (transferError) {
        log.warn('multiUpload.transfer.error', { message: transferError, attempt });
      } else if (await waitForImageComponentIncrease(frame, beforeCount)) {
        const afterCount = await countImageComponents(frame);
        log.info('multiUpload.done', { count: validPaths.length, type: imageType, attempt, beforeCount, afterCount });
        return { success: validPaths.length, failed: imagePaths.length - validPaths.length };
      } else {
        const afterCount = await countImageComponents(frame);
        log.warn('multiUpload.notInserted', { count: validPaths.length, type: imageType, attempt, beforeCount, afterCount });
      }
    } catch (error) {
      const transferError = await dismissTransferErrorPopup(page, frame);
      const msg = error instanceof Error ? error.message : String(error);
      log.warn('multiUpload.failed', { message: msg, transferError: transferError ?? '', attempt });
    }

    if (attempt < IMAGE_UPLOAD_ATTEMPTS) {
      await page.waitForTimeout(2000);
    }
  }

  return { success: 0, failed: validPaths.length };
};

export interface SubheadingInsertResult {
  inserted: number;
  matched: number;
}

/**
 * 기존 이미지가 0장인 발행글에 새 이미지를 소제목(1. / 【1】 / [1] / ▶1 패턴)마다
 * 하나씩 끼워 넣는다. 원문 텍스트는 건드리지 않고 각 소제목 문단 끝에 이미지만 추가한다.
 * 소제목을 하나도 못 찾으면 matched=0 을 돌려주고, 호출부가 본문 끝에 몰아서 붙이는
 * 방식으로 폴백해야 한다.
 */
export const insertImagesAtSubheadings = async (
  page: Page,
  frame: Frame,
  images: string[],
): Promise<SubheadingInsertResult> => {
  const paragraphTexts = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('p.se-text-paragraph')).map((p) => p.textContent ?? '')
  );

  const subheadingIndices = paragraphTexts
    .map((text, index) => (isSubheading(text) ? index : -1))
    .filter((index) => index >= 0);

  const targets = subheadingIndices.slice(0, images.length);
  log.info('insertAtSubheadings.plan', {
    subheadings: subheadingIndices.length,
    images: images.length,
    targets: targets.length,
  });

  let inserted = 0;

  for (let i = 0; i < targets.length; i++) {
    const paragraphIndex = targets[i];
    const image = images[i];

    const focused = await focusParagraphEndByIndex(frame, paragraphIndex);
    if (!focused) {
      log.warn('insertAtSubheadings.focus.failed', { paragraphIndex, imageIndex: i });
      continue;
    }

    await page.waitForTimeout(200);
    const uploaded = await uploadImage(page, frame, image);
    if (uploaded) {
      inserted += 1;
    } else {
      const transferError = await dismissTransferErrorPopup(page, frame);
      log.warn('insertAtSubheadings.upload.failed', {
        paragraphIndex,
        imageIndex: i,
        transferError: transferError ?? '',
      });
    }

    await page.waitForTimeout(800);
    log.info('insertAtSubheadings.step', { index: i + 1, total: targets.length });
  }

  log.info('insertAtSubheadings.done', { inserted, matched: targets.length });
  return { inserted, matched: targets.length };
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
