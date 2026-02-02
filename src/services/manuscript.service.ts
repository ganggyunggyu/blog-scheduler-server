import axios from 'axios';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../lib/logging/logger';
import { ProgressBar } from '../lib/utils/progress';
import type { ProductMetadata, ProductImagesResponse, ExcludeLibraryLinkItem } from '../types/metadata';
import type { MultiImageData } from '../lib/naver-editor/image';

const JOBS_DIR = path.resolve(process.cwd(), 'data', 'jobs');

interface Manuscript {
  _id?: string;
  content?: string;
  keyword?: string;
  category?: string;
  engine?: string;
}

interface JobDir {
  dir: string;
  imagesDir: string;
}

const manuscriptLog = logger.child({ scope: 'Manuscript' });
const imageLog = logger.child({ scope: 'Image' });

const createJobDir = async (keyword: string): Promise<JobDir> => {
  const timestamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, '')
    .replace(/(\d{8})(\d{6})/, '$1_$2');
  const safeKeyword = keyword.replace(/[^\w가-힣]/g, '_').slice(0, 20);
  const folderName = `${timestamp}_${safeKeyword}`;
  const dir = path.join(JOBS_DIR, folderName);
  const imagesDir = path.join(dir, 'images');

  await mkdir(imagesDir, { recursive: true });

  return { dir, imagesDir };
};

export const generateManuscript = async (
  keyword: string,
  service: string,
  ref: string = ''
): Promise<{ id: string; title: string; content: string; raw: Manuscript }> => {
  const url = `${env.MANUSCRIPT_API_URL}/generate/blog-filler`;
  const progress = new ProgressBar({
    label: 'manuscript',
    total: 1,
    width: 16,
  });
  manuscriptLog.info(progress.start('request'), { url, keyword, service, ref });

  const response = await axios.post<Manuscript>(
    url,
    { service, keyword, ref },
    { timeout: 300000 }
  );

  const raw = response.data;
  const lines = (raw.content ?? '').split('\n');
  const title = (lines[0] ?? '').trim() || keyword;
  const content = lines.slice(1).join('\n').trim();

  manuscriptLog.info(progress.done('done'), {
    id: raw._id ?? '',
    titlePreview: title.slice(0, 30),
    length: content.length,
  });

  return { id: raw._id ?? '', title, content, raw };
};
export const generateUpdateRestaurantManuscript = async (
  keyword: string,
  service: string,
  ref: string = ''
): Promise<{ id: string; title: string; content: string; raw: Manuscript }> => {
  const url = `${env.MANUSCRIPT_API_URL}/generate/update-restaurant`;
  const progress = new ProgressBar({
    label: 'manuscript',
    total: 1,
    width: 16,
  });
  manuscriptLog.info(progress.start('request'), { url, keyword, service, ref });

  const response = await axios.post<Manuscript>(
    url,
    { service, keyword, ref },
    { timeout: 300000 }
  );

  const raw = response.data;
  const lines = (raw.content ?? '').split('\n');
  const title = (lines[0] ?? '').trim() || keyword;
  const content = lines.slice(1).join('\n').trim();

  manuscriptLog.info(progress.done('done'), {
    id: raw._id ?? '',
    titlePreview: title.slice(0, 30),
    length: content.length,
  });

  return { id: raw._id ?? '', title, content, raw };
};

export const generatePetManuscript = async (
  keyword: string,
  service: string,
  ref: string = ''
): Promise<{ id: string; title: string; content: string; raw: Manuscript }> => {
  const url = `${env.MANUSCRIPT_API_URL}/generate/blog-filler-pet`;
  const progress = new ProgressBar({
    label: 'manuscript',
    total: 1,
    width: 16,
  });
  manuscriptLog.info(progress.start('request'), { url, keyword, service, ref });

  const response = await axios.post<Manuscript>(
    url,
    { service, keyword, ref },
    { timeout: 300000 }
  );

  const raw = response.data;
  const lines = (raw.content ?? '').split('\n');
  const title = (lines[0] ?? '').trim() || keyword;
  const content = lines.slice(1).join('\n').trim();

  manuscriptLog.info(progress.done('done'), {
    id: raw._id ?? '',
    titlePreview: title.slice(0, 30),
    length: content.length,
  });

  return { id: raw._id ?? '', title, content, raw };
};

