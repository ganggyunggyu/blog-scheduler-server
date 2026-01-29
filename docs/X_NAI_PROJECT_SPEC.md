# X 자동 포스팅 + NovelAI 이미지 생성 프로젝트 기획서

## 프로젝트 개요

X(Twitter) 자동 포스팅 시스템으로, xAI(Grok)로 텍스트를 생성하고 NovelAI로 애니메이션 스타일 이미지를 생성하여 자동으로 X에 업로드하는 Next.js 기반 풀스택 애플리케이션.

---

## 기술 스택

### Frontend
- **Framework**: Next.js 14+ (App Router)
- **Styling**: Tailwind CSS
- **State**: Jotai
- **Form**: React Hook Form + Zod
- **API Client**: TanStack Query

### Backend
- **Runtime**: Next.js API Routes / Route Handlers
- **Database**: MongoDB (Mongoose)
- **Queue**: BullMQ + Redis
- **Auth**: NextAuth.js (X OAuth 2.0)

### External APIs
- **xAI API**: 텍스트 생성 (Grok)
- **NovelAI API**: 이미지 생성
- **X API v2**: 트윗 발행

---

## 환경 변수 (.env)

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/x-bot

# Redis
REDIS_URL=redis://localhost:6379

# X (Twitter) API
X_CLIENT_ID=your_client_id
X_CLIENT_SECRET=your_client_secret
X_BEARER_TOKEN=your_bearer_token

# xAI (Grok) API
XAI_API_KEY=your_xai_api_key
XAI_API_URL=https://api.x.ai/v1

# NovelAI API
NAI_USERNAME=your_novelai_username
NAI_PASSWORD=your_novelai_password
NAI_API_URL=https://api.novelai.net

# NextAuth
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=http://localhost:3000
```

---

## 디렉토리 구조

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── posts/
│   │   │   ├── route.ts              # POST: 포스트 생성
│   │   │   └── [id]/route.ts         # GET/DELETE: 포스트 조회/삭제
│   │   ├── schedules/
│   │   │   ├── route.ts              # GET/POST: 스케줄 CRUD
│   │   │   └── [id]/route.ts
│   │   ├── generate/
│   │   │   ├── text/route.ts         # xAI 텍스트 생성
│   │   │   └── image/route.ts        # NAI 이미지 생성
│   │   └── queues/
│   │       └── dashboard/route.ts    # 큐 상태 조회
│   ├── dashboard/
│   │   ├── page.tsx                  # 대시보드 메인
│   │   ├── schedules/page.tsx        # 스케줄 관리
│   │   ├── posts/page.tsx            # 포스트 목록
│   │   └── settings/page.tsx         # 설정
│   └── auth/
│       ├── signin/page.tsx
│       └── callback/page.tsx
├── components/
│   ├── ui/                           # 공통 UI 컴포넌트
│   ├── post/
│   │   ├── PostForm.tsx              # 포스트 작성 폼
│   │   ├── PostPreview.tsx           # 미리보기
│   │   └── PostList.tsx              # 목록
│   ├── schedule/
│   │   ├── ScheduleForm.tsx
│   │   ├── ScheduleCalendar.tsx
│   │   └── ScheduleList.tsx
│   └── generate/
│       ├── TextGenerator.tsx         # xAI 텍스트 생성 UI
│       └── ImageGenerator.tsx        # NAI 이미지 생성 UI
├── lib/
│   ├── db.ts                         # MongoDB 연결
│   ├── redis.ts                      # Redis 연결
│   ├── auth.ts                       # NextAuth 설정
│   └── logger.ts                     # 로깅
├── services/
│   ├── x-auth.service.ts             # X OAuth 처리
│   ├── x-post.service.ts             # X 트윗 발행
│   ├── xai.service.ts                # xAI 텍스트 생성
│   ├── nai.service.ts                # NovelAI 이미지 생성
│   └── schedule.service.ts           # 스케줄 관리
├── queues/
│   ├── queue-manager.ts              # 큐 관리자
│   ├── generate.worker.ts            # 생성 워커
│   └── publish.worker.ts             # 발행 워커
├── schemas/
│   ├── post.schema.ts                # Post 모델
│   ├── schedule.schema.ts            # Schedule 모델
│   └── dto.ts                        # Zod 스키마
├── hooks/
│   ├── usePost.ts                    # 포스트 관련 훅
│   ├── useSchedule.ts                # 스케줄 관련 훅
│   └── useGenerate.ts                # 생성 관련 훅
├── stores/
│   └── app.store.ts                  # Jotai atoms
└── types/
    └── index.ts                      # 타입 정의
```

