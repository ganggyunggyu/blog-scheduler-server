import { access } from 'fs/promises';
import path from 'path';

import { IMAGE_BTN_SELECTORS, IMAGE_TYPE_SELECTORS, UPLOAD_WAIT_MS_PER_IMAGE } from './constants.ts';

import type { Frame, Page } from 'playwright';
import type { ImageType, UploadResult } from './types.ts';

export interface UploadOptions {
  imageType?: ImageType;
  validateFiles?: boolean;
  maxWaitMs?: number;
}

export const getImageTypeFromKey = (key: string): ImageType => {
  if (key === '콜라주') return 'collage';
  if (key === '슬라이드') return 'slide';
  return 'list';
};

const selectImageType = async (frame: Frame, imageType: ImageType): Promise<boolean> => {
  try {
    const selector = IMAGE_TYPE_SELECTORS[imageType];
    const typeLabel = await frame.$(selector);

    if (typeLabel && (await typeLabel.isVisible())) {
      await typeLabel.click();
      console.log(`이미지 타입 선택: ${imageType}`);
      return true;
    }

    console.warn(`이미지 타입 라벨을 찾을 수 없음: ${imageType}`);
    return false;
  } catch (error) {
    console.error(`타입 선택 실패: ${String(error)}`);
    return false;
  }
};

const findImageButton = async (frame: Frame) => {
  for (const selector of IMAGE_BTN_SELECTORS) {
    const imageBtn = await frame.$(selector);
    if (imageBtn) {
      console.log(`버튼 발견: ${selector}`);
      return imageBtn;
    }
  }

  return null;
};

const filterValidPaths = async (imagePaths: string[]): Promise<string[]> => {
  const validPaths: string[] = [];

  for (const imagePath of imagePaths) {
    try {
      await access(imagePath);
      validPaths.push(imagePath);
    } catch {
      console.warn(`파일 없음: ${imagePath}`);
    }
  }

  return validPaths;
};

const resolveWaitTime = (imageCount: number, maxWaitMs?: number): number => {
  const baseWait = imageCount * UPLOAD_WAIT_MS_PER_IMAGE;
  if (typeof maxWaitMs !== 'number') return baseWait;
  return Math.min(baseWait, maxWaitMs);
};

export const uploadMultipleImages = async (
  page: Page,
  frame: Frame,
  imagePaths: string[],
  options: UploadOptions = {}
): Promise<UploadResult> => {
  const { imageType = 'list', validateFiles = false, maxWaitMs } = options;
  console.log(`다중 업로드 시작: ${imagePaths.length}개 이미지 (타입: ${imageType})`);

  if (imagePaths.length === 0) {
    return { success: 0, failed: 0 };
  }

  const targetPaths = validateFiles ? await filterValidPaths(imagePaths) : imagePaths;
  if (targetPaths.length === 0) {
    if (validateFiles) {
      console.error('유효한 이미지 파일이 없음');
      return { success: 0, failed: imagePaths.length };
    }
    return { success: 0, failed: 0 };
  }

  try {
    const imageBtn = await findImageButton(frame);
    if (!imageBtn) {
      console.error('이미지 버튼을 찾을 수 없음');
      return { success: 0, failed: targetPaths.length };
    }

    console.log('이미지 버튼 클릭...');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      imageBtn.click({ force: true }),
    ]);

    console.log('파일 선택 다이얼로그 열림');
    console.log(`선택할 파일: ${targetPaths.length}개`);
    for (const [index, filePath] of targetPaths.entries()) {
      console.log(`  ${index + 1}. ${path.basename(filePath)}`);
    }

    await fileChooser.setFiles(targetPaths);
    await page.waitForTimeout(1000);

    if (targetPaths.length >= 2) {
      console.log('이미지 타입 선택 팝업 대기...');
      await page.waitForTimeout(1000);
      await selectImageType(frame, imageType);
      await page.waitForTimeout(500);
    }

    const waitTime = resolveWaitTime(targetPaths.length, maxWaitMs);
    console.log(`업로드 대기 중... (${waitTime / 1000}초)`);
    await page.waitForTimeout(waitTime);

    console.log('다중 업로드 완료!');
    return { success: targetPaths.length, failed: imagePaths.length - targetPaths.length };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`업로드 실패: ${msg}`);
    return { success: 0, failed: targetPaths.length };
  }
};