export const generateGrokManuscript = async (
  keyword: string,
  service: string,
  ref: string = '',
  category?: string
): Promise<{ id: string; title: string; content: string; raw: Manuscript }> => {
  const url = `${env.MANUSCRIPT_API_URL}/generate/grok`;
  const progress = new ProgressBar({
    label: 'manuscript',
    total: 1,
    width: 16,
  });
  manuscriptLog.info(progress.start('request'), { url, keyword, service, ref, category, engine: 'grok' });

  const response = await axios.post<Manuscript>(
    url,
    { service, keyword, ref, category },
    { timeout: 300000 }
  );

  const raw = response.data;
  const lines = (raw.content ?? '').split('\n');
  const title = (lines[0] ?? '').trim() || keyword;
  const content = lines.slice(1).join('\n').trim();

  manuscriptLog.info(progress.done('done'), {
    id: raw._id ?? '',
    titlePreview: title.slice(0, 30),
    length: content.length,
    engine: 'grok',
  });

  return { id: raw._id ?? '', title, content, raw };
};

export const generateKeigoManuscript = async (
  keyword: string,
  service: string,
  ref: string = ''
): Promise<{ id: string; title: string; content: string; raw: Manuscript }> => {
  const url = `${env.MANUSCRIPT_API_URL}/generate/keigo`;
  const progress = new ProgressBar({
    label: 'manuscript',
    total: 1,
    width: 16,
  });
  manuscriptLog.info(progress.start('request'), { url, keyword, service, ref, engine: 'keigo' });

  const response = await axios.post<Manuscript>(
    url,
    { service, keyword, ref },
    { timeout: 300000 }
  );

  const raw = response.data;
  const lines = (raw.content ?? '').split('\n');
  const title = (lines[0] ?? '').trim() || keyword;
  const content = lines.slice(1).join('\n').trim();

  manuscriptLog.info(progress.done('done'), {
    id: raw._id ?? '',
    titlePreview: title.slice(0, 30),
    length: content.length,
    engine: 'keigo',
  });

  return { id: raw._id ?? '', title, content, raw };
};

export const generateHanryeodamwonManuscript = async (
  keyword: string,
  service: string,
  ref: string = ''
): Promise<{ id: string; title: string; content: string; raw: Manuscript }> => {
  const url = `${env.MANUSCRIPT_API_URL}/generate/hanryeo`;
  const progress = new ProgressBar({
    label: 'manuscript',
    total: 1,
    width: 16,
  });
  manuscriptLog.info(progress.start('request'), { url, keyword, service, ref, engine: 'hanryeodamwon' });

  const response = await axios.post<Manuscript>(
    url,
    { service, keyword, ref },
    { timeout: 300000 }
  );

  const raw = response.data;
  const lines = (raw.content ?? '').split('\n');
  const title = (lines[0] ?? '').trim() || keyword;
  const content = lines.slice(1).join('\n').trim();

  manuscriptLog.info(progress.done('done'), {
    id: raw._id ?? '',
    titlePreview: title.slice(0, 30),
    length: content.length,
    engine: 'hanryeodamwon',
  });

  return { id: raw._id ?? '', title, content, raw };
};

export type ImageSource = 'ai' | 'google' | 'keyword' | 'product';
export type ManuscriptType = 'default' | 'update-restaurant' | 'pet' | 'grok' | 'keigo' | 'hanryeodamwon';

export interface ImageData {
  url: string;
  filename?: string;
}

