# Product Metadata API 설계

## 개요

S3에 저장된 상품 이미지 폴더에 `metadata.json` 파일을 함께 저장하고,
이를 파싱하여 블로그 포스팅에 지도, 전화번호, URL을 삽입하는 기능.

## 메타데이터 구조

```typescript
interface ProductMetadata {
  mapQueries?: string[];  // 네이버 지도 검색어 (여러 개 가능)
  phone?: string;         // 전화번호
  url?: string;           // 링크 URL
}
```

### 예시 (`metadata.json`)

```json
{
  "mapQueries": [
    "천안 도그마루",
    "부산 도그마루",
    "일산 도그마루",
    "하남 도그마루"
  ],
  "phone": "1566-8713",
  "url": "https://dmanimal.co.kr/"
}
```

## API 엔드포인트 (IMAGE_API 서버)

### 1. 메타데이터 조회

```
GET /api/image/product-metadata?keyword={keyword}
```

**Response**
```json
{
  "success": true,
  "metadata": {
    "mapQueries": ["천안 도그마루", "부산 도그마루"],
    "phone": "1566-8713",
    "url": "https://dmanimal.co.kr/"
  }
}
```

**없는 경우**
```json
{
  "success": true,
  "metadata": null
}
```

### 2. 이미지 + 메타데이터 통합 조회 (권장)

기존 `/api/image/product-images` 응답에 메타데이터 포함:

```
GET /api/image/product-images?keyword={keyword}&count={count}
```

**Response**
```json
{
  "images": [
    { "url": "https://...", "filename": "라이브러리제외_1.jpg" },
    { "url": "https://...", "filename": "image_1.png" }
  ],
  "total": 8,
  "metadata": {
    "mapQueries": ["천안 도그마루"],
    "phone": "1566-8713",
    "url": "https://dmanimal.co.kr/"
  }
}
```

## scheduler-server 구현

### 1. 타입 정의 (`src/types/metadata.ts`)

```typescript
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
```

### 2. 메타데이터 가져오기 (`src/services/manuscript.service.ts`)

```typescript
export const generateImageUrlsFromProduct = async (
  keyword: string,
  imageCount: number
): Promise<{ images: ImageData[]; metadata?: ProductMetadata }> => {
  // 기존 로직 + metadata 반환
};
```

### 3. PreparedJob 확장

```typescript
export interface PreparedJob {
  jobDir: string;
  title: string;
  content: string;
  images: string[];
  manuscriptId: string;
  metadata?: ProductMetadata;  // 추가
}
```

## 블로그 포스팅 순서

```
라이브러리제외_1
↓
지도 (mapQueries[0])
↓
전화번호 (phone)
↓
라이브러리제외_2
↓
원고 + 일반 이미지
↓
라이브러리제외_3
↓
URL 링크 (url)
```

## 네이버 에디터 함수 (구현 필요)

### 1. 지도 삽입

```typescript
// src/lib/naver-editor/map.ts
export const insertMap = async (
  page: Page,
  frame: Frame,
  query: string
): Promise<boolean>;
```

### 2. 전화번호 삽입

```typescript
// src/lib/naver-editor/phone.ts
export const insertPhone = async (
  page: Page,
  frame: Frame,
  phone: string
): Promise<boolean>;
```

### 3. URL 링크 삽입

```typescript
// src/lib/naver-editor/link.ts
export const insertLink = async (
  page: Page,
  frame: Frame,
  url: string
): Promise<boolean>;
```

## 구현 우선순위

1. `ProductMetadata` 타입 정의
2. IMAGE_API 서버에서 `metadata.json` 파싱 로직 추가
3. `generateImageUrlsFromProduct` 응답에 metadata 포함
4. `prepareJob`에서 metadata 전달
5. 네이버 에디터 지도/전화번호/URL 삽입 함수 구현
6. `writePost`에서 metadata 적용

## S3 폴더 구조 예시

```
products/
└── 뱅갈고양이/
    ├── metadata.json
    ├── 라이브러리제외_1.jpg
    ├── 라이브러리제외_2.jpg
    ├── 라이브러리제외_3.jpg
    ├── image_1.png
    ├── image_2.png
    ├── image_3.png
    ├── image_4.png
    └── image_5.png
```
