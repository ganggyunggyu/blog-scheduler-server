# Bot API 명세

**Base URL**: `/bot`

---

## 1. 자동화 (원고 생성 + 발행)

### POST /bot/auto

원고 생성부터 발행까지 전체 자동화

**Request Body**

```json
{
  "account": {
    "id": "user@naver.com",
    "password": "password123"
  },
  "keywords": ["키워드1", "키워드2", "키워드3"],
  "service": "default",
  "ref": "",
  "generate_images": true,
  "image_count": 5,
  "use_schedule": true,
  "schedule_date": "2025-01-07",
  "schedule_start_hour": 10,
  "schedule_interval_hours": 1,
  "delay_between_posts": 10
}
```

| 필드                    | 타입     | 필수 | 기본값    | 설명                       |
| ----------------------- | -------- | ---- | --------- | -------------------------- |
| account                 | object   | ✅   | -         | 네이버 계정 (id, password) |
| keywords                | string[] | ✅   | -         | 키워드 목록                |
| service                 | string   | ❌   | "default" | 서비스명                   |
| ref                     | string   | ❌   | ""        | 참조 원고                  |
| generate_images         | boolean  | ❌   | true      | 이미지 생성 여부           |
| image_count             | number   | ❌   | 5         | 키워드당 이미지 수         |
| use_schedule            | boolean  | ❌   | true      | 예약발행 사용              |
| schedule_date           | string   | ❌   | null      | 시작 날짜 (YYYY-MM-DD)     |
| schedule_start_hour     | number   | ❌   | 10        | 시작 시간 (0-23)           |
| schedule_interval_hours | number   | ❌   | 1         | 발행 간격 (시간)           |
| delay_between_posts     | number   | ❌   | 10        | 발행 간 딜레이 (초)        |

**Response**

```json
{
  "success": true,
  "queue_id": "queue_abc12345_0107",
  "account": "use***",
  "generated": 3,
  "published": 3,
  "failed": 0,
  "elapsed": 180.5,
  "results": [
    {
      "manuscript_id": "001_키워드1",
      "title": "키워드1 관련 글 제목",
      "success": true,
      "post_url": "https://blog.naver.com/..."
    }
  ]
}
```

---

### POST /bot/auto-schedule

배치 스케줄 발행 (여러 계정, 여러 키워드)

**Request Body**

```json
{
  "queues": [
    {
      "account": { "dabutAccountId": "66f0..." },
      "keywords": ["키워드1", "키워드2", "키워드3"]
    },
    {
      "account": { "id": "user2@naver.com", "password": "..." },
      "keywords": ["키워드4", "키워드5"]
    }
  ],
  "schedule_date": "2025-01-07",
  "schedule_mode": "2",
  "service": "default",
  "ref": "",
  "generate_images": true,
  "image_count": 5,
  "image_source": "ai",
  "manuscript_type": "default",
  "project_id": "66f1...",
  "keyword_category": "restaurant",
  "delay_between_posts": 10
}
```

**발행 시각 설정**

기본값은 서버가 알아서 잡는다. 다음 날부터는 6~10시 사이에서 시작해 120~180분
간격으로 흩뿌리고, 오늘 날짜면 다음 정시부터 60분 간격으로 붙인다.

시각을 직접 정하려면 아래 세 값을 같이 보낸다. 안 보내면 위 기본 동작 그대로다.

| 필드 | 범위 | 설명 |
|---|---|---|
| `start_hour` | 0-23 | 하루 첫 글 시각 |
| `interval_minutes` | 10-720 | 글 사이 간격(분) |
| `posts_per_day` | 1-10 | 하루 발행 수. `schedule_mode` 로 계산한 값을 덮어씀 |

```json
{
  "queues": [{ "account": { "dabutAccountId": "66f0..." }, "keywords": ["키워드1", "키워드2"] }],
  "schedule_date": "2025-01-07",
  "schedule_mode": "2",
  "posts_per_day": 4,
  "start_hour": 9,
  "interval_minutes": 90
}
```

`schedule_date` 가 오늘이면 첫 글은 `start_hour` 가 아니라 `지금 + LEAD_TIME_MINUTES`(기본 60분)
부터 시작한다. 과거 시각으로 예약이 걸리는 걸 막기 위한 것이고, 둘째 날부터는 `start_hour` 를 따른다.

하루의 마지막 인정 시각은 23:55 이다. 23:55 '이상'에 떨어지는 글은 그 날 나가지 않고 다음 날로
넘어간다(23:55 정각도 포함). 키워드가 사라지지는 않고 일정이 하루씩 늘어난다.

범위를 벗어난 값은 400 으로 돌려준다.

```json
{
  "success": false,
  "message": "요청 값이 올바르지 않습니다.",
  "fields": [{ "field": "start_hour", "message": "Number must be less than or equal to 23" }]
}
```

**Response**

