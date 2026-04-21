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
## Task Gate
- 코드 변경 작업은 테스트 시나리오나 실패 조건부터 먼저 정의하고, 가능하면 테스트 코드 수정/추가를 선행함.
- 구현 후에는 완료 보고 전에 정적 검증과 테스트를 반드시 돌림.
- 현재 레포에는 별도 ESLint 가 없지만, `node scripts/run-lint-gate.mjs` 로 repo-native lint gate 를 강제함.
- lint gate 는 기본적으로 `src/**/*.ts`, `test/unit/**/*.ts` 범위에서 `explicit any`, `@ts-ignore`, `@ts-expect-error`, `var`, named `function` 선언, 로거 외 `console.*` 사용을 막음.
- 기본 종료 게이트는 `node scripts/run-quality-gate.mjs` 이고, 내부적으로 `node scripts/run-lint-gate.mjs` 후 `pnpm typecheck`, `pnpm test` 를 순서대로 실행함.
- 요구사항이 단순 unit 통과만으로 끝나지 않으면 라우트 호출, 재현 스크립트, 실제 UI 확인 중 하나로 원하는 결과까지 확인함.
- 작업 마감 전에는 `git status` 로 변경 범위를 확인하고, 현재 작업 파일만 기준으로 커밋 가능한 상태인지 점검함.
- 검증이 모두 끝난 뒤에는 사용자가 커밋 금지를 말하지 않은 이상 focused commit 을 기본으로 함.
- 테스트나 검증을 못 돌린 경우에는 이유, 미검증 범위, 원하는 결과를 아직 확인하지 못한 지점을 명확히 남기고 완료로 단정하지 않음.
- 로컬 강제선은 `.githooks/pre-push` 이고, `node scripts/install-git-hooks.mjs` 또는 `git config --local core.hooksPath .githooks` 로 연결함.
- 원격 강제선은 `.github/workflows/quality-gate.yml` 이고, push/PR 에서 동일한 `node scripts/run-quality-gate.mjs` 를 실행함.
## Critical Rules
- 비즈니스 시간 계산에 `toISOString()` 쓰지 않음. KST offset 문자열 유지함.
- 비밀번호를 MongoDB/log 에 저장하거나 출력하지 않음. BullMQ job payload 에만 둠.
- BullMQ `delay` 를 `scheduledAt` 정렬용으로 쓰지 않음. 게시 간 throttling 에만 씀.
- 생성/게시 로직은 즉시 실행하고, 예약 시각은 Naver UI 에 입력함.
- `as any`, `@ts-ignore`, `@ts-expect-error` 금지함.
## Schedule Workflow Rules
- 계정 source of truth 는 MongoDB `cafe-bot.accounts` 임.
- **MongoDB 접속은 반드시 Atlas 로 함.** 로컬 `mongodb://localhost:27017` 조회 금지. 접속 URI 는 `.env` 의 `MONGO_URI` (`mongodb+srv://...@cluster0.stdrfdm.mongodb.net/...`) 를 그대로 사용함. 로컬에는 최신 계정/카테고리가 없어서 매칭이 전부 실패함.
- mongosh 호출 예: `mongosh --quiet "$(grep ^MONGO_URI= .env | cut -d= -f2-)" --eval 'use("cafe-bot"); ...'`
- 애견 카테고리의 DB 값은 `서리펫` 또는 `도그마루 글밥` 임 (payload 상 `keyword_category: "애견"` 과 다름).
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
