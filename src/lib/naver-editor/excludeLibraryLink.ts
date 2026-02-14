import path from 'path';
import type { Frame, Page } from 'playwright';
import { logger } from '../logging/logger.js';
import { uploadExcludedImage } from './oneLineManuscript.js';
import type { ExcludeLibraryLinkItem } from '../../types/metadata.js';

const log = logger.child({ scope: 'ExcludeLibraryLink' });

const SELECTORS = {
  imageResource: 'img.se-image-resource',
  imageComponent: '.se-component.se-image',
  imageLinkBtn: 'button[data-name="image-link"]',
  linkInput: 'input.se-custom-layer-link-input',
};

export interface ExcludeLibraryLinkResult {
  total: number;
  success: number;
  failed: number;
}

/**
 * 업로드된 이미지를 src의 인코딩된 파일명으로 찾아서 클릭
 */
const findAndClickImage = async (
  frame: Frame,
  imagePath: string
): Promise<boolean> => {
  const basename = path.basename(imagePath, path.extname(imagePath));
  const encodedName = encodeURIComponent(basename);

  const images = await frame.$$(SELECTORS.imageResource);

  // src에 인코딩된 파일명이 포함된 이미지 찾기 (마지막부터 탐색)
  for (let i = images.length - 1; i >= 0; i--) {
    const src = await images[i].getAttribute('src');
    if (src?.includes(encodedName)) {
      await images[i].click({ force: true });
      log.info('image.found', { basename, index: i });
      return true;
    }
  }

  // fallback: 마지막 이미지 클릭
  if (images.length) {
    await images[images.length - 1].click({ force: true });
    log.info('image.fallback', { basename, lastIndex: images.length - 1 });
    return true;
  }

  log.warn('image.notFound', { basename });
  return false;
};

/**
 * 이미지 선택 후 image-link 버튼으로 링크 추가
 */
const addImageLink = async (
  page: Page,
  frame: Frame,
  url: string
): Promise<boolean> => {
  const linkBtn = await frame.$(SELECTORS.imageLinkBtn);
  if (!linkBtn) {
    log.warn('imageLinkBtn.notFound');
    return false;
  }
  await linkBtn.click();
  await page.waitForTimeout(500);
  log.info('imageLinkBtn.clicked');

  const linkInput = await frame.$(SELECTORS.linkInput);
  if (!linkInput) {
    log.warn('linkInput.notFound');
    return false;
  }
  await linkInput.fill(url);
  await page.waitForTimeout(300);
  log.info('linkInput.filled', { url });

  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  log.info('link.confirmed');

  return true;
};

/**
 * excludeLibraryLink 아이템 하나를 삽입
 * 1) 클립보드 방식으로 이미지 업로드
 * 2) src의 인코딩된 파일명으로 이미지 감지 → 클릭
 * 3) image-link 버튼 → URL 입력 → Enter
 */
export const insertExcludeLibraryLinkItem = async (
  page: Page,
  frame: Frame,
  item: ExcludeLibraryLinkItem
): Promise<boolean> => {
  log.info('item.start', { imagePath: item.imagePath, url: item.url });

  const uploaded = await uploadExcludedImage(page, item.imagePath);
  if (!uploaded) {
    log.warn('item.image.failed', { imagePath: item.imagePath });
    return false;
  }
  await page.waitForTimeout(1000);

  if (item.url) {
    const clicked = await findAndClickImage(frame, item.imagePath);
    if (!clicked) {
      log.warn('item.click.failed', { imagePath: item.imagePath });
      return false;
    }
    await page.waitForTimeout(500);

    const linked = await addImageLink(page, frame, item.url);
    if (!linked) {
      log.warn('item.link.failed', { url: item.url });
      return false;
    }
  }

  log.info('item.done', { imagePath: item.imagePath, url: item.url });
  return true;
};

/**
 * excludeLibraryLink 전체 삽입
 */
export const insertExcludeLibraryLinks = async (
  page: Page,
  frame: Frame,
  items: ExcludeLibraryLinkItem[]
): Promise<ExcludeLibraryLinkResult> => {
  if (!items.length) {
    log.info('skip', { reason: 'empty' });
    return { total: 0, success: 0, failed: 0 };
  }

  log.info('start', { count: items.length });
  let success = 0;
  let failed = 0;

  for (const item of items) {
    const ok = await insertExcludeLibraryLinkItem(page, frame, item);
    if (ok) success++;
    else failed++;
  }

  log.info('done', { total: items.length, success, failed });
  return { total: items.length, success, failed };
};