const generateImageUrlsFromAI = async (
  keyword: string,
  imageCount: number,
  category?: string
): Promise<string[]> => {
  const url = `${env.MANUSCRIPT_API_URL}/generate/image`;
  const progress = new ProgressBar({ label: 'image', total: 1, width: 16 });
  imageLog.info(progress.start('request'), {
    url,
    keyword,
    category: category ?? '',
    imageCount,
    source: 'ai',
  });

  const response = await axios.post(
    url,
    { keyword, category: category ?? '' },
    { timeout: 300000 }
  );

  const data = response.data as {
    images?: Array<{ url: string } | string>;
    urls?: string[];
    imageUrls?: string[];
  };

  const raw = data.images ?? data.urls ?? data.imageUrls ?? [];
  if (!Array.isArray(raw)) {
    imageLog.warn('response.invalid');
    return [];
  }

  const urls = raw
    .map((item) => (typeof item === 'string' ? item : item.url))
    .filter(Boolean);
  imageLog.info(progress.done('done'), { count: urls.length });

  return urls;
};

const generateImageUrlsFromGoogle = async (
  keyword: string,
  imageCount: number
): Promise<string[]> => {
  const url = `${env.IMAGE_API_URL}/api/image/random-frames`;
  const progress = new ProgressBar({ label: 'image', total: 1, width: 16 });
  imageLog.info(progress.start('request'), {
    url,
    keyword,
    imageCount,
    source: 'google',
  });

  const response = await axios.post(
    url,
    { keyword, count: imageCount },
    { timeout: 300000 }
  );

  const data = response.data as {
    images?: Array<{ url: string }>;
    total?: number;
    failed?: number;
  };

  const raw = data.images ?? [];
  if (!Array.isArray(raw)) {
    imageLog.warn('response.invalid', { source: 'google' });
    return [];
  }

  const urls = raw.map((item) => item.url).filter(Boolean);
  imageLog.info(progress.done('done'), {
    count: urls.length,
    failed: data.failed ?? 0,
  });

  return urls;
};

const generateImageUrlsFromKeyword = async (
  keyword: string,
  imageCount: number
): Promise<string[]> => {
  const url = `${env.IMAGE_API_URL}/api/image/keyword-frames`;
  const progress = new ProgressBar({ label: 'image', total: 1, width: 16 });
  imageLog.info(progress.start('request'), {
    url,
    keyword,
    imageCount,
    source: 'keyword',
  });

  const response = await axios.post(
    url,
    { keyword, count: imageCount },
    { timeout: 300000 }
  );

  const data = response.data as {
    images?: Array<{ url: string }>;
    total?: number;
    failed?: number;
  };

  const raw = data.images ?? [];
  if (!Array.isArray(raw)) {
    imageLog.warn('response.invalid', { source: 'keyword' });
    return [];
  }

  const urls = raw.map((item) => item.url).filter(Boolean);
  imageLog.info(progress.done('done'), {
    count: urls.length,
    failed: data.failed ?? 0,
  });

  return urls;
};

export { type MultiImageData } from '../lib/naver-editor/image';

export type { ExcludeLibraryLinkItem } from '../types/metadata';

export interface PreparedProductData {
  bodyImages: string[];
  excludeLibrary: string[];
  multiImages: MultiImageData;
  excludeLibraryLink: ExcludeLibraryLinkItem[];
  metadata: ProductMetadata;
}

