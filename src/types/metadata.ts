export interface ProductMetadata {
  mapQueries?: string[];
  phone?: string;
  url?: string;
  lib_url?: string[];
}

export interface ProductImages {
  body: string[];
  individual: string[];
  slide: string[];
  collage: string[];
  excludeLibrary: string[];
  excludeLibraryLink: string[];
}

export interface ExcludeLibraryLinkItem {
  imagePath: string;
  url: string;
}

export interface ProductImagesResponse {
  images: ProductImages;
  metadata: ProductMetadata;
  keyword: string;
  folder: string;
  total: number;
  failed: number;
}