---

## 핵심 서비스 구현

### 1. xAI (Grok) 텍스트 생성 서비스

```typescript
// src/services/xai.service.ts
import axios from 'axios';

interface XAIResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export const generateXPost = async (
  keyword: string,
  style: 'casual' | 'professional' | 'humorous' = 'casual'
): Promise<string> => {
  const systemPrompt = `You are an expert social media content creator for X (Twitter).
Create engaging, viral-worthy posts that are:
- Under 280 characters
- Include relevant hashtags (2-3 max)
- Conversational and ${style}
- Written in Korean unless specified otherwise`;

  const response = await axios.post<XAIResponse>(
    `${process.env.XAI_API_URL}/chat/completions`,
    {
      model: 'grok-beta',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Create a post about: ${keyword}` }
      ],
      max_tokens: 150,
      temperature: 0.8,
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.choices[0].message.content;
};
```

### 2. NovelAI 이미지 생성 서비스

```typescript
// src/services/nai.service.ts
import axios from 'axios';

interface NAISession {
  accessToken: string;
  expiresAt: Date;
}

let session: NAISession | null = null;

const login = async (): Promise<string> => {
  if (session && session.expiresAt > new Date()) {
    return session.accessToken;
  }

  // NovelAI는 access_key 방식 사용
  const crypto = await import('crypto');
  const accessKey = crypto
    .createHash('sha256')
    .update(`${process.env.NAI_PASSWORD}${process.env.NAI_USERNAME}`)
    .digest('base64')
    .slice(0, 64);

  const response = await axios.post(
    `${process.env.NAI_API_URL}/user/login`,
    { key: accessKey },
    { headers: { 'Content-Type': 'application/json' } }
  );

  session = {
    accessToken: response.data.accessToken,
    expiresAt: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000), // 29일
  };

  return session.accessToken;
};

export const generateImage = async (
  prompt: string,
  negativePrompt: string = 'lowres, bad anatomy, bad hands, text, error',
  options: {
    width?: number;
    height?: number;
    steps?: number;
    scale?: number;
  } = {}
): Promise<Buffer> => {
  const token = await login();

  const { width = 1024, height = 1024, steps = 28, scale = 11 } = options;

  const response = await axios.post(
    `${process.env.NAI_API_URL}/ai/generate-image`,
    {
      input: `masterpiece, best quality, ${prompt}`,
      model: 'nai-diffusion-4-5-full',
      parameters: {
        width,
        height,
        steps,
        scale,
        sampler: 'k_euler_ancestral',
        n_samples: 1,
        ucPreset: 0,
        uc: negativePrompt,
        seed: Math.floor(Math.random() * 2147483647),
      },
    },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      responseType: 'arraybuffer',
    }
  );

  // SSE 응답에서 이미지 추출
  const data = response.data.toString();
  const match = data.match(/data:(.+)/);
  if (!match) throw new Error('Failed to parse image response');

  return Buffer.from(match[1], 'base64');
};
```

### 3. X (Twitter) 발행 서비스

```typescript
// src/services/x-post.service.ts
import { TwitterApi } from 'twitter-api-v2';

export const createXClient = (accessToken: string, accessSecret: string) => {
  return new TwitterApi({
    appKey: process.env.X_CLIENT_ID!,
    appSecret: process.env.X_CLIENT_SECRET!,
    accessToken,
    accessSecret,
  });
};

export const postTweet = async (
  client: TwitterApi,
  text: string,
  mediaIds?: string[]
): Promise<{ id: string; url: string }> => {
  const tweet = await client.v2.tweet({
    text,
    media: mediaIds ? { media_ids: mediaIds } : undefined,
  });

  return {
    id: tweet.data.id,
    url: `https://x.com/i/status/${tweet.data.id}`,
  };
};

export const uploadMedia = async (
  client: TwitterApi,
  imageBuffer: Buffer,
  mimeType: string = 'image/png'
): Promise<string> => {
  const mediaId = await client.v1.uploadMedia(imageBuffer, {
    mimeType,
  });
  return mediaId;
};

export const postWithImage = async (
  client: TwitterApi,
  text: string,
  imageBuffer: Buffer
): Promise<{ id: string; url: string }> => {
  const mediaId = await uploadMedia(client, imageBuffer);
  return postTweet(client, text, [mediaId]);
};
```

---

## API Routes

### POST /api/generate/text
xAI로 트윗 텍스트 생성

```typescript
// Request
{
  "keyword": "AI 기술 트렌드",
  "style": "professional"
}

