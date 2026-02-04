import axios from 'axios';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../lib/logging/logger';
import { ProgressBar } from '../lib/utils/progress';
import { downloadImagesToDir, type ImageData } from './product-image.service';
import type { ProductImagesResponse } from '../types/metadata';

export { getProductData, prepareProductImages, downloadImagesToDir } from './product-image.service';
export type { PreparedProductData, ImageData, MultiImageData, ExcludeLibraryLinkItem } from './product-image.service';

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

export type ImageSource = 'ai' | 'google' | 'keyword' | 'product';
export type ManuscriptType = 'default' | 'update-restaurant' | 'pet' | 'grok' | 'keigo' | 'hanryeodamwon' | 'nyangnyang';

interface ManuscriptEndpoint {
  path: string;
  engine?: string;
  sendCategory?: boolean;
}

const MANUSCRIPT_ENDPOINTS: Record<ManuscriptType, ManuscriptEndpoint> = {
  default: { path: '/generate/blog-filler' },
  'update-restaurant': { path: '/generate/update-restaurant' },
  pet: { path: '/generate/blog-filler-pet' },
  grok: { path: '/generate/grok', engine: 'grok', sendCategory: true },
  keigo: { path: '/generate/keigo', engine: 'keigo' },
  hanryeodamwon: { path: '/generate/hanryeo', engine: 'hanryeodamwon' },
  nyangnyang: { path: '/generate/nyangnyang', engine: 'nyangnyang' },
};

export const callManuscriptAPI = async (
  type: ManuscriptType,
  keyword: string,
  service: string,
  ref: string = '',
  category?: string,
): Promise<{ id: string; title: string; content: string; raw: Manuscript }> => {
  const endpoint = MANUSCRIPT_ENDPOINTS[type];
  const url = `${env.MANUSCRIPT_API_URL}${endpoint.path}`;
  const progress = new ProgressBar({ label: 'manuscript', total: 1, width: 16 });
  manuscriptLog.info(progress.start('request'), { url, keyword, service, ref, ...(endpoint.engine && { engine: endpoint.engine }) });

  const body: Record<string, string> = { service, keyword, ref };
  if (endpoint.sendCategory && category) body.category = category;

  const response = await axios.post<Manuscript>(url, body, { timeout: 300000 });

  const raw = response.data;
  const lines = (raw.content ?? '').split('\n');
  const title = (lines[0] ?? '').trim() || keyword;
  const content = lines.slice(1).join('\n').trim();

  manuscriptLog.info(progress.done('done'), {
    id: raw._id ?? '',
    titlePreview: title.slice(0, 30),
    length: content.length,
    ...(endpoint.engine && { engine: endpoint.engine }),
  });

  return { id: raw._id ?? '', title, content, raw };
};

const parseImageResponse = (data: unknown): string[] => {
  const res = data as ProductImagesResponse;
  if (res?.images?.body && Array.isArray(res.images.body)) {
    return res.images.body.filter(Boolean);
  }
  return [];
};

export const fetchBodyImagesFromAI = async (
  keyword: string,
  count: number,
  imagesDir: string,
): Promise<string[]> => {
  const url = `${env.IMAGE_API_URL}/api/image/ai-images`;
  imageLog.info('ai-images.request', { url, keyword, count });

  const response = await axios.get(url, {
    params: { keyword, count, distort: true },
    timeout: 300000,
  });

  const urls = parseImageResponse(response.data);
  imageLog.info('ai-images.done', { count: urls.length });

  const imageData: ImageData[] = urls.map((imgUrl, i) => ({
    url: imgUrl,
    filename: `body_${i + 1}.webp`,
  }));
  return downloadImagesToDir(imageData, imagesDir);
};

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

  const urls = parseImageResponse(response.data);
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

  const urls = parseImageResponse(response.data);
  imageLog.info(progress.done('done'), {
    count: urls.length,
    failed: (response.data as { failed?: number })?.failed ?? 0,
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

  const urls = parseImageResponse(response.data);
  imageLog.info(progress.done('done'), {
    count: urls.length,
    failed: (response.data as { failed?: number })?.failed ?? 0,
  });

  return urls;
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
    const { getProductData } = await import('./product-image.service');
    const data = await getProductData(keyword);
    return data.bodyImages;
  }
  const urls = await generateImageUrlsFromAI(keyword, imageCount, category);
  return urls.map((url) => ({ url }));
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

  const manuscript = await callManuscriptAPI(manuscriptType, keyword, service, ref, category);

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
