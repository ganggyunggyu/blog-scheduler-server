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
  | 'multiImages';

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
  한려담원: ['content', 'link'],
};

export const getContentPipeline = (keywordCategory?: string): ContentBlock[] => {
  if (keywordCategory && CONTENT_PIPELINES[keywordCategory]) {
    return [...CONTENT_PIPELINES[keywordCategory]];
  }

  return [...CONTENT_PIPELINES.default];
};
