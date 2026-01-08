import axios from 'axios';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { ProgressBar } from '../lib/progress';

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
  const url = `${env.MANUSCRIPT_API_URL}/generate/gemini-new`;
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

export const generateImageUrls = async (
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

  const urls = raw.map((item) => (typeof item === 'string' ? item : item.url)).filter(Boolean);
  imageLog.info(progress.done('done'), { count: urls.length });

  return urls;
};

const isValidUrl = (str: string): boolean => {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
};

const downloadImagesToDir = async (imageUrls: string[], imagesDir: string): Promise<string[]> => {
  const validUrls = imageUrls.filter((url) => url && isValidUrl(url));
  if (validUrls.length === 0) {
    imageLog.warn('download.skip', { reason: 'no_valid_urls' });
    return [];
  }

  const progress = new ProgressBar({
    label: 'download',
    total: validUrls.length,
    width: 18,
    showStatus: true,
  });
  imageLog.info(progress.start(), { count: validUrls.length, dir: imagesDir });
  const saved: string[] = [];

  for (let i = 0; i < validUrls.length; i += 1) {
    const imageUrl = validUrls[i];
    try {
      const url = new URL(imageUrl);
      const ext = path.extname(url.pathname) || '.png';
      const filePath = path.join(imagesDir, `${i + 1}${ext}`);

      const response = await axios.get<ArrayBuffer>(imageUrl, { responseType: 'arraybuffer' });
      await writeFile(filePath, Buffer.from(response.data));
      saved.push(filePath);
      imageLog.info(progress.tick('ok'));
    } catch {
      imageLog.warn('download.failed', { url: imageUrl.slice(0, 120) });
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
  imageCount: number
): Promise<PreparedJob> => {
  const { dir, imagesDir } = await createJobDir(keyword);
  manuscriptLog.info('job.dir.created', { dir });

  const manuscript = await generateManuscript(keyword, service, ref);

  const manuscriptPath = path.join(dir, 'manuscript.txt');
  await writeFile(manuscriptPath, `${manuscript.title}\n\n${manuscript.content}`);

  const meta = {
    keyword,
    service,
    ref,
    manuscriptId: manuscript.id,
    createdAt: new Date().toISOString(),
    status: 'generated',
  };
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

  let images: string[] = [];
  if (generateImages) {
    const imageUrls = await generateImageUrls(keyword, imageCount);
    images = await downloadImagesToDir(imageUrls.slice(0, imageCount), imagesDir);
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
    const metaRaw = await import('fs/promises').then((fs) => fs.readFile(metaPath, 'utf-8'));
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
