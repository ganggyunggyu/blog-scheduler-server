# API 옵션 가이드

## image_source (이미지 소스)

| 값 | 설명 | 엔드포인트 |
|-----|------|-----------|
| `ai` | AI 생성 이미지 (기본값) | `/generate/image` |
| `google` | 랜덤 프레임 이미지 | `/api/image/random-frames` |
| `keyword` | 키워드 기반 프레임 이미지 | `/api/image/keyword-frames` |
| `product` | S3 상품 이미지 | `/api/image/product-images` |

```typescript
type ImageSource = 'ai' | 'google' | 'keyword' | 'product';
```

## manuscript_type (원고 타입)

| 값 | 설명 | 엔드포인트 |
|-----|------|-----------|
| `default` | 기본 블로그 원고 (기본값) | `/generate/blog-filler` |
| `update-restaurant` | 맛집 업데이트 원고 | `/generate/update-restaurant` |
| `pet` | 반려동물 원고 | `/generate/blog-filler-pet` |
| `grok` | Grok 엔진 원고 | `/generate/grok` |
| `keigo` | Keigo 엔진 원고 (Gemini) | `/generate/keigo` |

```typescript
type ManuscriptType = 'default' | 'update-restaurant' | 'pet' | 'grok' | 'keigo';
```

## schedule_mode (스케줄 모드)

| 값 | 설명 |
|-----|------|
| `1` | 하루 1개씩 |
| `2` | 하루 2개씩 (기본값) |
| `3` | 하루 3개씩 |
| `2121` | 2-1-2-1 패턴 (짝수일 2개, 홀수일 1개) |

```typescript
type ScheduleMode = '1' | '2' | '3' | '2121';
```

## account (계정 정보)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `id` | string | O | 네이버 계정 ID |
| `password` | string | O | 네이버 계정 비밀번호 |
| `blogId` | string | X | 블로그 ID (미입력 시 계정 ID 사용) |

`blogId`는 `image_source: "product"` 사용 시 상품 이미지 API에 전달됩니다.
미입력 시 발행 단계에서 `account.id`를 기본값으로 사용합니다.

```typescript
interface Account {
  id: string;
  password: string;
  blogId?: string;
}
```

## 요청 예시

### 기본 (blogId 없이)

```json
{
  "queues": [
    {
      "account": { "id": "user123", "password": "pw123" },
      "keywords": ["스마일라식회복"]
    }
  ],
  "image_source": "keyword",
  "manuscript_type": "grok",
  "schedule_mode": "2",
  "generate_images": true,
  "image_count": 5
}
```

### blogId 포함

```json
{
  "queues": [
    {
      "account": { "id": "user123", "password": "pw123", "blogId": "my_blog_name" },
      "keywords": ["스마일라식회복"]
    }
  ],
  "image_source": "product",
  "schedule_mode": "1"
}
```