export const getProductData = async (keyword: string, blogId?: string, category?: string) => {
  const url = `${env.IMAGE_API_URL}/api/image/product-images`;
  const progress = new ProgressBar({ label: 'product', total: 1, width: 16 });
  imageLog.info(progress.start('request'), { url, keyword, blogId, category });

  const params: Record<string, string> = { keyword };
  if (blogId) params.blogId = blogId;
  if (category) params.category = category;

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

const generateImageUrlsFromProduct = async (
  keyword: string,
  _imageCount: number
): Promise<ImageData[]> => {
  const data = await getProductData(keyword);
  return data.bodyImages;
};

export const getCategory = async (keyword: string): Promise<string> => {
  const url = `${env.MANUSCRIPT_API_URL}/category/${encodeURIComponent(keyword)}`;
  manuscriptLog.info('category.request', { url, keyword });

  try {
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;
    const category = typeof data === 'string' ? data : data?.category ?? '기타';
    manuscriptLog.info('category.resolved', { keyword, category });
    return category;
  } catch (error) {
    manuscriptLog.warn('category.failed', {
      keyword,
      error: error instanceof Error ? error.message : String(error),
    });
    return '기타';
  }
};

export const generateAndDownloadAIImages = async (
  keyword: string,
  imageCount: number,
  imagesDir: string,
  category?: string,
): Promise<string[]> => {
  const urls = await generateImageUrlsFromAI(keyword, imageCount, category);
  const imageData = urls.map((url) => ({ url }));
  return downloadImagesToDir(imageData, imagesDir);
};

export const generateImageUrls = async (
  keyword: string,
  imageCount: number,
  category?: string,
  imageSource: ImageSource = 'ai'
): Promise<ImageData[]> => {
  if (imageSource === 'google') {
    const urls = await generateImageUrlsFromGoogle(keyword, imageCount);
    return urls.map((url) => ({ url }));
  }
  if (imageSource === 'keyword') {
    const urls = await generateImageUrlsFromKeyword(keyword, imageCount);
    return urls.map((url) => ({ url }));
  }
  if (imageSource === 'product') {
    return generateImageUrlsFromProduct(keyword, imageCount);
  }
  const urls = await generateImageUrlsFromAI(keyword, imageCount, category);
  return urls.map((url) => ({ url }));
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

const downloadImagesToDir = async (
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

export interface PreparedJob {
  jobDir: string;
  title: string;
  content: string;
  images: string[];
  manuscriptId: string;
}

export const prepareJob = async (
  keyword: string,
  service: string,
  ref: string,
  generateImages: boolean,
  imageCount: number,
  imageSource: ImageSource = 'ai',
  manuscriptType: ManuscriptType = 'default',
  category?: string
): Promise<PreparedJob> => {
  const { dir, imagesDir } = await createJobDir(keyword);
  manuscriptLog.info('job.dir.created', { dir, manuscriptType });

  const getManuscript = async () => {
    switch (manuscriptType) {
      case 'update-restaurant':
        return generateUpdateRestaurantManuscript(keyword, service, ref);
      case 'pet':
        return generatePetManuscript(keyword, service, ref);
      case 'grok':
        return generateGrokManuscript(keyword, service, ref, category);
      case 'keigo':
        return generateKeigoManuscript(keyword, service, ref);
      case 'hanryeodamwon':
        return generateHanryeodamwonManuscript(keyword, service, ref);
      default:
        return generateManuscript(keyword, service, ref);
    }
  };
  const manuscript = await getManuscript();

  const manuscriptPath = path.join(dir, 'manuscript.txt');
  await writeFile(
    manuscriptPath,
    `${manuscript.title}\n\n${manuscript.content}`
  );

  const meta = {
    keyword,
    service,
    ref,
    manuscriptId: manuscript.id,
    imageSource,
    manuscriptType,
    createdAt: new Date().toISOString(),
    status: 'generated',
  };
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

  let images: string[] = [];
  if (generateImages) {
    const finalImageCount = imageSource === 'product' ? 10 : imageCount;
    const imageUrls = await generateImageUrls(
      keyword,
      finalImageCount,
      undefined,
      imageSource
    );
    images = await downloadImagesToDir(
      imageUrls.slice(0, finalImageCount),
      imagesDir
    );
  }

  manuscriptLog.info('job.prepared', {
    dir,
    title: manuscript.title.slice(0, 30),
    images: images.length,
  });

  return {
    jobDir: dir,
    title: manuscript.title,
    content: manuscript.content,
    images,
    manuscriptId: manuscript.id,
  };
};

export const updateJobStatus = async (
  jobDir: string,
  status: 'success' | 'failed',
  details?: { postUrl?: string; error?: string }
): Promise<void> => {
  const metaPath = path.join(jobDir, 'meta.json');
  try {
    const metaRaw = await import('fs/promises').then((fs) =>
      fs.readFile(metaPath, 'utf-8')
    );
    const meta = JSON.parse(metaRaw);
    meta.status = status;
    meta.completedAt = new Date().toISOString();
    if (details?.postUrl) meta.postUrl = details.postUrl;
    if (details?.error) meta.error = details.error;
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // ignore
  }
};
