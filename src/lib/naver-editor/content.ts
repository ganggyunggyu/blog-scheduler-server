import type { Frame, Page } from 'playwright';
import { logger } from '../logging/logger.js';
import { ProgressBar } from '../utils/progress.js';
import { uploadImage } from './image.js';
import { insertLink } from './link.js';
import { focusLastParagraphEnd, forceResetTypingStyleToDefault } from './editor.js';

const log = logger.child({ scope: 'Content' });

interface ContentTypingOptions {
  keywordCategory?: string;
  imagePlacement?: 'default' | 'eyeBrand';
  requireAllImages?: boolean;
  minUploadedImages?: number;
}

export interface ContentTypingResult {
  attemptedImages: number;
  uploadedImages: number;
  failedImages: number;
}

const resetPetContentTypingStyle = async (
  page: Page,
  frame: Frame
): Promise<void> => {
  try {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(200);

    const focused = await focusLastParagraphEnd(frame);
    if (!focused) {
      log.warn('content.typingStyle.focus.failed');
      return;
    }

    await page.waitForTimeout(200);
    await forceResetTypingStyleToDefault(page, frame);
    log.info('content.typingStyle.reset');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('content.typingStyle.reset.failed', { message });
  }
};

export const isSubheading = (line: string): boolean => {
  const patterns = [/^\d+\.(?:\s|[가-힣a-zA-Z])/, /^【\d+】/, /^\[\d+\]/, /^▶\s*\d+/];
  const trimmed = line.trim();
  return patterns.some((pattern) => pattern.test(trimmed));
};

const isEyeBrandImagePlaceholderLine = (line: string): boolean =>
  /^\[IMG\](?:\s|$)/.test(line.trim());

const isStandaloneUrlLine = (line: string): boolean =>
  /^https?:\/\/\S+$/.test(line.trim());

export const shouldSkipEyeBrandLine = (line: string): boolean =>
  isEyeBrandImagePlaceholderLine(line) || isStandaloneUrlLine(line);

const shouldInsertEyeBrandLink = (line: string, imagePlacement?: 'default' | 'eyeBrand'): boolean =>
  imagePlacement === 'eyeBrand' && isStandaloneUrlLine(line);

export const typeLineAvoidingAutoList = async (page: Page, line: string): Promise<void> => {
  const numberedMatch = line.match(/^(\d+)\.(\s?)([가-힣a-zA-Z].*)$/);
  if (numberedMatch) {
    const [, number, , text] = numberedMatch;
    await page.keyboard.type(`${number}.`, { delay: 50 });
    await page.waitForTimeout(50);
    await page.keyboard.type('ㅁ', { delay: 50 });
    await page.waitForTimeout(50);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(30);
    await page.keyboard.type(' ', { delay: 50 });
    await page.waitForTimeout(50);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(30);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);
    await page.keyboard.type(text, { delay: 30 });
    return;
  }

  const listMatch = line.match(/^-\s+(.*)$/);
  if (listMatch) {
    const [, text] = listMatch;
    await page.keyboard.type('-', { delay: 50 });
    await page.waitForTimeout(50);
    await page.keyboard.type('ㅁ', { delay: 50 });
    await page.waitForTimeout(50);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(30);
    await page.keyboard.type(' ', { delay: 50 });
    await page.waitForTimeout(50);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(30);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);
    await page.keyboard.type(text, { delay: 30 });
    return;
  }

  await page.keyboard.type(line, { delay: 30 });
};

const getNonEmptyParagraphIndices = (paragraphs: string[]): number[] =>
  paragraphs
    .map((paragraph, index) => (paragraph.trim().length > 0 ? index : -1))
    .filter((index) => index >= 0);

export const buildImageParagraphMap = (
  paragraphs: string[],
  images: string[],
): Map<number, string> => {
  const result = new Map<number, string>();
  const subheadingIndices = paragraphs
    .map((paragraph, index) => (isSubheading(paragraph) ? index : -1))
    .filter((index) => index >= 0);

  if (subheadingIndices.length > 0) {
    subheadingIndices.forEach((index, imageIndex) => {
      if (imageIndex < images.length) {
        result.set(index, images[imageIndex]);
      }
    });
    return result;
  }

  const paragraphIndices = getNonEmptyParagraphIndices(paragraphs);
  const targetCount = Math.min(images.length, paragraphIndices.length);

  for (let imageIndex = 0; imageIndex < targetCount; imageIndex += 1) {
    const paragraphOrder = Math.min(
      paragraphIndices.length - 1,
      Math.floor(((imageIndex + 1) * paragraphIndices.length) / (targetCount + 1)),
    );
    result.set(paragraphIndices[paragraphOrder], images[imageIndex]);
  }

  return result;
};

const isEyeBrandSubheading = (line: string): boolean => {
  const trimmed = line.trim();
  return /^#소제목#/.test(trimmed) || isSubheading(trimmed);
};

const isEyeBrandIntroLine = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed.includes('정밀검사로') && trimmed.includes('에스앤비안과');
};

const findPreviousNonEmptyParagraphIndex = (
  paragraphs: string[],
  startIndex: number,
): number | undefined => {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (paragraphs[index].trim().length > 0) {
      return index;
    }
  }

  return undefined;
};