```json
{
  "success": true,
  "totalJobs": 5,
  "schedules": [
    {
      "scheduleId": "66f2...",
      "account": "use***@naver.com",
      "reused": false,
      "totalJobs": 3,
      "jobs": [
        { "id": "66f3...", "keyword": "키워드1", "scheduledAt": "2025-01-07T09:00:00+09:00", "slot": 1 }
      ]
    }
  ]
}
```

요청이 이전과 완전히 같으면 새로 만들지 않고 기존 스케쥴을 그대로 돌려주며
`reused: true` 가 붙는다. 시각 설정만 바꿔도 다른 요청으로 친다.

---

## 2. 발행

### POST /bot/start

로그인 후 pending 원고 발행 (원고 생성 없이)

**Request Body**

```json
{
  "account": { "id": "user@naver.com", "password": "..." },
  "manuscript_ids": ["001", "002"],
  "use_schedule": true,
  "schedule_date": "2025-01-07",
  "schedule_start_hour": 10,
  "schedule_interval_hours": 1,
  "schedule_interval_minutes": 0,
  "delay_between_posts": 10
}
```

| 필드           | 타입     | 필수 | 설명                              |
| -------------- | -------- | ---- | --------------------------------- |
| account        | object   | ✅   | 네이버 계정                       |
| manuscript_ids | string[] | ❌   | 특정 원고만 (없으면 전체 pending) |

**Response**

```json
{
  "success": true,
  "queue_id": "queue_xyz_0107",
  "account": "use***",
  "total": 2,
  "success_count": 2,
  "failed_count": 0,
  "results": [...]
}
```

---

### POST /bot/publish

쿠키로 직접 발행 (로그인 없이, 쿠키 보유 시)

**Request Body**

```json
{
  "cookies": [...],
  "manuscript_ids": ["001", "002"],
  "use_schedule": false,
  "schedule_date": null,
  "schedule_start_hour": 10,
  "schedule_interval_hours": 1,
  "schedule_interval_minutes": 0,
  "delay_between_posts": 10
}
```

---

## 3. 업로드

### POST /bot/upload

ZIP 파일로 원고 업로드

**Request (multipart/form-data)**
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| file | File | ✅ | ZIP 파일 |
| batch_id | string | ❌ | 배치 ID (동시 요청 구분) |

**ZIP 구조**

```
upload.zip
├── 키워드1/
│   ├── 키워드1.txt   ← 첫 줄=제목, 나머지=본문
│   └── 1.png, 2.png  ← 이미지 (선택)
└── 키워드2/
    └── ...
```

**Response**

```json
{
  "success": true,
  "batch_id": "abc12345",
  "uploaded": [{ "original": "키워드1", "id": "abc12345_0001" }],
  "skipped": [],
  "message": "2개 폴더가 pending에 추가되었습니다."
}
```

---

### POST /bot/upload-schedule

ZIP 업로드 + 스케줄 발행 (한 번에)

**Request (multipart/form-data)**
| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| file | File | ✅ | - | ZIP 파일 |
| account_id | string | ✅ | - | 네이버 ID |
| password | string | ✅ | - | 네이버 비밀번호 |
| start_date | string | ✅ | - | 시작 날짜 |
| start_hour | number | ❌ | 10 | 시작 시간 |
| posts_per_day | number | ❌ | 3 | 하루 발행 수 |
| interval_hours | number | ❌ | 2 | 발행 간격 |
| delay_between_posts | number | ❌ | 10 | 발행 간 딜레이 |

**Response**

```json
{
  "success": true,
  "queue_id": "queue_xyz_0107",
  "batch_id": "abc12345",
  "account": "use***",
  "schedule": {
    "start_date": "2025-01-07",
    "start_hour": 10,
    "days": 4,
    "posts_per_day": 3,
    "interval_hours": 2
  },
  "summary": {
    "uploaded": 10,
    "published": 10,
    "failed": 0,
    "elapsed": 250.3
  },
  "daily_summary": {
    "1": { "success": 3, "failed": 0 },
    "2": { "success": 3, "failed": 0 }
  },
  "results": [...]
}
```

---

### GET /bot/batch-id

배치 ID 발급 (동시 요청 구분용)

**Response**

```json
{
  "batch_id": "abc12345"
}
```

---

## 4. 원고 관리

### POST /bot/prepare

원고 수동 저장

**Request Body**

```json
{
  "manuscript": {
    "title": "글 제목",
    "content": "글 본문...",
    "tags": ["태그1", "태그2"],
    "category": "카테고리명",
    "images": ["https://s3.../1.png"]
  }
}
```

**Response**

```json
{
  "success": true,
  "manuscript_id": "0001",
  "message": "원고가 저장되었습니다.",
  "images_dir": "manuscripts/pending/0001/images"
}
```

---

### GET /bot/queue?status=pending

원고 목록 조회