// Response
{
  "text": "2025년 AI 트렌드는 멀티모달이 대세! 텍스트, 이미지, 음성을 자유자재로 다루는 시대가 왔습니다. #AI #테크트렌드 #인공지능"
}
```

### POST /api/generate/image
NovelAI로 이미지 생성

```typescript
// Request
{
  "prompt": "futuristic cityscape, neon lights, cyberpunk",
  "negative_prompt": "lowres, blurry",
  "width": 1024,
  "height": 1024
}

// Response
{
  "image_url": "/api/images/temp_abc123.png",
  "seed": 12345678
}
```

### POST /api/posts
트윗 발행 (즉시 또는 예약)

```typescript
// Request
{
  "text": "오늘의 AI 아트 #AIArt #NovelAI",
  "image_prompt": "anime girl, cherry blossom",
  "scheduled_at": "2025-01-29T10:00:00Z"  // optional
}

// Response
{
  "id": "post_123",
  "status": "scheduled",
  "scheduled_at": "2025-01-29T10:00:00Z"
}
```

### POST /api/schedules
스케줄 생성 (여러 포스트 일괄 예약)

```typescript
// Request
{
  "keywords": ["AI 뉴스", "테크 트렌드", "개발 팁"],
  "schedule_mode": "2",  // 하루 2개
  "start_date": "2025-01-29",
  "generate_images": true,
  "image_style": "anime"
}

// Response
{
  "schedule_id": "sched_456",
  "total_posts": 3,
  "posts": [
    { "keyword": "AI 뉴스", "scheduled_at": "2025-01-29T10:00:00Z" },
    { "keyword": "테크 트렌드", "scheduled_at": "2025-01-29T18:00:00Z" },
    { "keyword": "개발 팁", "scheduled_at": "2025-01-30T10:00:00Z" }
  ]
}
```

---

## MongoDB 스키마

### Post Schema
```typescript
const PostSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 280 },
  keyword: String,
  imageUrl: String,
  imagePrompt: String,
  xPostId: String,
  xPostUrl: String,
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'publishing', 'published', 'failed'],
    default: 'draft'
  },
  scheduledAt: Date,
  publishedAt: Date,
  error: String,
}, { timestamps: true });
```

### Schedule Schema
```typescript
const ScheduleSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: String,
  keywords: [String],
  scheduleMode: { type: String, enum: ['1', '2', '3', '2121'], default: '2' },
  startDate: Date,
  generateImages: { type: Boolean, default: true },
  imageStyle: String,
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  totalPosts: Number,
  completedPosts: { type: Number, default: 0 },
  failedPosts: { type: Number, default: 0 },
}, { timestamps: true });
```

---

## BullMQ 워커

### Generate Worker
```typescript
// src/queues/generate.worker.ts
export const processGenerate = async (job: Job) => {
  const { postId, keyword, generateImage, imagePrompt } = job.data;

  // 1. xAI로 텍스트 생성
  const text = await generateXPost(keyword);

  // 2. NovelAI로 이미지 생성 (옵션)
  let imageBuffer: Buffer | undefined;
  if (generateImage) {
    imageBuffer = await generateImage(imagePrompt || keyword);
  }

  // 3. DB 업데이트 및 Publish 큐에 추가
  await PostModel.findByIdAndUpdate(postId, {
    text,
    imageUrl: imageBuffer ? `/temp/${postId}.png` : undefined,
    status: 'scheduled'
  });

  // 4. Publish 큐에 추가
  await publishQueue.add('publish', { postId }, {
    delay: calculateDelay(job.data.scheduledAt)
  });
};
```

### Publish Worker
```typescript
// src/queues/publish.worker.ts
export const processPublish = async (job: Job) => {
  const { postId } = job.data;
  const post = await PostModel.findById(postId).populate('userId');

  // 1. X 클라이언트 생성
  const client = createXClient(
    post.userId.xAccessToken,
    post.userId.xAccessSecret
  );

  // 2. 트윗 발행
  let result;
  if (post.imageUrl) {
    const imageBuffer = await fs.readFile(post.imageUrl);
    result = await postWithImage(client, post.text, imageBuffer);
  } else {
    result = await postTweet(client, post.text);
  }

  // 3. DB 업데이트
  await PostModel.findByIdAndUpdate(postId, {
    xPostId: result.id,
    xPostUrl: result.url,
    status: 'published',
    publishedAt: new Date()
  });
};
```

---

## NextAuth.js 설정 (X OAuth 2.0)

```typescript
// src/lib/auth.ts
import NextAuth from 'next-auth';
import TwitterProvider from 'next-auth/providers/twitter';

