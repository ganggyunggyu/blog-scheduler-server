import axios from 'axios';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { env } from '../config/env.js';
import { logger } from '../lib/logging/logger.js';
import { ProgressBar } from '../lib/utils/progress.js';
import { downloadImagesToDir, type ImageData } from './product-image.service.js';
import { signDabutServiceToken } from './dabut-app.service.js';
import type { ProductImagesResponse } from '../types/metadata.js';

export { getProductData, prepareProductImages, downloadImagesToDir } from './product-image.service.js';
export type { PreparedProductData, ImageData, MultiImageData, ExcludeLibraryLinkItem } from './product-image.service.js';

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

export type ImageSource = 'ai' | 'google' | 'keyword' | 'product' | 'local';
export type ManuscriptType = 'default' | 'update-restaurant' | 'restaurant' | 'restaurant/v1' | 'restaurant/v2' | 'pet' | 'grok' | 'keigo' | 'hanryeodamwon' | 'nyangnyang' | 'kimdongpal' | 'alibaba';

interface ManuscriptEndpoint {
  path: string;
  engine?: string;
  sendCategory?: boolean;
  /** 맛집1/맛집2 전용. 업체를 고정해서 같은 식당이 반복되는 걸 막을 때 씀. */
  sendBusinessName?: boolean;
}

const MANUSCRIPT_ENDPOINTS: Record<ManuscriptType, ManuscriptEndpoint> = {
  default: { path: '/generate/blog-filler' },
  'update-restaurant': { path: '/generate/update-restaurant' },
  restaurant: { path: '/generate/blog-filler-restaurant' },
  'restaurant/v1': { path: '/generate/restaurant/v1', sendBusinessName: true },
  'restaurant/v2': { path: '/generate/restaurant/v2', sendBusinessName: true },
  pet: { path: '/generate/blog-filler-pet' },
  grok: { path: '/generate/grok', engine: 'grok', sendCategory: true },
  keigo: { path: '/generate/keigo', engine: 'keigo' },
  hanryeodamwon: { path: '/generate/hanryeo', engine: 'hanryeodamwon' },
  nyangnyang: { path: '/generate/nyangnyang', engine: 'nyangnyang' },
  kimdongpal: { path: '/generate/kimdongpal', engine: 'kimdongpal' },
  alibaba: { path: '/generate/blog-filler' },
};

export interface ManuscriptRequestConfig {
  url: string;
  body: Record<string, string>;
  engine?: string;
  /** 다붓 Project 경로에서만 채워짐. 내장 엔드포인트는 인증이 없어 비워둠. */
  headers?: Record<string, string>;
}

export interface ManuscriptExtraOptions {
  /** 고정할 업체 상호명. 비우면 생성기가 키워드만 보고 알아서 고름. */
  businessName?: string;
  /** 맛집2 캐릭터명. 다른 원고 타입에서는 무시됨. */
  blogName?: string;
  /**
   * 다붓 Project id. 주면 하드코딩된 MANUSCRIPT_ENDPOINTS 를 건너뛰고
   * 프로젝트에 저장된 프롬프트/모델/파이프라인으로 뽑음.
   * 원고 방식을 추가할 때 이 서버를 다시 배포하지 않아도 되게 하는 경로임.
   */
  projectId?: string;
  /**
   * 프로젝트를 소유한 다붓 계정 id. 다붓이 프로젝트를 owner_id 로 격리해 읽어서
   * 이 값이 없으면 프로젝트 경로가 401 로 떨어짐.
   */
  ownerId?: string;
}

/** 다붓 Project 기반 생성. 프로젝트가 프롬프트와 모델을 들고 있어 여기선 식별자만 넘김. */
const PROJECT_ENDPOINT_PATH = '/generate/project';

