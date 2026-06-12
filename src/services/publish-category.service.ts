import { EYE_BRAND_KEYWORD_CATEGORY } from './naver-blog-pipeline.js';

const EYE_BRAND_DEFAULT_PUBLISH_CATEGORY = '에스앤비 안과';

interface ResolvePublishCategoryOptions {
  jobCategory?: string;
  keywordCategory?: string;
}

const normalizeCategory = (category?: string): string | undefined => {
  const trimmed = category?.trim();
  return trimmed ? trimmed : undefined;
};

export const resolvePublishCategory = ({
  jobCategory,
  keywordCategory,
}: ResolvePublishCategoryOptions): string | undefined => {
  const explicitCategory = normalizeCategory(jobCategory);
  if (explicitCategory) {
    return explicitCategory;
  }

  const pipelineCategory = normalizeCategory(keywordCategory);
  if (pipelineCategory === EYE_BRAND_KEYWORD_CATEGORY) {
    return EYE_BRAND_DEFAULT_PUBLISH_CATEGORY;
  }

  return pipelineCategory;
};