export const authOptions = {
  providers: [
    TwitterProvider({
      clientId: process.env.X_CLIENT_ID!,
      clientSecret: process.env.X_CLIENT_SECRET!,
      version: '2.0',
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      return session;
    },
  },
};
```

---

## UI 컴포넌트 예시

### PostForm.tsx
```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';

const postSchema = z.object({
  keyword: z.string().min(1, '키워드를 입력하세요'),
  generateImage: z.boolean().default(true),
  imagePrompt: z.string().optional(),
  scheduledAt: z.string().optional(),
});

type PostFormData = z.infer<typeof postSchema>;

export const PostForm = () => {
  const { register, handleSubmit, formState: { errors } } = useForm<PostFormData>({
    resolver: zodResolver(postSchema),
  });

  const createPost = useMutation({
    mutationFn: (data: PostFormData) =>
      fetch('/api/posts', {
        method: 'POST',
        body: JSON.stringify(data),
      }).then(res => res.json()),
  });

  return (
    <form onSubmit={handleSubmit(data => createPost.mutate(data))}>
      <input {...register('keyword')} placeholder="키워드 입력" />
      {errors.keyword && <span>{errors.keyword.message}</span>}

      <label>
        <input type="checkbox" {...register('generateImage')} />
        이미지 생성
      </label>

      <input {...register('imagePrompt')} placeholder="이미지 프롬프트 (선택)" />

      <input type="datetime-local" {...register('scheduledAt')} />

      <button type="submit" disabled={createPost.isPending}>
        {createPost.isPending ? '생성 중...' : '포스트 생성'}
      </button>
    </form>
  );
};
```

---

## 구현 순서

### Phase 1: 기본 설정
1. Next.js 프로젝트 생성 및 의존성 설치
2. MongoDB, Redis 연결 설정
3. NextAuth.js X OAuth 2.0 설정
4. 기본 UI 레이아웃 구성

### Phase 2: 생성 서비스
5. xAI 텍스트 생성 서비스 구현
6. NovelAI 이미지 생성 서비스 구현
7. 생성 API 라우트 구현
8. 생성 UI 컴포넌트 구현

### Phase 3: 발행 시스템
9. X 트윗 발행 서비스 구현
10. BullMQ 워커 구현 (Generate, Publish)
11. 스케줄링 로직 구현
12. 큐 대시보드 구현

### Phase 4: 대시보드
13. 포스트 목록/상세 페이지
14. 스케줄 관리 페이지
15. 설정 페이지
16. 에러 처리 및 재시도 로직

---

## 필요 패키지

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "next-auth": "^4.24.0",
    "mongoose": "^8.0.0",
    "ioredis": "^5.3.0",
    "bullmq": "^5.0.0",
    "twitter-api-v2": "^1.15.0",
    "axios": "^1.6.0",
    "@tanstack/react-query": "^5.0.0",
    "react-hook-form": "^7.48.0",
    "@hookform/resolvers": "^3.3.0",
    "zod": "^3.22.0",
    "jotai": "^2.5.0",
    "tailwindcss": "^3.3.0",
    "date-fns": "^2.30.0",
    "pino": "^8.16.0"
  }
}
```

---

## API 키 발급 가이드

### X (Twitter) API
1. https://developer.twitter.com 접속
2. Developer Portal에서 프로젝트 생성
3. OAuth 2.0 설정 (User authentication settings)
4. Client ID, Client Secret 발급
5. Callback URL 설정: `http://localhost:3000/api/auth/callback/twitter`

### xAI (Grok) API
1. https://console.x.ai 접속
2. API Key 생성
3. 모델: `grok-beta` 사용

### NovelAI API
1. https://novelai.net 구독 (Tablet 이상 권장)
2. 계정 정보 (username, password) 준비
3. API 사용 시 자동 로그인 처리

---

## 주의사항

1. **X API Rate Limit**: 트윗 발행 시 rate limit 준수 (15분당 50개)
2. **NovelAI Anlas**: 이미지 생성 비용 관리 (Opus 무료 조건 활용)
3. **토큰 갱신**: X OAuth 토큰 자동 갱신 로직 필요
4. **에러 핸들링**: API 실패 시 재시도 로직 구현
5. **이미지 저장**: 임시 이미지 정리 스케줄러 필요
