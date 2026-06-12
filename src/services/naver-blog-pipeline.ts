import type { ManuscriptType } from './manuscript.service.js';
import type { MultiImageData } from '../lib/naver-editor/image.js';

export type ContentBlock =
  | 'excluded1'
  | 'excluded2'
  | 'excluded3'
  | 'allExcluded'
  | 'maps'
  | 'phone'
  | 'content'
  | 'excludeLibraryLinks'
  | 'spacing'
  | 'bottomSpacing'
  | 'link'
  | 'multiImages'
  | 'whiteText';

export const DEFAULT_CONTENT_PIPELINE: ContentBlock[] = [
  'excluded1',
  'maps',
  'phone',
  'excluded2',
  'content',
  'excluded3',
  'link',
  'multiImages',
];

export const CONTENT_PIPELINES: Record<string, ContentBlock[]> = {
  default: DEFAULT_CONTENT_PIPELINE,
  애견: ['excluded1', 'maps', 'phone', 'excluded2', 'excluded3', 'link', 'spacing', 'content'],
  안과: ['allExcluded', 'excludeLibraryLinks', 'maps', 'spacing', 'content', 'multiImages'],
  안과기본: ['maps', 'spacing', 'content', 'multiImages'],
  안과브랜드: ['content', 'multiImages'],
  한려담원: ['content', 'link'],
};

export const ALIBABA_CONTENT_PIPELINE: ContentBlock[] = [
  'allExcluded',
  'spacing',
  'content',
  'bottomSpacing',
  'multiImages',
  'whiteText',
];

interface ContentPipelineOptions {
  keywordCategory?: string;
  manuscriptType?: ManuscriptType;
  hasExcludeLibrary?: boolean;
}

const EYE_PIPELINE_CATEGORIES = new Set(['안과', '안과기본']);
export const EYE_BRAND_KEYWORD_CATEGORY = '안과브랜드';
const EYE_SLIDE_FALLBACK_COUNTS = new Map<string, number>([
  ['안과', 5],
  [EYE_BRAND_KEYWORD_CATEGORY, 6],
]);

export const isEyeBrandPipelineCategory = (keywordCategory?: string): boolean =>
  keywordCategory === EYE_BRAND_KEYWORD_CATEGORY;

export const getFallbackSlideImageCount = (keywordCategory?: string): number | undefined =>
  keywordCategory ? EYE_SLIDE_FALLBACK_COUNTS.get(keywordCategory) : undefined;

export const getContentPipeline = ({
  keywordCategory,
  manuscriptType,
  hasExcludeLibrary,
}: ContentPipelineOptions = {}): ContentBlock[] => {
  let pipeline: ContentBlock[];

  if (manuscriptType === 'alibaba') {
    pipeline = ALIBABA_CONTENT_PIPELINE;
  } else if (keywordCategory && CONTENT_PIPELINES[keywordCategory]) {
    pipeline = CONTENT_PIPELINES[keywordCategory];
  } else {
    pipeline = CONTENT_PIPELINES.default;
  }

  if (keywordCategory && EYE_PIPELINE_CATEGORIES.has(keywordCategory) && hasExcludeLibrary === false) {
    return pipeline.filter((block) => block !== 'spacing');
  }

  return [...pipeline];
};

interface ContentImagesForBlockOptions {
  keywordCategory?: string;
  manuscriptType?: ManuscriptType;
  block: ContentBlock;
  normalImages: string[];
  multiImages?: MultiImageData;
}

export const getContentImagesForBlock = ({
  keywordCategory,
  normalImages,
  multiImages,
}: ContentImagesForBlockOptions): string[] => {
  if (isEyeBrandPipelineCategory(keywordCategory) && multiImages?.slide?.length) {
    return [...multiImages.slide];
  }

  return normalImages;
};

interface MultiImagesForBlockOptions {
  keywordCategory?: string;
  multiImages?: MultiImageData;
}

const hasImages = (images?: string[]): images is string[] =>
  Boolean(images?.length);

export const getMultiImagesForBlock = ({
  keywordCategory,
  multiImages,
}: MultiImagesForBlockOptions): MultiImageData | undefined => {
  if (!multiImages) {
    return undefined;
  }

  if (!isEyeBrandPipelineCategory(keywordCategory)) {
    return multiImages;
  }

  const remaining: MultiImageData = {};
  if (hasImages(multiImages.individual)) {
    remaining.individual = [...multiImages.individual];
  }
  if (hasImages(multiImages.collage)) {
    remaining.collage = [...multiImages.collage];
  }

  return hasImages(remaining.individual) || hasImages(remaining.collage)
    ? remaining
    : undefined;
};

interface ContentTextForBlockOptions {
  keywordCategory?: string;
  title?: string;
  content: string;
}

export const getContentTextForBlock = ({
  keywordCategory,
  title,
  content,
}: ContentTextForBlockOptions): string => {
  const trimmedTitle = title?.trim();
  if (!isEyeBrandPipelineCategory(keywordCategory) || !trimmedTitle) {
    return content;
  }

  const trimmedStartContent = content.trimStart();
  if (trimmedStartContent.startsWith(trimmedTitle)) {
    return content;
  }

  return `${trimmedTitle}\n\n${trimmedStartContent}`;
};
