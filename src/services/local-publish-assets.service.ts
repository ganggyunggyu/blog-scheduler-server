import type { MultiImageData } from '../lib/naver-editor/image.js';
import type { PreparedProductData } from './product-image.service.js';
import { isEyeBrandPipelineCategory } from './naver-blog-pipeline.js';

export const hasMultiImageData = (multiImages?: MultiImageData): boolean =>
  Boolean(
    (multiImages?.individual?.length ?? 0) +
    (multiImages?.slide?.length ?? 0) +
    (multiImages?.collage?.length ?? 0),
  );

export const hasPreparedProductImages = (productData?: PreparedProductData | null): boolean =>
  Boolean(
    productData &&
    (
      productData.bodyImages.length +
      productData.excludeLibrary.length +
      productData.excludeLibraryLink.length +
      (productData.multiImages.individual?.length ?? 0) +
      (productData.multiImages.slide?.length ?? 0) +
      (productData.multiImages.collage?.length ?? 0)
    ),
  );

export const hasPreparedBodyImages = (productData?: PreparedProductData | null): boolean =>
  Boolean(productData?.bodyImages.length);

const addImages = (
  target: MultiImageData,
  key: keyof MultiImageData,
  images?: string[],
): void => {
  if (images?.length) {
    target[key] = [...images];
  }
};

export const buildProvidedProductData = (
  multiImages?: MultiImageData,
): PreparedProductData | null => {
  if (!hasMultiImageData(multiImages)) {
    return null;
  }

  const copiedMultiImages: MultiImageData = {};
  addImages(copiedMultiImages, 'individual', multiImages?.individual);
  addImages(copiedMultiImages, 'slide', multiImages?.slide);
  addImages(copiedMultiImages, 'collage', multiImages?.collage);

  return {
    bodyImages: [],
    excludeLibrary: [],
    multiImages: copiedMultiImages,
    excludeLibraryLink: [],
    metadata: {},
  };
};

interface NeedsBodyImageFallbackOptions {
  keywordCategory?: string;
  bodyImages: string[];
  multiImages?: MultiImageData;
}

export const needsBodyImageFallback = ({
  keywordCategory,
  bodyImages,
  multiImages,
}: NeedsBodyImageFallbackOptions): boolean => {
  if (bodyImages.length > 0) {
    return false;
  }

  if (isEyeBrandPipelineCategory(keywordCategory) && (multiImages?.slide?.length ?? 0) > 0) {
    return false;
  }

  return true;
};
