import axios from 'axios';
import { writeFile } from 'fs/promises';
import path from 'path';
import { env } from '../config/env.js';
import { logger } from '../lib/logging/logger.js';
import { ProgressBar } from '../lib/utils/progress.js';
import type { ProductMetadata, ProductImagesResponse, ExcludeLibraryLinkItem } from '../types/metadata.js';
import type { MultiImageData } from '../lib/naver-editor/image.js';

export type { ExcludeLibraryLinkItem } from '../types/metadata.js';
export { type MultiImageData } from '../lib/naver-editor/image.js';

const imageLog = logger.child({ scope: 'Image' });

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

export const getProductData = async (keyword: string, blogId?: string, category?: string) => {
  const useCategoryRandom = category && CATEGORY_RANDOM_CATEGORIES.includes(category);
  const url = useCategoryRandom
    ? `${env.IMAGE_API_URL}/api/image/category-random`
    : `${env.IMAGE_API_URL}/api/image/product-images`;
  const progress = new ProgressBar({ label: 'product', total: 1, width: 16 });
  imageLog.info(progress.start('request'), { url, keyword, blogId, category, endpoint: useCategoryRandom ? 'category-random' : 'product-images' });

  const params: Record<string, string> = useCategoryRandom
    ? { category: category! }
    : { keyword };
  if (!useCategoryRandom && blogId) params.blogId = blogId;
  if (!useCategoryRandom && category) params.category = category;

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

  for (let i = 0; i < validImages.length; i += 1) {
    const { url: imageUrl, filename } = validImages[i];
    try {
      let buffer: Buffer;
      let ext: string;

      if (isBase64DataUrl(imageUrl)) {
        const matches = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!matches) {
          imageLog.warn('download.failed', { reason: 'invalid_base64_format' });
          imageLog.info(progress.tick('fail'));
          continue;
        }
        ext = `.${matches[1] === 'jpeg' ? 'jpg' : matches[1]}`;
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        const url = new URL(imageUrl);
        ext = path.extname(url.pathname) || '.png';
        const response = await axios.get<ArrayBuffer>(imageUrl, {
          responseType: 'arraybuffer',
        });
        buffer = Buffer.from(response.data);
      }

      const finalFilename = filename || `${i + 1}${ext}`;
      const filePath = path.join(imagesDir, finalFilename);

      await writeFile(filePath, buffer);
      saved.push(filePath);
      imageLog.info(progress.tick('ok'), { filename: finalFilename });
    } catch {
      imageLog.warn('download.failed', { url: imageUrl.slice(0, 80) });
      imageLog.info(progress.tick('fail'));
    }
  }

  imageLog.info(progress.done('saved'), { count: saved.length });
  return saved;
};

export const prepareProductImages = async (
  keyword: string,
  imagesDir: string,
  blogId?: string,
  category?: string
): Promise<PreparedProductData> => {
  const data = await getProductData(keyword, blogId, category);

  const bodyImages = await downloadImagesToDir(data.bodyImages, imagesDir);

  const excludeLibrary = await downloadImagesToDir(
    data.excludeLibrary.map((imgUrl: string, i: number): ImageData => ({
      url: imgUrl,
      filename: `라이브러리제외_${i + 1}.webp`,
    })),
    imagesDir
  );

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