const buildProjectRequest = (
  projectId: string,
  keyword: string,
  businessName?: string,
  ownerId?: string,
): ManuscriptRequestConfig => {
  // ref 는 여기서 절대 안 실어 보낸다. 스케쥴 배치 추적용 라벨("retry-3" 등)이
  // 들어오는 자리인데, 다붓 프로젝트 파이프라인은 ref 가 있으면 "사용자가
  // 이미 참조원고를 줬다"로 읽고 web_search pre_steps 를 통째로 건너뛴다.
  // 그러면 업체 정보가 하나도 안 채워진 채로 모델한테 넘어가서, 안전선
  // 지침("확인 안 된 사실은 지어내지 않는다")대로 모델이 정보 부족을 이유로
  // 100~200자짜리 거절 답변만 내놓고 700자 미달로 전부 리젝됐었다.
  const body: Record<string, string> = { project_id: projectId, keyword, ref: '' };

  if (businessName) {
    body.business_name = businessName;
  }

  // 토큰은 요청 직전에 새로 발급한다. 예약 잡은 며칠 뒤에 돌아서
  // 예약 시점에 만든 토큰은 실행할 때 이미 만료돼 있다.
  const headers = ownerId
    ? { Authorization: `Bearer ${signDabutServiceToken(ownerId)}` }
    : undefined;

  return { url: `${env.MANUSCRIPT_API_URL}${PROJECT_ENDPOINT_PATH}`, body, headers };
};

export const buildManuscriptRequest = (
  type: ManuscriptType,
  keyword: string,
  service: string,
  ref: string = '',
  category?: string,
  extras: ManuscriptExtraOptions = {},
): ManuscriptRequestConfig => {
  if (extras.projectId) {
    return buildProjectRequest(
      extras.projectId,
      keyword,
      extras.businessName,
      extras.ownerId,
    );
  }

  const endpoint = MANUSCRIPT_ENDPOINTS[type];
  const body: Record<string, string> = { service, keyword, ref };

  if (endpoint.sendCategory && category) {
    body.category = category;
  }

  if (endpoint.sendBusinessName) {
    body.business_name = extras.businessName ?? '';
    body.blog_name = extras.blogName ?? '';
  }

  return {
    url: `${env.MANUSCRIPT_API_URL}${endpoint.path}`,
    body,
    engine: endpoint.engine,
  };
};

/** `[제목] ...` 같은 라벨 접두어. 맛집2 출력이 이 형태로 나옴. */
const TITLE_LABEL_PREFIX = /^\[?\s*제목\s*\]?\s*[:：]?\s*/;
/** 제목 바로 아래 구분선. 맛집2 포맷이 `------...` 한 줄을 끼워 넣음. */
const DIVIDER_LINE = /^[-—–_=*]{5,}$/;

export const parseManuscriptContent = (
  raw: string,
  fallbackTitle: string,
): { title: string; content: string } => {
  const lines = (raw ?? '').split('\n');
  const title = (lines[0] ?? '').replace(TITLE_LABEL_PREFIX, '').trim() || fallbackTitle;

  const body = lines.slice(1);
  while (body.length > 0) {
    const head = body[0].trim();
    if (head.length > 0 && !DIVIDER_LINE.test(head)) {
      break;
    }
    body.shift();
  }

  return { title, content: body.join('\n').trim() };
};

/**
 * 원고 대신 "정보가 없어서 못 쓰겠다"는 거절문이 돌아오는 경우가 있음.
 * 맛집1/맛집2 는 업체 참고자료가 비면 사실을 지어내지 않는 대신 이런 응답을 내는데,
 * 그대로 두면 거절문이 블로그에 그대로 발행됨(실제로 발행된 적 있음).
 * 길이와 문구를 같이 봐서 거절문이면 생성 단계에서 실패시킴.
 */
const REFUSAL_PATTERNS = [
  /검색을?\s*직접\s*(실행|수행)할\s*수\s*(없|있는\s*환경이\s*아)/,
  /사실처럼\s*작성하면\s*안\s*됩니다/,
  /제공\s*(자료|정보)에\s*없어/,
  /(주시면|알려주시면)[^.\n]{0,60}(작성|완성)할\s*수\s*있습니다/,
  /검증을\s*완료할\s*수\s*없습니다/,
];

/**
 * 업체 참고자료(ref)를 못 구하면 맛집 프롬프트는 사실을 지어내는 대신
 * "🏡주소 업체 참고자료 미기재", "⏰영업시간 방문 전 확인" 처럼 업체정보 블록을
 * 플레이스홀더로 채운다. 안전장치 자체는 맞는데, 이게 그대로 나가면 업체정보가
 * 통째로 빈 글이 발행된다(실제로 발행된 적 있음). "미기재" 문구가 한 번이라도
 * 있거나 "방문 전 확인"이 여러 번 겹치면 업체정보 블록이 사실상 텅 빈 걸로 보고
 * 생성 단계에서 막는다.
 */
