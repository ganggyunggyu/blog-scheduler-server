import axios from 'axios';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { ProgressBar } from '../lib/progress';

// 프로젝트 루트의 data/jobs 폴더에 저장
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

// 키워드 기반 작업 폴더 생성
async function createJobDir(keyword: string): Promise<JobDir> {
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
}

export async function generateManuscript(
  keyword: string,
  service: string,
  ref: string = ''
): Promise<{ id: string; title: string; content: string; raw: Manuscript }> {
  const url = `${env.MANUSCRIPT_API_URL}/generate/gemini-new`;
  const progress = new ProgressBar({
    label: 'manuscript',
    total: 1,
    width: 16,
  });
  manuscriptLog.info(progress.start('request'), { url, keyword, service, ref });

  const response = await axios.post<Manuscript>(
    url,
    {
      service,
      keyword,
      ref,
    },
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
}

export async function generateImageUrls(
  keyword: string,
  imageCount: number,
  category?: string
): Promise<string[]> {
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
    {
      keyword,
      category: category ?? '',
    },
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
}

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

async function downloadImagesToDir(
  imageUrls: string[],
  imagesDir: string
): Promise<string[]> {
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

      const response = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: 'arraybuffer',
      });
      await writeFile(filePath, Buffer.from(response.data));
      saved.push(filePath);
      imageLog.info(progress.tick('ok'));
    } catch (err) {
      imageLog.warn('download.failed', { url: imageUrl.slice(0, 120) });
      imageLog.info(progress.tick('fail'));
    }
  }

  imageLog.info(progress.done('saved'), { count: saved.length });
  return saved;
}

// 원고 + 이미지를 한 폴더에 준비
export interface PreparedJob {
  jobDir: string;
  title: string;
  content: string;
  images: string[];
  manuscriptId: string;
}

export async function prepareJob(
  keyword: string,
  service: string,
  ref: string,
  generateImages: boolean,
  imageCount: number
): Promise<PreparedJob> {
  // 1. 작업 폴더 생성
  const { dir, imagesDir } = await createJobDir(keyword);
  manuscriptLog.info('job.dir.created', { dir });

  // 2. 원고 생성
  const manuscript = await generateManuscript(keyword, service, ref);

  // 3. 원고 저장
  const manuscriptPath = path.join(dir, 'manuscript.txt');
  await writeFile(
    manuscriptPath,
    `${manuscript.title}\n\n${manuscript.content}`
  );

  // 4. 메타 정보 저장
  const meta = {
    keyword,
    service,
    ref,
    manuscriptId: manuscript.id,
    createdAt: new Date().toISOString(),
    status: 'generated',
  };
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

  // 5. 이미지 다운로드
  let images: string[] = [];
  if (generateImages) {
    const imageUrls = await generateImageUrls(keyword, imageCount);
    images = await downloadImagesToDir(
      imageUrls.slice(0, imageCount),
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
}

// 작업 결과 업데이트
export async function updateJobStatus(
  jobDir: string,
  status: 'success' | 'failed',
  details?: { postUrl?: string; error?: string }
): Promise<void> {
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
    // 메타 파일 없으면 무시
  }
}
