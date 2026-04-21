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
  안과: ['allExcluded', 'excludeLibraryLinks', 'maps', 'content', 'multiImages'],
  안과기본: ['maps', 'content', 'multiImages'],
  한려담원: ['content', 'link'],
};

export const ALIBABA_CONTENT_PIPELINE: ContentBlock[] = [
  'allExcluded',
  'spacing',
  'content',
  'whiteText',
];

interface ContentPipelineOptions {
  keywordCategory?: string;
  manuscriptType?: ManuscriptType;
}

export const getContentPipeline = ({
  keywordCategory,
  manuscriptType,
}: ContentPipelineOptions = {}): ContentBlock[] => {
  if (manuscriptType === 'alibaba') {
    return [...ALIBABA_CONTENT_PIPELINE];
  }

  if (keywordCategory && CONTENT_PIPELINES[keywordCategory]) {
    return [...CONTENT_PIPELINES[keywordCategory]];
  }

  return [...CONTENT_PIPELINES.default];
};