const NO_REFERENCE_MARKERS = [/업체\s*참고자료\s*미기재/, /참고자료가?\s*없어/];
const VISIT_TO_CONFIRM_PATTERN = /방문\s*전\s*확인/g;
const VISIT_TO_CONFIRM_THRESHOLD = 2;

const MIN_MANUSCRIPT_LENGTH = 700;

export const findManuscriptRejection = (content: string): string | undefined => {
  const compact = content.replace(/\s/g, '');

  const matched = REFUSAL_PATTERNS.find((pattern) => pattern.test(content));
  if (matched) {
    return `생성기가 원고 대신 거절문을 반환함 (${compact.length}자)`;
  }

  if (compact.length < MIN_MANUSCRIPT_LENGTH) {
    return `원고가 너무 짧음 (${compact.length}자 < ${MIN_MANUSCRIPT_LENGTH}자)`;
  }

  const hasNoReferenceMarker = NO_REFERENCE_MARKERS.some((pattern) => pattern.test(content));
  const visitToConfirmCount = (content.match(VISIT_TO_CONFIRM_PATTERN) ?? []).length;
  if (hasNoReferenceMarker || visitToConfirmCount >= VISIT_TO_CONFIRM_THRESHOLD) {
    return `업체 참고자료 부족으로 업체정보 블록이 플레이스홀더로 채워짐 (미기재=${hasNoReferenceMarker}, 방문전확인=${visitToConfirmCount}회)`;
  }

  return undefined;
};

export const callManuscriptAPI = async (
  type: ManuscriptType,
  keyword: string,
  service: string,
  ref: string = '',
  category?: string,
  extras: ManuscriptExtraOptions = {},
): Promise<{ id: string; title: string; content: string; raw: Manuscript }> => {
  const { url, body, engine, headers } = buildManuscriptRequest(type, keyword, service, ref, category, extras);
  const progress = new ProgressBar({ label: 'manuscript', total: 1, width: 16 });
  manuscriptLog.info(progress.start('request'), {
    url,
    keyword,
    service,
    ref,
    ...(extras.businessName && { businessName: extras.businessName }),
    ...(engine && { engine }),
  });

  const response = await axios.post<Manuscript>(url, body, { timeout: 300000, headers });

  const raw = response.data;
  const { title, content } = parseManuscriptContent(raw.content ?? '', keyword);

  const rejection = findManuscriptRejection(content);
  if (rejection) {
    manuscriptLog.error('manuscript.rejected', { keyword, type, reason: rejection });
    throw new Error(`원고 생성 실패: ${rejection} (keyword=${keyword})`);
  }

  manuscriptLog.info(progress.done('done'), {
    id: raw._id ?? '',
    titlePreview: title.slice(0, 30),
    length: content.length,
    ...(engine && { engine }),
  });

  return { id: raw._id ?? '', title, content, raw };
};

const parseImageResponse = (data: unknown): string[] => {
  const res = data as Record<string, unknown>;

  // product 응답: { images: { body: string[] } }
  const nested = res?.images as Record<string, unknown> | undefined;
  if (nested?.body && Array.isArray(nested.body)) {
    return (nested.body as string[]).filter(Boolean);
  }

  // AI 생성 응답: { images: [{url: string}, ...] }
  if (Array.isArray(res?.images)) {
    return (res.images as Array<{ url?: string }>)
      .map((img) => img?.url)
      .filter((u): u is string => Boolean(u));
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

  try {
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
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      imageLog.info('ai-images.not-ready', { keyword, message: '이미지 소스 부족' });
      return [];
    }
    throw error;
  }
};

const generateImageUrlsFromAI = async (
  keyword: string,
  imageCount: number,
  category?: string,
  ownerId?: string
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

  // 다붓 쪽 계정별 API 키 미들웨어는 Authorization 헤더가 있는 요청에만 적용된다.
  // 헤더 없이 부르면 계정이 등록한 키를 못 찾고 서버 기본 키로 조용히 떨어져서,
  // 그 키가 죽어 있으면(선불 크레딧 소진 등) 원고는 되는데 이미지만 계속 빈다.
  const headers = ownerId
    ? { Authorization: `Bearer ${signDabutServiceToken(ownerId)}` }
    : undefined;

  const urls: string[] = [];
  const maxAttempts = 3;

  for (let attempt = 1; urls.length < imageCount && attempt <= maxAttempts; attempt += 1) {
    const requestedCount = imageCount - urls.length;
    const response = await axios.post(
      url,
      { keyword, category: category ?? '', count: requestedCount },
      { timeout: 300000, headers }
    );

    const nextUrls = parseImageResponse(response.data)
      .filter((imageUrl) => !urls.includes(imageUrl));
    urls.push(...nextUrls);

    if (nextUrls.length === 0) {
      break;
    }

    if (urls.length < imageCount) {
      imageLog.warn('image.shortfall.retry', {
        keyword,
        requested: imageCount,
        received: urls.length,
        attempt,
      });
    }
  }

  imageLog.info(progress.done('done'), { count: urls.length });

  return urls.slice(0, imageCount);
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
  ownerId?: string,
): Promise<string[]> => {
  const urls = await generateImageUrlsFromAI(keyword, imageCount, category, ownerId);
  const imageData = urls.map((url) => ({ url }));
  return downloadImagesToDir(imageData, imagesDir);
};

