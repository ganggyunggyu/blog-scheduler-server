# scheduler-server — Agent Guide
- Naver Blog 예약발행 자동화 서버임.
- Fastify API → BullMQ(generate/publish) → Playwright(Naver Editor) 흐름임.
- 원고 생성은 외부 Python 서버 `blog_analyzer` 에 위임함.
## Start Here
- 루트 규칙은 이 파일이 기준임.
- 더 안쪽의 `AGENTS.md` 가 있으면 그 규칙이 우선함.
- 스케쥴 운영 절차의 source of truth 는 `.claude/commands/*.md` 임.
- 스케쥴 상세를 이 파일에 중복 기록하지 말고 해당 command 문서를 읽음.
## Important Paths
- `src/server.ts`: entry, graceful shutdown
- `src/app.ts`: Fastify app, BullBoard, route registration
- `src/routes/`: API endpoints
- `src/services/`: business logic
- `src/queues/`: BullMQ queues/workers
- `src/lib/naver-editor/`: Playwright editor automation
- `src/schemas/`: Mongoose schedule models
- `test/`: `node:test` 기반 unit/integration/e2e
## Project Conventions
- ESM only. 모든 import 에 `.js` 확장자 사용함.
- 화살표 함수만 사용함. 클래스/DI container 쓰지 않음.
- 서비스는 functional style 유지함.
- 로거는 `logger.child({ scope: '...' })` 패턴 사용함.
- barrel export 는 기존 위치에서만 유지함.
- 테스트는 `node:test` + `tsx` 사용함. Jest/Vitest 추가하지 않음.
## Critical Rules
- 비즈니스 시간 계산에 `toISOString()` 쓰지 않음. KST offset 문자열 유지함.
- 비밀번호를 MongoDB/log 에 저장하거나 출력하지 않음. BullMQ job payload 에만 둠.
- BullMQ `delay` 를 `scheduledAt` 정렬용으로 쓰지 않음. 게시 간 throttling 에만 씀.
- 생성/게시 로직은 즉시 실행하고, 예약 시각은 Naver UI 에 입력함.
- `as any`, `@ts-ignore`, `@ts-expect-error` 금지함.
## Schedule Workflow Rules
- 계정 source of truth 는 MongoDB `cafe-bot.accounts` 임.
- 입력 계정은 `nickname` 우선, 없으면 `accountId`/`blogId` 로 매칭함.
- 스케쥴 생성은 `POST /bot/auto-schedule` 흐름을 우선 사용함.
- 도메인별 설정은 `.claude/commands/schedule-*.md` 를 그대로 따름.
- 완료 보고는 내부 상태만으로 확정하지 않음. 네이버 UI 실확인 후에만 `완료` 라고 말함.
## Failure Handling
- 로그인 실패는 `계정 잠금`, `비밀번호 오류`, `캡차 필요`, `존재하지 않는 계정` 같은 비재시도성인지 먼저 구분함.
- 일시적 네트워크/UI 문제와 영구 계정 문제를 같은 버킷으로 다루지 않음.
- 계정 전체 fail/drain 은 명백한 비재시도성 로그인 실패일 때만 해야 함.
- 로그인 실패 시 `data/login-failures/` 아티팩트를 우선 확인함.
## External Dependencies
- `MONGO_URI`: schedule + account source of truth
- `REDIS_HOST/REDIS_PORT`: BullMQ + session cache
- `MANUSCRIPT_API_URL`: 원고 생성 서버
- `IMAGE_API_URL`: 이미지 API (`product-images`, `ai-images` 등)
## Commands
- `pnpm dev`: dev server
- `pnpm build`: build
- `pnpm test`: unit tests
- `pnpm typecheck`: type validation
