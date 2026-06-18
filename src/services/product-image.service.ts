import axios from 'axios';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { env } from '../config/env.js';
import { logger } from '../lib/logging/logger.js';
import { ProgressBar } from '../lib/utils/progress.js';
import type { ProductMetadata, ProductImagesResponse, ExcludeLibraryLinkItem } from '../types/metadata.js';
import type { MultiImageData } from '../lib/naver-editor/image.js';

export type { ExcludeLibraryLinkItem } from '../types/metadata.js';
export { type MultiImageData } from '../lib/naver-editor/image.js';

const imageLog = logger.child({ scope: 'Image' });
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_RETRY_DELAY_MS = 1000;
const PRODUCT_DATA_ATTEMPTS = 3;
const PRODUCT_DATA_RETRY_DELAY_MS = 3000;

export interface ImageData {
  url: string;
  filename?: string;
}

export interface PreparedProductData {
  bodyImages: string[];
  excludeLibrary: string[];
  multiImages: MultiImageData;
  excludeLibraryLink: ExcludeLibraryLinkItem[];
  metadata: ProductMetadata;
}

const CATEGORY_RANDOM_CATEGORIES = ['한려담원'];
const ALIBABA_IMAGE_FALLBACK_BY_BLOG_ID = new Map([
  ['mad1651', { blogId: 'weed3122', blogName: '알리바바 신규4' }],
]);

export interface ProductDataOptions {
  keyword: string;
  blogId?: string;
  category?: string;
  dateCode?: string;
  blogName?: string;
  manuscriptType?: string;
}

const sanitizeParam = (value: string): string =>
  value.replace(/[\n\r]/g, '').trim();

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export interface ProductImageRequestConfig {
  url: string;
  params: Record<string, string>;
  endpoint: 'product-images' | 'category-random';
}

export const buildProductImageRequest = ({ keyword, blogId, category, dateCode, blogName, manuscriptType }: ProductDataOptions): ProductImageRequestConfig => {
  const useCategoryRandom = Boolean(category && CATEGORY_RANDOM_CATEGORIES.includes(category));
  const endpoint: ProductImageRequestConfig['endpoint'] = useCategoryRandom ? 'category-random' : 'product-images';
  const url = `${env.IMAGE_API_URL}/api/image/${endpoint}`;

  // 애견 같은 keywordCategory는 에디터 분기용 값이라 product-images 쿼리 category에는 싣지 않음.
  const params: Record<string, string> = useCategoryRandom
    ? { category: category!, keyword: sanitizeParam(keyword) }
    : { keyword: sanitizeParam(keyword) };

  if (!useCategoryRandom && blogId) params.blogId = blogId;
  if (dateCode) params.dateCode = sanitizeParam(dateCode);
  if (blogName) params.blogName = sanitizeParam(blogName);
  if (!useCategoryRandom && manuscriptType) params.manuscriptType = sanitizeParam(manuscriptType);

  return { url, params, endpoint };
};

export const getProductData = async ({ keyword, blogId, category, dateCode, blogName, manuscriptType }: ProductDataOptions) => {
  const { url, params, endpoint } = buildProductImageRequest({ keyword, blogId, category, dateCode, blogName, manuscriptType });
  const progress = new ProgressBar({ label: 'product', total: 1, width: 16 });
  imageLog.info(progress.start('request'), { url, keyword, blogId, category, dateCode, blogName, manuscriptType, endpoint });

  const response = await axios.get(url, {
    params,
    timeout: 300000,
  });

  const data = response.data as ProductImagesResponse;
  const { images, metadata } = data;

  imageLog.info(progress.done('done'), {
    keyword,
    body: images.body?.length ?? 0,
    individual: images.individual?.length ?? 0,
    slide: images.slide?.length ?? 0,
    collage: images.collage?.length ?? 0,
    excludeLibrary: images.excludeLibrary?.length ?? 0,
    excludeLibraryLink: images.excludeLibraryLink?.length ?? 0,
    total: data.total,
  });

  return {
    bodyImages: (images.body ?? []).map((imgUrl: string, i: number): ImageData => ({
      url: imgUrl,
      filename: `body_${i + 1}.webp`,
    })),
    multiImages: {
      individual: images.individual ?? [],
      slide: images.slide ?? [],
      collage: images.collage ?? [],
    },
    excludeLibrary: images.excludeLibrary ?? [],
    excludeLibraryLink: (images.excludeLibraryLink ?? []).map((imgUrl: string, i: number) => ({
      image: imgUrl,
      url: metadata?.lib_url?.[i] ?? '',
    })),
    metadata: {
      mapQueries: metadata?.mapQueries,
      phone: metadata?.phone,
      url: metadata?.url,
    } as ProductMetadata,
  };
};

