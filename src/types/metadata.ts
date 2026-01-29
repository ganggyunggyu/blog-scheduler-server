export interface ProductMetadata {
  mapQueries?: string[];
  phone?: string;
  url?: string;
}

export interface ProductImagesResponse {
  images: Array<{ url: string; filename?: string }>;
  total: number;
  metadata?: ProductMetadata;
}
