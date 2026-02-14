import type { Frame, Page } from 'playwright';
import { logger } from '../logging/logger.js';
import { getMainFrame } from './frame.js';
import { dismissPopups } from './popup.js';
import { focusEditor } from './editor.js';
import { uploadImage } from './image.js';

const log = logger.child({ scope: 'OneLineManuscript' });

const EXCLUDED_IMAGE_PATTERN = /라이브러리제외/i;

export interface ExcludedImage {
  path: string;
  order: number;
}

export const findExcludedImages = (images: string[]): ExcludedImage[] => {
  const excluded: ExcludedImage[] = [];

  for (const imagePath of images) {
    const fileName = imagePath.split('/').pop() || '';
    if (EXCLUDED_IMAGE_PATTERN.test(fileName)) {
      const match = fileName.match(/_(\d+)\./);
      const order = match ? parseInt(match[1], 10) : 0;
      excluded.push({ path: imagePath, order });
    }
  }

  return excluded.sort((a, b) => a.order - b.order);
};

export const filterNormalImages = (images: string[], excluded: ExcludedImage[]): string[] => {
  const excludedPaths = new Set(excluded.map((e) => e.path));
  return images.filter((img) => !excludedPaths.has(img));
};

/** @deprecated findExcludedImages 사용 권장 */
export const findOneLineManuscriptImage = (images: string[]): string | null => {
  for (const imagePath of images) {
    const fileName = imagePath.split('/').pop() || '';
    if (EXCLUDED_IMAGE_PATTERN.test(fileName)) {
      return imagePath;
    }
  }
  return null;
};

/**
 * 한줄원고 이미지를 클립보드에 준비 (붙여넣기는 별도로 수행)
 * 새 탭 열기 → 이미지 업로드 → Cmd+X → 탭 닫기
 */
export const prepareOneLineClipboard = async (
  page: Page,
  imagePath: string
): Promise<boolean> => {
  log.info('prepare.start', { imagePath });

  const context = page.context();

  try {
    const tempPage = await context.newPage();
    log.info('tempPage.created');

    await tempPage.goto('https://blog.naver.com/GoBlogWrite.naver', {
      waitUntil: 'domcontentloaded',
    });
    await tempPage.waitForTimeout(3000);

    const tempFrame = await getMainFrame(tempPage);
    await tempPage.waitForTimeout(2000);

    await dismissPopups(tempFrame);
    await focusEditor(tempPage, tempFrame);
    log.info('tempPage.ready');

    const uploaded = await uploadImage(tempPage, tempFrame, imagePath);
    if (!uploaded) {
      log.warn('upload.failed');
      await tempPage.close();
      return false;
    }
    await tempPage.waitForTimeout(2000);
    log.info('image.uploaded');

    const imageEl = await tempFrame.$('img.se-image-resource');
    if (!imageEl) {
      log.warn('image.element.notFound');
      await tempPage.close();
      return false;
    }

    await imageEl.click();
    await tempPage.waitForTimeout(500);
    log.info('image.selected');

    const imageComponent = await tempFrame.$('.se-component.se-image');
    if (imageComponent) {
      await imageComponent.click();
      await tempPage.waitForTimeout(300);
    }

    await tempPage.keyboard.press('Meta+a');
    await tempPage.waitForTimeout(200);
    await tempPage.keyboard.press('Meta+x');
    await tempPage.waitForTimeout(500);
    log.info('image.cut');

    await tempPage.close();
    log.info('tempPage.closed');

    log.info('prepare.done');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('prepare.failed', { message });
    return false;
  }
};

/**
 * 클립보드에 있는 이미지를 붙여넣기
 */
export const pasteExcludedImage = async (page: Page): Promise<void> => {
  await page.keyboard.press('Meta+v');
  await page.waitForTimeout(1000);
  log.info('excluded.pasted');
};

/** @deprecated pasteExcludedImage 사용 권장 */
export const pasteOneLineImage = pasteExcludedImage;

/**
 * 라이브러리제외 이미지 업로드 (클립보드 방식)
 * 새 탭 → 업로드 → 잘라내기 → 탭 닫기 → 붙여넣기
 */
export const uploadExcludedImage = async (
  page: Page,
  imagePath: string
): Promise<boolean> => {
  const prepared = await prepareOneLineClipboard(page, imagePath);
  if (!prepared) return false;

  await pasteExcludedImage(page);
  return true;
};

/**
 * @deprecated prepareOneLineClipboard + pasteOneLineImage 사용 권장
 */
export const insertOneLineManuscriptImage = async (
  page: Page,
  frame: Frame,
  imagePath: string
): Promise<boolean> => {
  const prepared = await prepareOneLineClipboard(page, imagePath);
  if (!prepared) return false;

  await focusEditor(page, frame);
  await page.waitForTimeout(300);
  await pasteOneLineImage(page);

  return true;
};
