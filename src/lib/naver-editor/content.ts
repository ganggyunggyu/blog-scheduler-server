import type { Frame, Page } from 'playwright';
import { logger } from '../logging/logger.js';
import { ProgressBar } from '../utils/progress.js';
import { uploadImage } from './image.js';
import { focusLastParagraphEnd, forceResetTypingStyleToDefault } from './editor.js';

const log = logger.child({ scope: 'Content' });

interface ContentTypingOptions {
  keywordCategory?: string;
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

const matchImagesToSubheadings = (paragraphs: string[], images: string[]): Map<number, string> => {
  const result = new Map<number, string>();
  const subheadingIndices = paragraphs
    .map((paragraph, index) => (isSubheading(paragraph) ? index : -1))
    .filter((index) => index >= 0);

  subheadingIndices.forEach((index, i) => {
    if (i < images.length) {
      result.set(index, images[i]);
    }
  });

  return result;
};

export const typeContentWithImages = async (
  page: Page,
  frame: Frame,
  content: string,
  images?: string[],
  options: ContentTypingOptions = {}
): Promise<void> => {
  const { keywordCategory } = options;
  const paragraphs = content.split('\n');
  const imageMap = images?.length ? matchImagesToSubheadings(paragraphs, images) : new Map();
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

  for (let i = 0; i < paragraphs.length; i += 1) {
    const line = paragraphs[i].trim();

    if (line.length > 0) {
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
    }
  }

  if (uploadProgress) {
    log.info(uploadProgress.done('done'));
  }
};