| 파라미터 | 기본값  | 옵션                       |
| -------- | ------- | -------------------------- |
| status   | pending | pending, completed, failed |

**Response**

```json
{
  "status": "pending",
  "count": 5,
  "manuscripts": [
    {
      "id": "0001",
      "title": "글 제목",
      "category": null,
      "images_count": 3,
      "created_at": "2025-01-07T10:00:00"
    }
  ]
}
```

---

### GET /bot/manuscript/{manuscript_id}

원고 상세 조회

**Response**

```json
{
  "id": "0001",
  "status": "pending",
  "data": {
    "title": "글 제목",
    "content": "글 본문...",
    "tags": [],
    "images": ["path/to/1.png"]
  },
  "images": ["path/to/1.png"]
}
```

---

### DELETE /bot/manuscript/{manuscript_id}

원고 삭제

---

### POST /bot/retry/{manuscript_id}

실패한 원고 재시도 (failed → pending 이동)

---

## 5. Pending 관리

### GET /bot/pending

pending 원고 목록

---

### DELETE /bot/pending/{manuscript_id}

pending 원고 삭제

---

### DELETE /bot/pending

pending 전체 삭제

---

## 6. 큐 관리

### GET /bot/queues

진행중인 큐 목록

**Response**

```json
{
  "count": 2,
  "queues": [
    {
      "queue_id": "queue_abc_0107",
      "created_at": "2025-01-07T10:00:00",
      "manuscript_count": 5,
      "status": "processing",
      "account_id": "use***",
      "schedule_date": "2025-01-07"
    }
  ]
}
```

---

### GET /bot/queue/{queue_id}

큐 상세 정보

---

### POST /bot/queue/create

큐 생성 (pending → queue 이동)

**Request Body**

```json
{
  "manuscript_ids": ["0001", "0002"],
  "account_id": "user@naver.com",
  "schedule_date": "2025-01-07"
}
```

---

### POST /bot/queue/create-all

전체 pending을 큐로 생성

---

### POST /bot/queue/start

큐 발행 시작

**Request Body**

```json
{
  "queue_id": "queue_abc_0107",
  "account": { "id": "user@naver.com", "password": "..." },
  "use_schedule": true,
  "schedule_date": "2025-01-07",
  "schedule_start_hour": 10,
  "schedule_interval_hours": 2,
  "schedule_interval_minutes": 0,
  "delay_between_posts": 60
}
```

---

### DELETE /bot/queue/{queue_id}

큐 삭제 (원고는 pending으로 복원)

---

## 7. 헬스체크

### GET /bot/health

**Response**

```json
{
  "status": "ok",
  "service": "bot-orchestrator",
  "queue": {
    "pending": 5,
    "completed": 20,
    "failed": 2
  }
}
```

---

## API 요약

### 자동화

| Method | Path               | 설명                           |
| ------ | ------------------ | ------------------------------ |
| POST   | /bot/auto          | 원고 생성 + 발행 (전체 자동화) |
| POST   | /bot/auto-schedule | 배치 스케줄 발행 (다중 계정)   |

### 발행

| Method | Path         | 설명          |
| ------ | ------------ | ------------- |
| POST   | /bot/start   | 로그인 + 발행 |
| POST   | /bot/publish | 쿠키로 발행   |

### 업로드

| Method | Path                 | 설명              |
| ------ | -------------------- | ----------------- |
| GET    | /bot/batch-id        | 배치 ID 발급      |
| POST   | /bot/upload          | ZIP 업로드        |
| POST   | /bot/upload-schedule | ZIP 업로드 + 발행 |

### 원고

| Method | Path                | 설명             |
| ------ | ------------------- | ---------------- |
| POST   | /bot/prepare        | 원고 저장        |
| GET    | /bot/queue          | 원고 목록        |
| GET    | /bot/manuscript/:id | 원고 상세        |
| DELETE | /bot/manuscript/:id | 원고 삭제        |
| POST   | /bot/retry/:id      | 실패 원고 재시도 |

### Pending

| Method | Path             | 설명              |
| ------ | ---------------- | ----------------- |
| GET    | /bot/pending     | pending 목록      |
| DELETE | /bot/pending/:id | pending 삭제      |
| DELETE | /bot/pending     | pending 전체 삭제 |

### 큐

| Method | Path                  | 설명              |
| ------ | --------------------- | ----------------- |
| GET    | /bot/queues           | 큐 목록           |
| GET    | /bot/queue/:id        | 큐 상세           |
| POST   | /bot/queue/create     | 큐 생성           |
| POST   | /bot/queue/create-all | 전체 pending → 큐 |
| POST   | /bot/queue/start      | 큐 발행 시작      |
| DELETE | /bot/queue/:id        | 큐 삭제           |

### 상태

| Method | Path        | 설명     |
| ------ | ----------- | -------- |
| GET    | /bot/health | 헬스체크 |
