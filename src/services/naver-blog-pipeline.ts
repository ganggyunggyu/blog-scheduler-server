import type { ManuscriptType } from './manuscript.service.js';

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
  한려담원: ['content', 'link'],
};

export const ALIBABA_CONTENT_PIPELINE: ContentBlock[] = [
  'allExcluded',
  'spacing',
  'content',
  'spacing',
  'multiImages',
  'whiteText',
];

interface ContentPipelineOptions {
  keywordCategory?: string;
  manuscriptType?: ManuscriptType;
  hasExcludeLibrary?: boolean;
}

const EYE_PIPELINE_CATEGORIES = new Set(['안과', '안과기본']);

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
  manuscriptType?: ManuscriptType;
  block: ContentBlock;
  normalImages: string[];
}

export const getContentImagesForBlock = ({
  normalImages,
}: ContentImagesForBlockOptions): string[] => {
  return normalImages;
};