export const buildEyeBrandImageParagraphMap = (
  paragraphs: string[],
  images: string[],
): Map<number, string> => {
  const result = new Map<number, string>();
  if (images.length === 0) {
    return result;
  }

  const subheadingIndices = paragraphs
    .map((paragraph, index) => (isEyeBrandSubheading(paragraph) ? index : -1))
    .filter((index) => index >= 0);
  const placeholderIndices = paragraphs
    .map((paragraph, index) => (isEyeBrandImagePlaceholderLine(paragraph) ? index : -1))
    .filter((index) => index >= 0);

  if (subheadingIndices.length === 0) {
    return buildImageParagraphMap(paragraphs, images);
  }

  let imageIndex = 0;
  const introLineIndex = paragraphs.findIndex(isEyeBrandIntroLine);
  const firstSubheadingIndex = subheadingIndices[0];
  const introPlaceholderIndex = introLineIndex >= 0
    ? placeholderIndices.find((index) => index > introLineIndex && index < firstSubheadingIndex)
    : undefined;
  const introTargetIndex = introPlaceholderIndex
    ?? (introLineIndex >= 0 ? introLineIndex : findPreviousNonEmptyParagraphIndex(paragraphs, firstSubheadingIndex));
  if (introTargetIndex !== undefined) {
    result.set(introTargetIndex, images[imageIndex]);
    imageIndex += 1;
  }

  for (const placeholderIndex of placeholderIndices) {
    if (imageIndex >= images.length) {
      break;
    }
    if (result.has(placeholderIndex)) {
      continue;
    }

    result.set(placeholderIndex, images[imageIndex]);
    imageIndex += 1;
  }

  for (const subheadingIndex of subheadingIndices) {
    if (imageIndex >= images.length) {
      break;
    }
    if (result.has(subheadingIndex)) {
      continue;
    }

    result.set(subheadingIndex, images[imageIndex]);
    imageIndex += 1;
  }

  const remainingParagraphIndices = getNonEmptyParagraphIndices(paragraphs)
    .filter((index) => !result.has(index) && !shouldSkipEyeBrandLine(paragraphs[index]));
  const remainingImageCount = Math.min(images.length - imageIndex, remainingParagraphIndices.length);
  for (let offset = 0; offset < remainingImageCount; offset += 1) {
    const paragraphOrder = Math.min(
      remainingParagraphIndices.length - 1,
      Math.floor(((offset + 1) * remainingParagraphIndices.length) / (remainingImageCount + 1)),
    );
    result.set(remainingParagraphIndices[paragraphOrder], images[imageIndex]);
    imageIndex += 1;
  }

  return new Map([...result.entries()].sort(([left], [right]) => left - right));
};

export const typeContentWithImages = async (
  page: Page,
  frame: Frame,
  content: string,
  images?: string[],
  options: ContentTypingOptions = {}
): Promise<ContentTypingResult> => {
  const { imagePlacement, keywordCategory, requireAllImages, minUploadedImages } = options;
  const paragraphs = content.split('\n');
  const imageMap = images?.length
    ? imagePlacement === 'eyeBrand'
      ? buildEyeBrandImageParagraphMap(paragraphs, images)
      : buildImageParagraphMap(paragraphs, images)
    : new Map();
  const uploadTotal = imageMap.size;
  const uploadProgress =
    uploadTotal > 0
      ? new ProgressBar({ label: 'upload', total: uploadTotal, width: 14, showStatus: true })
      : null;

  log.info('content.type.start', { paragraphs: paragraphs.length, images: uploadTotal });
  if (uploadProgress) {
    log.info(uploadProgress.start());
  }

  if (keywordCategory === '애견') {
    await resetPetContentTypingStyle(page, frame);
  }

  let uploadedImages = 0;
  const failedImagePaths: string[] = [];

  for (let i = 0; i < paragraphs.length; i += 1) {
    const line = paragraphs[i].trim();
    const shouldInsertLink = shouldInsertEyeBrandLink(line, imagePlacement);
    const shouldTypeLine = line.length > 0 && !(imagePlacement === 'eyeBrand' && shouldSkipEyeBrandLine(line));

    if (shouldInsertLink) {
      const inserted = await insertLink(page, frame, line);
      log.info('content.link.inserted', { success: inserted, url: line });
      if (!inserted) {
        throw new Error(`eye brand link insertion failed: ${line}`);
      }
    } else if (shouldTypeLine) {
      await typeLineAvoidingAutoList(page, line);
    }

    if (i < paragraphs.length - 1) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
    }

    const imagePath = imageMap.get(i);
    if (imagePath) {
      const uploaded = await uploadImage(page, frame, imagePath);
      if (uploadProgress) {
        log.info(uploadProgress.tick(uploaded ? 'ok' : 'fail'));
      }
      if (uploaded) {
        uploadedImages += 1;
      } else {
        failedImagePaths.push(imagePath);
      }
    }
  }

  if (uploadProgress) {
    log.info(uploadProgress.done('done'));
  }

  const requiredImageCount = minUploadedImages ?? (requireAllImages ? uploadTotal : 0);
  if (requiredImageCount > 0 && uploadedImages < requiredImageCount) {
    const firstFailedPath = failedImagePaths[0];
    if (requireAllImages && firstFailedPath) {
      throw new Error(`image upload failed: ${firstFailedPath}`);
    }
    throw new Error(`image upload requirement failed: required=${requiredImageCount} uploaded=${uploadedImages}`);
  }

  if (requireAllImages && failedImagePaths.length > 0) {
    throw new Error(`image upload failed: ${failedImagePaths[0]}`);
  }

  return {
    attemptedImages: uploadTotal,
    uploadedImages,
    failedImages: failedImagePaths.length,
  };
};
