import axios from 'axios';
import { mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { getImageTypeFromKey, uploadMultipleImages } from './uploader.ts';
import { getLoginCookies, openEditorSession } from './naver.ts';

import type { MultiImageData } from './types.ts';

interface ProductImagesResponse {
  images: null;
  multiImages: MultiImageData;
  keyword: string;
  folder: string;
  total: number;
  failed: number;
}

const TEMP_DIR = path.join(os.tmpdir(), 'multi-upload-test');
const TARGET_KEYS = ['개별', '슬라이드', '콜라주'] as const;

const fetchProductImages = async (apiUrl: string, keyword: string): Promise<ProductImagesResponse> => {
  const url = `${apiUrl}?keyword=${encodeURIComponent(keyword)}`;
  console.log(`API 요청: ${url}`);

  const { data } = await axios.get<ProductImagesResponse>(url);
  return data;
};

const saveBase64ToFile = async (base64: string, filename: string): Promise<string> => {
  await mkdir(TEMP_DIR, { recursive: true });
  const filePath = path.join(TEMP_DIR, filename);

  const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  await writeFile(filePath, buffer);
  return filePath;
};

const saveImagesToTemp = async (base64Images: string[], prefix: string): Promise<string[]> => {
  const filePaths: string[] = [];

  for (const [index, image] of base64Images.entries()) {
    const filePath = await saveBase64ToFile(image, `${prefix}_${index + 1}.webp`);
    filePaths.push(filePath);
    console.log(`  저장: ${prefix}_${index + 1}.webp`);
  }

  return filePaths;
};

const cleanupTempDir = async (): Promise<void> => {
  try {
    await rm(TEMP_DIR, { recursive: true });
    console.log('임시 파일 정리 완료');
  } catch {
    // ignore
  }
};

export interface ApiUploadOptions {
  account: {
    id: string;
    password: string;
  };
  apiUrl: string;
  keyword: string;
  maxPerType?: number;
}

export const runApiImageUploadTest = async (options: ApiUploadOptions): Promise<void> => {
  const { account, apiUrl, keyword, maxPerType = 3 } = options;

  console.log('=== 1. API에서 이미지 가져오기 ===');
  const response = await fetchProductImages(apiUrl, keyword);
  const { keyword: responseKeyword, folder, total, multiImages } = response;

  console.log(`키워드: ${responseKeyword}`);
  console.log(`폴더: ${folder}`);
  console.log(`총 이미지: ${total}`);

  if (!multiImages) {
    console.error('multiImages가 없음');
    return;
  }

  console.log('\n발견된 이미지 타입:');
  for (const key of TARGET_KEYS) {
    const images = multiImages[key];
    console.log(`  ${key}: ${images?.length ?? 0}개`);
  }

  console.log('\n=== 2. 로그인하여 쿠키 획득 ===');
  const { id, password } = account;
  const cookies = await getLoginCookies(id, password);
  console.log('쿠키 획득 완료:', cookies.length, '개');

  console.log('\n=== 3. 에디터 열기 ===');
  const { page, frame, close } = await openEditorSession(cookies);

  try {
    console.log('\n=== 4. 다중 이미지 업로드 테스트 ===');

    let totalSuccess = 0;
    let totalFailed = 0;

    for (const key of TARGET_KEYS) {
      const base64Images = multiImages[key];
      if (!base64Images || base64Images.length === 0) continue;

      const imageType = getImageTypeFromKey(key);
      console.log(`\n--- ${key} (${imageType}) 업로드 시작 ---`);

      const testImages = base64Images.slice(0, maxPerType);
      const filePaths = await saveImagesToTemp(testImages, key);

      const result = await uploadMultipleImages(page, frame, filePaths, {
        imageType,
        maxWaitMs: 30000,
      });

      totalSuccess += result.success;
      totalFailed += result.failed;

      await page.waitForTimeout(1000);
    }

    console.log('\n=== 결과 ===');
    console.log('성공:', totalSuccess);
    console.log('실패:', totalFailed);

    console.log('\n=== 5. 대기 (확인용) ===');
    await page.waitForTimeout(10000);
  } catch (error) {
    console.error('에러:', error);
  } finally {
    await close();
    await cleanupTempDir();
  }
};