const getProductDataWithRetry = async (
  options: ProductDataOptions,
) => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= PRODUCT_DATA_ATTEMPTS; attempt += 1) {
    try {
      const data = await getProductData(options);
      if (attempt > 1) {
        imageLog.info('product.retry.ok', {
          keyword: options.keyword,
          blogId: options.blogId,
          attempt,
        });
      }
      return data;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      imageLog.warn('product.retry.failed', {
        keyword: options.keyword,
        blogId: options.blogId,
        attempt,
        maxAttempts: PRODUCT_DATA_ATTEMPTS,
        message,
      });

      if (attempt < PRODUCT_DATA_ATTEMPTS) {
        await sleep(PRODUCT_DATA_RETRY_DELAY_MS);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const isBase64DataUrl = (str: string): boolean => {
  return str.startsWith('data:image/');
};

const isValidUrl = (str: string): boolean => {
  if (isBase64DataUrl(str)) return true;
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
};

export const normalizeImageDownloadUrl = (imageUrl: string): string => {
  if (isBase64DataUrl(imageUrl)) return imageUrl;
  return new URL(imageUrl).toString();
};

const downloadImageBuffer = async (imageUrl: string): Promise<{ buffer: Buffer; ext: string }> => {
  if (isBase64DataUrl(imageUrl)) {
    const matches = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new Error('invalid_base64_format');
    }

    return {
      ext: `.${matches[1] === 'jpeg' ? 'jpg' : matches[1]}`,
      buffer: Buffer.from(matches[2], 'base64'),
    };
  }

  const url = new URL(imageUrl);
  const response = await axios.get<ArrayBuffer>(normalizeImageDownloadUrl(imageUrl), {
    responseType: 'arraybuffer',
  });

  return {
    ext: path.extname(url.pathname) || '.png',
    buffer: Buffer.from(response.data),
  };
};

export const downloadImagesToDir = async (
  imageDataList: ImageData[],
  imagesDir: string
): Promise<string[]> => {
  const validImages = imageDataList.filter((img) => img.url && isValidUrl(img.url));
  if (validImages.length === 0) {
    imageLog.warn('download.skip', { reason: 'no_valid_urls' });
    return [];
  }

  const progress = new ProgressBar({
    label: 'download',
    total: validImages.length,
    width: 18,
    showStatus: true,
  });
  imageLog.info(progress.start(), { count: validImages.length, dir: imagesDir });
  const saved: string[] = [];
  await mkdir(imagesDir, { recursive: true });

  for (let i = 0; i < validImages.length; i += 1) {
    const { url: imageUrl, filename } = validImages[i];
    let savedImage = false;

    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
      try {
        const { buffer, ext } = await downloadImageBuffer(imageUrl);
        const finalFilename = filename || `${i + 1}${ext}`;
        const filePath = path.join(imagesDir, finalFilename);

        await writeFile(filePath, buffer);
        saved.push(filePath);
        savedImage = true;
        imageLog.info(progress.tick('ok'), { filename: finalFilename, attempt });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        imageLog.warn('download.failed', { url: imageUrl.slice(0, 80), message, attempt });

        if (attempt < DOWNLOAD_ATTEMPTS) {
          await sleep(DOWNLOAD_RETRY_DELAY_MS);
        }
      }
    }

    if (!savedImage) {
      imageLog.info(progress.tick('fail'));
    }
  }

  imageLog.info(progress.done('saved'), { count: saved.length });
  return saved;
};

export interface PrepareProductImagesOptions extends ProductDataOptions {
  imagesDir: string;
}

export const prepareProductImages = async ({
  imagesDir,
  ...productDataOptions
}: PrepareProductImagesOptions): Promise<PreparedProductData> => {
  let data = await getProductDataWithRetry(productDataOptions);

  if (
    productDataOptions.manuscriptType === 'alibaba' &&
    productDataOptions.blogId &&
    ALIBABA_IMAGE_FALLBACK_BY_BLOG_ID.has(productDataOptions.blogId) &&
    ((data.bodyImages.length === 0) || (data.excludeLibrary.length === 0))
  ) {
    const fallback = ALIBABA_IMAGE_FALLBACK_BY_BLOG_ID.get(productDataOptions.blogId)!;
    imageLog.warn('product.alibaba.fallback', {
      keyword: productDataOptions.keyword,
      fromBlogId: productDataOptions.blogId,
      toBlogId: fallback.blogId,
      body: data.bodyImages.length,
      excludeLibrary: data.excludeLibrary.length,
    });
    data = await getProductDataWithRetry({
      ...productDataOptions,
      blogId: fallback.blogId,
      blogName: fallback.blogName,
    });
  }

  const bodyImages = await downloadImagesToDir(data.bodyImages, imagesDir);

  const excludeLibrary = await downloadImagesToDir(
    data.excludeLibrary.map((imgUrl: string, i: number): ImageData => ({
      url: imgUrl,
      filename: `라이브러리제외_${i + 1}.webp`,
    })),
    imagesDir
  );
  if (data.excludeLibrary.length > 0 && excludeLibrary.length !== data.excludeLibrary.length) {
    throw new Error(`excludeLibrary download failed: expected=${data.excludeLibrary.length} actual=${excludeLibrary.length}`);
  }

  const multiImages: MultiImageData = {};
  if (data.multiImages.individual.length) {
    multiImages.individual = await downloadImagesToDir(
      data.multiImages.individual.map((imgUrl: string, i: number): ImageData => ({
        url: imgUrl,
        filename: `individual_${i + 1}.webp`,
      })),
      imagesDir
    );
  }
  if (data.multiImages.slide.length) {
    multiImages.slide = await downloadImagesToDir(
      data.multiImages.slide.map((imgUrl: string, i: number): ImageData => ({
        url: imgUrl,
        filename: `slide_${i + 1}.webp`,
      })),
      imagesDir
    );
  }
  if (data.multiImages.collage.length) {
    multiImages.collage = await downloadImagesToDir(
      data.multiImages.collage.map((imgUrl: string, i: number): ImageData => ({
        url: imgUrl,
        filename: `collage_${i + 1}.webp`,
      })),
      imagesDir
    );
  }

  const excludeLibLinkFiles = await downloadImagesToDir(
    data.excludeLibraryLink.map(({ image }: { image: string }, i: number): ImageData => ({
      url: image,
      filename: `라이브러리제외링크_${i + 1}.webp`,
    })),
    imagesDir
  );
  const excludeLibraryLink: ExcludeLibraryLinkItem[] = excludeLibLinkFiles.map((filePath, i) => ({
    imagePath: filePath,
    url: data.excludeLibraryLink[i]?.url ?? '',
  }));

  return { bodyImages, excludeLibrary, multiImages, excludeLibraryLink, metadata: data.metadata };
};
