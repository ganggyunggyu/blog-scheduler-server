# 다중 이미지 업로드 API 명세

## 개요

네이버 블로그 에디터에 여러 이미지를 한 번에 업로드할 때 사용하는 데이터 구조입니다.
이미지 타입(개별/콜라주/슬라이드)에 따라 에디터에서 다르게 표시됩니다.

## 이미지 타입

| 타입 | 한글명 | 설명 |
|------|--------|------|
| `list` | 개별사진 | 이미지가 세로로 하나씩 나열됨 |
| `collage` | 콜라주 | 여러 이미지가 격자 형태로 합쳐짐 |
| `slide` | 슬라이드 | 좌우로 넘기는 슬라이드 형태 |

## 데이터 구조

### MultiImageData

```typescript
interface MultiImageData {
  기본?: string[];    // list 타입으로 업로드 (라이브러리제외 파일 포함)
  개별?: string[];    // list 타입으로 업로드
  콜라주?: string[];  // collage 타입으로 업로드
  슬라이드?: string[]; // slide 타입으로 업로드
}
```

### 키별 처리 방식

| 키 | 에디터 타입 | 비고 |
|----|-------------|------|
| `기본` | list | 서브폴더 없는 이미지 + 라이브러리제외 파일 |
| `개별` | list | 개별 폴더 이미지 |
| `콜라주` | collage | 콜라주 폴더 이미지 |
| `슬라이드` | slide | 슬라이드 폴더 이미지 |

### 예시

```json
{
  "개별": [
    "https://s3.amazonaws.com/bucket/images/img1.png",
    "https://s3.amazonaws.com/bucket/images/img2.png",
    "https://s3.amazonaws.com/bucket/images/img3.png"
  ],
  "콜라주": [
    "https://s3.amazonaws.com/bucket/images/collage1.png",
    "https://s3.amazonaws.com/bucket/images/collage2.png",
    "https://s3.amazonaws.com/bucket/images/collage3.png",
    "https://s3.amazonaws.com/bucket/images/collage4.png"
  ],
  "슬라이드": [
    "https://s3.amazonaws.com/bucket/images/slide1.png",
    "https://s3.amazonaws.com/bucket/images/slide2.png",
    "https://s3.amazonaws.com/bucket/images/slide3.png"
  ]
}
```

## S3 저장 구조 (권장)

```
s3://bucket/manuscripts/{manuscriptId}/images/
├── 개별/
│   ├── img1.png
│   ├── img2.png
│   └── img3.png
├── 콜라주/
│   ├── collage1.png
│   ├── collage2.png
│   ├── collage3.png
│   └── collage4.png
└── 슬라이드/
    ├── slide1.png
    ├── slide2.png
    └── slide3.png
```

## API 요청 시 전달 방식

### Option 1: 기존 images 필드 확장

```typescript
interface Manuscript {
  title: string;
  content: string;
  images?: string[];           // 기존: 단일 타입 이미지 배열
  multiImages?: MultiImageData; // 신규: 타입별 이미지 그룹
}
```

### Option 2: images 필드를 MultiImageData로 대체

```typescript
interface Manuscript {
  title: string;
  content: string;
  images?: string[] | MultiImageData;
}
```

## 처리 로직

1. `multiImages` 또는 `MultiImageData` 형태가 전달되면:
   - 각 키(개별/콜라주/슬라이드)별로 순차 업로드
   - 각 그룹은 해당 타입으로 에디터에 삽입

2. 기존 `string[]` 형태가 전달되면:
   - 기본값 `list`(개별사진) 타입으로 업로드 (하위 호환)

## 제한사항

- 콜라주: 최대 10장 권장 (네이버 에디터 제한)
- 슬라이드: 최대 50장 권장
- 개별: 제한 없음 (단, 전체 용량 주의)

## 업로드 순서

현재 구현에서는 다음 순서로 업로드됩니다:
1. 개별 (list)
2. 슬라이드 (slide)
3. 콜라주 (collage)

순서 변경이 필요하면 요청해주세요.
