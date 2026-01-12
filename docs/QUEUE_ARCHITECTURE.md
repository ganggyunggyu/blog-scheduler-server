# Queue Architecture

## Overview

이 프로젝트는 **계정별 동적 큐 격리** 방식을 사용한다. 각 계정(accountId)마다 독립적인 큐와 워커가 생성되어, 계정 간 작업이 서로 영향을 주지 않는다.

## 핵심 구조

```
┌─────────────────────────────────────────────────────────────┐
│                        Redis                                │
├─────────────────────────────────────────────────────────────┤
│  bull:generate_accountA:*    bull:publish_accountA:*        │
│  bull:generate_accountB:*    bull:publish_accountB:*        │
│  bull:generate_accountC:*    bull:publish_accountC:*        │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
   │  Account A  │     │  Account B  │     │  Account C  │
   ├─────────────┤     ├─────────────┤     ├─────────────┤
   │ Generate Q  │     │ Generate Q  │     │ Generate Q  │
   │ Generate W  │     │ Generate W  │     │ Generate W  │
   │ Publish Q   │     │ Publish Q   │     │ Publish Q   │
   │ Publish W   │     │ Publish W   │     │ Publish W   │
   └─────────────┘     └─────────────┘     └─────────────┘
```

## 큐 종류

| 큐 타입                | 역할                    | 처리 워커         |
| ---------------------- | ----------------------- | ----------------- |
| `generate_{accountId}` | 블로그 글 생성 요청     | `processGenerate` |
| `publish_{accountId}`  | 네이버 블로그 발행 요청 | `processPublish`  |

## 동작 방식

### 1. 큐 생성 (Lazy Initialization)

```typescript
// 첫 스케줄 등록 시 큐가 자동 생성됨
const queue = getGenerateQueue(accountId);
```

- 큐가 없으면 새로 생성
- 큐 생성 시 워커도 자동으로 함께 생성
- Map에 캐싱하여 중복 생성 방지

### 2. 큐 이름 생성 규칙

```typescript
const getQueueName = (
  type: 'generate' | 'publish',
  accountId: string
): string => {
  const safeAccountId = accountId.replace(/[^a-zA-Z0-9]/g, '_');
  return `${type}_${safeAccountId}`;
};
```

- 특수문자는 `_`로 치환
- 예: `generate_507f1f77bcf86cd799439011`

### 3. Concurrency 설정

```typescript
const worker = new Worker(queueName, processor, {
  connection,
  concurrency: 1, // 계정당 동시 처리 1개
});
```

**왜 concurrency: 1인가?**

- 네이버 블로그 API 제한 회피
- 브라우저 세션 충돌 방지
- 순차적 발행으로 안정성 확보

## 파일 구조

```
src/queues/
├── index.ts           # 외부 export
├── queue-manager.ts   # 핵심 큐 관리 로직
├── constants.ts       # 기본 job 옵션
├── generate.worker.ts # 글 생성 워커
└── publish.worker.ts  # 발행 워커
```

## 주요 함수

### `getGenerateQueue(accountId)`

계정의 Generate 큐 반환 (없으면 생성)

### `getPublishQueue(accountId)`

계정의 Publish 큐 반환 (없으면 생성)

### `closeAllQueues()`

모든 워커와 큐를 정리 (graceful shutdown 시 호출)

### `getActiveAccounts()`

현재 메모리에 로드된 계정 목록 반환

### `removeJobFromQueue(accountId, jobId, type)`

특정 작업을 큐에서 제거

## Job 흐름

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Schedule │────▶│ Generate │────▶│ Publish  │
│   API    │     │   Queue  │     │   Queue  │
└──────────┘     └──────────┘     └──────────┘
                       │                │
                       ▼                ▼
                 ┌──────────┐     ┌──────────┐
                 │  Gemini  │     │  Naver   │
                 │   API    │     │   Blog   │
                 └──────────┘     └──────────┘
```

1. Schedule API로 스케줄 등록
2. Generate Queue에 지연 작업 추가 (scheduledAt 기준)
3. Generate Worker가 Gemini API로 글 생성
4. 생성 완료 후 Publish Queue에 작업 추가
5. Publish Worker가 Playwright로 네이버 블로그 발행

## Redis 키 구조

```
bull:{queueName}:waiting   # 대기 중인 작업 (List)
bull:{queueName}:active    # 처리 중인 작업 (List)
bull:{queueName}:delayed   # 지연된 작업 (Sorted Set)
bull:{queueName}:completed # 완료된 작업 (Sorted Set)
bull:{queueName}:failed    # 실패한 작업 (Sorted Set)
bull:{queueName}:meta      # 큐 메타데이터 (Hash)
bull:{queueName}:{jobId}   # 개별 작업 데이터 (Hash)
```

## 모니터링

### Redis CLI로 상태 확인

```bash
# 대기 중인 작업 수
redis-cli llen "bull:generate_{accountId}:waiting"

# 완료된 작업 수
redis-cli zcard "bull:generate_{accountId}:completed"

# 실패한 작업 수
redis-cli zcard "bull:generate_{accountId}:failed"

# 모든 큐 키 조회
redis-cli keys "bull:*"
```

### API 엔드포인트

```
GET /queues/stats
```

```json
{
  "activeAccounts": 3,
  "accounts": ["507f1f***", "ganggy***", "mixxut***"]
}
```

## 장점

1. **계정 격리**: 한 계정의 문제가 다른 계정에 영향 없음
2. **동적 확장**: 계정이 늘어나도 자동으로 큐 생성
3. **순차 처리**: 계정별 concurrency: 1로 안정적 발행
4. **메모리 효율**: 필요한 계정만 큐 로드

## 제한사항

- 서버 재시작 시 메모리의 Map은 초기화됨 (Redis의 작업은 유지)
- Bull Board UI 미적용 (추후 추가 가능)
