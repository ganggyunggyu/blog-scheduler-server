import path from 'path';
import { readdir } from 'fs/promises';

import { getImageTypeFromKey, uploadMultipleImages } from './uploader.ts';
import { getLoginCookies, openEditorSession } from './naver.ts';

import type { Frame, Page } from 'playwright';
import type { MultiImageData, UploadTotals } from './types.ts';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

const resolveFolderKey = (folderName: string): keyof MultiImageData | null => {
  if (folderName.includes('콜라주')) return '콜라주';
  if (folderName.includes('슬라이드')) return '슬라이드';
  if (folderName.includes('기본')) return '기본';
  if (folderName.includes('개별')) return '개별';
  return null;
};

const getImagesFromFolder = async (folderPath: string): Promise<string[]> => {
  try {
    const files = await readdir(folderPath);
    return files
      .filter((file) => IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase()))
      .map((file) => path.join(folderPath, file));
  } catch {
    console.error(`폴더 읽기 실패: ${folderPath}`);
    return [];
  }
};

const scanImageFolders = async (rootPath: string): Promise<MultiImageData> => {
  const result: MultiImageData = {};

  try {
    const entries = await readdir(rootPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const folderKey = resolveFolderKey(entry.name);
      if (!folderKey) continue;

      const folderPath = path.join(rootPath, entry.name);
      const images = await getImagesFromFolder(folderPath);
      if (images.length > 0) {
        result[folderKey] = images;
      }
    }
  } catch {
    console.error(`루트 스캔 실패: ${rootPath}`);
  }

  return result;
};

const uploadFromMultiImageData = async (
  page: Page,
  frame: Frame,
  data: MultiImageData
): Promise<UploadTotals> => {
  let total = 0;
  let success = 0;
  let failed = 0;

  for (const [key, images] of Object.entries(data)) {
    if (!images || images.length === 0) continue;

    const imageType = getImageTypeFromKey(key);
    console.log(`\n--- ${key} (${imageType}) 업로드 시작 ---`);

    const result = await uploadMultipleImages(page, frame, images, {
      imageType,
      validateFiles: true,
    });

    total += images.length;
    success += result.success;
    failed += result.failed;

    await page.waitForTimeout(1000);
  }

  return { total, success, failed };
};

export interface LocalUploadOptions {
  account: {
    id: string;
    password: string;
  };
  imageRoot: string;
}

export const runLocalImageUploadTest = async (options: LocalUploadOptions): Promise<void> => {
  const { account, imageRoot } = options;

  console.log('=== 1. 로그인하여 쿠키 획득 ===');
  const { id, password } = account;
  const cookies = await getLoginCookies(id, password);
  console.log('쿠키 획득 완료:', cookies.length, '개');

  console.log('\n=== 2. 이미지 폴더 스캔 ===');
  const multiImageData = await scanImageFolders(imageRoot);
  console.log('발견된 이미지 타입:');
  for (const [key, images] of Object.entries(multiImageData)) {
    console.log(`  ${key}: ${images?.length ?? 0}개`);
    if (!images) continue;
    for (const [index, imagePath] of images.entries()) {
      console.log(`    ${index + 1}. ${path.basename(imagePath)}`);
    }
  }

  const totalImages = Object.values(multiImageData).reduce(
    (sum, images) => sum + (images?.length ?? 0),
    0
  );

  if (totalImages === 0) {
    console.error('업로드할 이미지가 없습니다.');
    console.log('루트 경로에 "개별", "콜라주", "슬라이드" 폴더를 만들고 이미지를 넣어주세요.');
    return;
  }

  console.log('\n=== 3. 에디터 열기 ===');
  const { page, frame, close } = await openEditorSession(cookies);

  try {
    console.log('\n=== 4. 다중 이미지 업로드 테스트 ===');
    const result = await uploadFromMultiImageData(page, frame, multiImageData);

    console.log('\n=== 결과 ===');
    console.log('총 이미지:', result.total);
    console.log('성공:', result.success);
    console.log('실패:', result.failed);

    console.log('\n=== 5. 대기 (확인용) ===');
    await page.waitForTimeout(10000);
  } catch (error) {
    console.error('에러:', error);
  } finally {
    await close();
  }
};
