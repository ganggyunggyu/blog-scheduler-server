import { createHash } from 'crypto';

interface ScheduleRequestFingerprintInput {
  accountId: string;
  service: string;
  ref: string;
  scheduleDate?: string;
  scheduleMode?: string;
  generateImages: boolean;
  imageCount: number;
  delayBetweenPostsSeconds: number;
  keywords: string[];
  imageSource?: string;
  manuscriptType?: string;
  keywordCategory?: string;
  scheduleTimingKey?: string;
  manuscripts?: Array<{ title: string; content: string }>;
  providedMultiImages?: Array<{
    individual?: string[];
    slide?: string[];
    collage?: string[];
  }>;
  /**
   * 항목별 override(업체명/원고 타입/프로젝트). 키워드가 같아도 업체나 프로젝트가
   * 다르면 다른 스케쥴이라 fingerprint 에 반영해야 함. 값이 없을 때는 키 자체를 빼서
   * 기존 스케쥴의 fingerprint 와 호환을 유지함.
   */
  itemOverrides?: Array<{
    keyword: string;
    businessName?: string;
    manuscriptType?: string;
    projectId?: string;
  }>;
}

interface AdhocGenerateIdentityInput {
  mode: 'update' | 'image-replace';
  accountId: string;
  blogId?: string;
  logNo?: string;
  keyword: string;
  category?: string;
  service?: string;
  ref?: string;
  imageSource?: string;
  manuscriptType?: string;
  keywordCategory?: string;
  providedManuscript?: { title: string; content: string };
}

const hashPayload = (payload: unknown): string =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);

const normalizeKeywords = (keywords: string[]): string[] =>
  keywords.map((keyword) => keyword.trim());

const normalizeManuscripts = (
  manuscripts: Array<{ title: string; content: string }> = [],
): Array<{ title: string; content: string }> =>
  manuscripts.map((manuscript) => ({
    title: manuscript.title.trim(),
    content: manuscript.content.trim(),
  }));

const normalizeMultiImages = (
  imageGroups: ScheduleRequestFingerprintInput['providedMultiImages'] = [],
): NonNullable<ScheduleRequestFingerprintInput['providedMultiImages']> =>
  imageGroups.map((group) => ({
    individual: group.individual?.map((image) => image.trim()).filter(Boolean) ?? [],
    slide: group.slide?.map((image) => image.trim()).filter(Boolean) ?? [],
    collage: group.collage?.map((image) => image.trim()).filter(Boolean) ?? [],
  }));

const buildBullJobId = (...parts: string[]): string =>
  parts.map((part) => part.trim()).filter(Boolean).join('_');

const normalizeItemOverrides = (
  itemOverrides: ScheduleRequestFingerprintInput['itemOverrides'] = [],
): Array<{ keyword: string; businessName: string; manuscriptType: string; projectId?: string }> =>
  itemOverrides
    .map((item) => {
      const projectId = item.projectId?.trim() ?? '';
      return {
        keyword: item.keyword.trim(),
        businessName: item.businessName?.trim() ?? '',
        manuscriptType: item.manuscriptType?.trim() ?? '',
        // projectId 는 있을 때만 키를 만든다. 항상 넣으면 이미 걸려 있는 예약들의
        // fingerprint 가 전부 바뀌어 같은 요청이 중복으로 다시 잡힌다.
        ...(projectId.length > 0 && { projectId }),
      };
    })
    .filter(
      (item) =>
        item.businessName.length > 0 ||
        item.manuscriptType.length > 0 ||
        (item.projectId?.length ?? 0) > 0,
    );

export const buildScheduleRequestFingerprint = (
  input: ScheduleRequestFingerprintInput,
): string => {
  const itemOverrides = normalizeItemOverrides(input.itemOverrides);
  const normalized = {
    ...(itemOverrides.length > 0 && { itemOverrides }),
    accountId: input.accountId,
    service: input.service,
    ref: input.ref,
    scheduleDate: input.scheduleDate ?? '',
    scheduleMode: input.scheduleMode ?? '2',
    generateImages: input.generateImages,
    imageCount: input.imageCount,
    delayBetweenPostsSeconds: input.delayBetweenPostsSeconds,
    keywords: normalizeKeywords(input.keywords),
    imageSource: input.imageSource ?? 'ai',
    manuscriptType: input.manuscriptType ?? 'default',
    keywordCategory: input.keywordCategory ?? '',
    scheduleTimingKey: input.scheduleTimingKey ?? '',
    manuscripts: normalizeManuscripts(input.manuscripts),
    providedMultiImages: normalizeMultiImages(input.providedMultiImages),
  };

  return `schreq_${hashPayload(normalized)}`;
};

export const buildScheduleGenerateJobId = (scheduleJobId: string): string =>
  buildBullJobId('generate', scheduleJobId);

export const buildSchedulePublishJobId = (scheduleJobId: string): string =>
  buildBullJobId('publish', scheduleJobId);

export const buildAdhocGenerateIdentity = (
  input: AdhocGenerateIdentityInput,
): { scheduleId: string; scheduleJobId: string; jobId: string } => {
  const normalized = {
    mode: input.mode,
    accountId: input.accountId,
    blogId: input.blogId ?? '',
    logNo: input.logNo ?? '',
    keyword: input.keyword.trim(),
    category: input.category?.trim() ?? '',
    service: input.service ?? '',
    ref: input.ref ?? '',
    imageSource: input.imageSource ?? '',
    manuscriptType: input.manuscriptType ?? '',
    keywordCategory: input.keywordCategory ?? '',
    providedManuscript: input.providedManuscript ? {
      title: input.providedManuscript.title.trim(),
      content: input.providedManuscript.content.trim(),
    } : null,
  };

  const digest = hashPayload(normalized);

  return {
    scheduleId: `adhoc_${input.mode}_${digest}`,
    scheduleJobId: `adhoc_job_${input.mode}_${digest}`,
    jobId: buildBullJobId('generate', 'adhoc', input.mode, digest),
  };
};
