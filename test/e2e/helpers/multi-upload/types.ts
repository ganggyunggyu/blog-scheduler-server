export type ImageType = 'list' | 'collage' | 'slide';

export interface MultiImageData {
  기본?: string[];
  개별?: string[];
  콜라주?: string[];
  슬라이드?: string[];
}

export interface UploadResult {
  success: number;
  failed: number;
}

export interface UploadTotals {
  total: number;
  success: number;
  failed: number;
}
