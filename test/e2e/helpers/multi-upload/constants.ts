import type { ImageType } from './types.ts';

export const IMAGE_TYPE_SELECTORS: Record<ImageType, string> = {
  list: 'label[for="image-type-list"]',
  collage: 'label[for="image-type-collage"]',
  slide: 'label[for="image-type-slide"]',
};

export const IMAGE_BTN_SELECTORS = [
  'button[data-name="image"]',
  'button.se-toolbar-button-image',
] as const;

export const UPLOAD_WAIT_MS_PER_IMAGE = 3000;
