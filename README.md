# blog-scheduler-server

네이버 블로그에 원고를 예약/자동 발행하는 백엔드 서버. Fastify API + BullMQ 큐 + Playwright(네이버 에디터 자동 조작)로 구성되어 있고, 브랜드(pet/eye/alibaba/goat 등)별로 원고 생성부터 이미지 삽입, 예약 발행, 발행 후 검증까지 처리한다.

## 개요

### 기능

- 브랜드/키워드별 원고 생성 작업을 큐에 등록하고 예약 시간에 맞춰 발행 (`src/queues/generate.worker.ts`)
- Playwright로 네이버 스마트에디터를 직접 조작해 본문 작성, 이미지 삽입, 스타일(흰 글자 강조 등) 적용
- 계정별 로그인 세션 관리 및 로그인 실패 원인 분석 (`src/services/login-failure.service.ts`)
- Bull Board로 큐 상태 모니터링
- `scripts/`, `work/` 아래 다수의 운영 스크립트 — 발행 상태 검증, 누락 발행 복구, 스케줄 재배치 등

### 기술 스택

- Fastify 5, BullMQ + ioredis
- Playwright (`rebrowser-playwright`로 탐지 우회)
- MongoDB (Mongoose)
- Google Gemini(`@google/genai`) — 원고/키워드 생성
- TypeScript(ESM), Vitest 대신 Node 내장 테스트 러너(`tsx --test`)

### 설치 및 실행

```bash
pnpm install
cp .env.example .env
pnpm dev          # tsx watch src/server.ts
```

```bash
pnpm build && pnpm start   # 프로덕션
pnpm test                  # 유닛 테스트
pnpm typecheck
```

## 트러블슈팅

1. **같은 네이버 계정으로 여러 발행 작업이 겹치면 브라우저 세션/로그인 상태가 꼬임** — 계정 하나가 동시에 여러 큐 작업에서 쓰이면 세션 정리 타이밍이 겹쳐서 레이스 컨디션이 났다.
2. **알리바바 상품 이미지가 준비 안 됐는데도 발행이 그냥 진행돼서 이미지 없는 글이 올라감.**
3. **네이버 에디터의 흰색 글자(강조 텍스트) 스타일 적용이 갑자기 안 먹힘.**
4. **로그인 실패나 스케줄 중복 실행으로 같은 글이 여러 번 발행될 위험이 있었음.**

## 원인분석

1. `account-execution.ts`의 계정별 실행 코디네이터가 "정리 중(cleanup)" 상태와 "사용 중(active)" 상태를 구분하지 못하고, `releaseAccountTurnIfIdle`가 매번 새 Promise를 만들어 중복 실행될 여지가 있었다. 대기 중인 작업이 있는데도 계정을 유휴 상태로 잘못 판단해 정리 루틴이 먼저 끝나버리는 경우가 있었다.
2. 이미지 업로드가 실패해도 `typeContentWithImages`가 예외를 던지지 않고 그냥 다음 단계로 넘어갔고, `generate.worker.ts`도 알리바바 원고 타입에 대해 이미지 존재 여부를 별도로 검증하지 않았다.
3. 네이버 스마트에디터가 툴바 마크업을 바꾸면서 기존에 쓰던 흰 글자 버튼 셀렉터가 더 이상 매칭되지 않았다.
4. 로그인 재시도 로직과 스케줄 발행 로직이 각각 독립적으로 동작해서, 로그인 실패 후 재시도되는 과정에서 같은 스케줄이 중복 큐잉될 수 있었다.

## 해결

1. `waitForAccountTurn`이 `activeAccountIds`와 `cleanupPromises` 두 상태를 모두 확인하면서 대기하도록 바꾸고, `releaseAccountTurnIfIdle`에서 `activeAccountIds.delete`를 먼저 호출한 뒤 다음 대기자가 있으면 정리 없이 바로 넘겨주도록 재작성했다(`src/queues/account-execution.ts`, 커밋 `4c325e6`). 이전에 있던 `releasePromises` 캐시는 제거하고 상태 체크만으로 중복 실행을 막도록 단순화했다.
2. `typeContentWithImages`에 `requireAllImages` 옵션을 추가해 이미지 업로드 실패 시 예외를 던지도록 했고, `generate.worker.ts`에서 원고 타입이 `alibaba`일 때 `hasPreparedProductImages`로 이미지 존재를 먼저 검증해서 없으면 발행 자체를 막도록 했다(커밋 `05fed7e`).
3. `src/lib/naver-editor/editor.ts`의 흰 글자 툴바 셀렉터를 새 마크업 기준으로 갱신하고, 버튼을 못 찾는 경우를 대비한 폴백 경로를 추가했다(커밋 `522414b`).
4. `b080bd6`에서 로그인 재시도와 스케줄 처리 사이에 하네스 세이프가드를 추가해, 로그인 실패 판정(`login-failure.service.ts`)과 스케줄 중복 방지(`schedule-idempotency.service.ts`의 잡 ID 기반 dedupe)를 분리해서 서로 간섭하지 않도록 정리했다.