export const generateImageUrls = async (
  keyword: string,
  imageCount: number,
  category?: string,
  imageSource: ImageSource = 'ai',
  ownerId?: string
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
    const { getProductData } = await import('./product-image.service.js');
    const data = await getProductData({ keyword, category });
    return data.bodyImages;
  }
  if (imageSource === 'local') {
    return [];
  }
  const urls = await generateImageUrlsFromAI(keyword, imageCount, category, ownerId);
  return urls.map((url) => ({ url }));
};

export interface PreparedJob {
  jobDir: string;
  title: string;
  content: string;
  images: string[];
  manuscriptId: string;
}

export interface ProvidedManuscript {
  title: string;
  content: string;
}

const writePreparedJobFiles = async (
  dir: string,
  manuscript: { id: string; title: string; content: string },
  meta: Record<string, unknown>,
): Promise<void> => {
  const manuscriptPath = path.join(dir, 'manuscript.txt');
  await writeFile(
    manuscriptPath,
    `${manuscript.title}\n\n${manuscript.content}`
  );
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
};

export const prepareProvidedJob = async (
  keyword: string,
  service: string,
  ref: string,
  manuscript: ProvidedManuscript,
  generateImages: boolean,
  imageCount: number,
  imageSource: ImageSource = 'ai',
  manuscriptType: ManuscriptType = 'default',
  ownerId?: string,
): Promise<PreparedJob> => {
  const { dir, imagesDir } = await createJobDir(keyword);
  const manuscriptId = `manual_${Date.now()}`;
  manuscriptLog.info('job.dir.created', { dir, manuscriptType, source: 'manual' });

  await writePreparedJobFiles(
    dir,
    {
      id: manuscriptId,
      title: manuscript.title,
      content: manuscript.content,
    },
    {
      keyword,
      service,
      ref,
      manuscriptId,
      imageSource,
      manuscriptType,
      createdAt: new Date().toISOString(),
      status: 'generated',
      source: 'manual',
    },
  );

  let images: string[] = [];
  if (generateImages) {
    const finalImageCount = imageSource === 'product' ? 10 : imageCount;
    const imageUrls = await generateImageUrls(
      keyword,
      finalImageCount,
      undefined,
      imageSource,
      ownerId
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
    source: 'manual',
  });

  return {
    jobDir: dir,
    title: manuscript.title,
    content: manuscript.content,
    images,
    manuscriptId,
  };
};

export const prepareJob = async (
  keyword: string,
  service: string,
  ref: string,
  generateImages: boolean,
  imageCount: number,
  imageSource: ImageSource = 'ai',
  manuscriptType: ManuscriptType = 'default',
  category?: string,
  extras: ManuscriptExtraOptions = {},
): Promise<PreparedJob> => {
  const { dir, imagesDir } = await createJobDir(keyword);
  manuscriptLog.info('job.dir.created', { dir, manuscriptType });

  const manuscript = await callManuscriptAPI(manuscriptType, keyword, service, ref, category, extras);
  await writePreparedJobFiles(
    dir,
    manuscript,
    {
      keyword,
      service,
      ref,
      manuscriptId: manuscript.id,
      imageSource,
      manuscriptType,
      createdAt: new Date().toISOString(),
      status: 'generated',
      source: 'api',
    },
  );

  let images: string[] = [];
  if (generateImages) {
    const finalImageCount = imageSource === 'product' ? 10 : imageCount;
    const imageUrls = await generateImageUrls(
      keyword,
      finalImageCount,
      undefined,
      imageSource,
      extras.ownerId
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
