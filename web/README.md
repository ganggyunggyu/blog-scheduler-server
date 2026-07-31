# scheduler-web

발행 스케줄러 운영 UI. 큐 현황 모니터링, 스케줄 조회/취소, 새 예약 등록을 한 화면에서 처리한다.

## 실행

```bash
cd web
CI=true pnpm install --ignore-workspace   # 루트 pnpm workspace 와 섞이지 않게 분리 설치
pnpm dev                                  # http://localhost:5180
```

`pnpm dev` 는 `/api`, `/schedules`, `/bot`, `/queues` 를 `localhost:8001` 로 프록시한다.
스케줄러 서버 포트가 다르면 `vite.config.ts` 의 proxy target 을 고친다.

## 인증

서버에 `WEB_AUTH_SECRET` 이 설정되어 있을 때만 로그인이 동작한다.

```bash
# scheduler-server/.env
WEB_AUTH_SECRET=아무거나_긴_랜덤_문자열
WEB_USERS=[{"username":"ggg","password":"...","label":"강경규","role":"admin"}]
```

`WEB_AUTH_SECRET` 이 없으면 서버는 인증을 요구하지 않는다. 기존 curl 기반 스킬 흐름이 그대로 돌아가도록 한 것이고,
공개 URL 로 열 때는 반드시 설정해야 한다.

## 배포

- 이 프론트만 Vercel 에 올린다. `vercel.json` 에 SPA rewrite 가 들어 있다.
- 스케줄러 서버는 Playwright 가 로컬 크로미움을 띄워야 해서 같이 못 올린다. 자체 머신에서 상시 구동하고
  터널(Cloudflare Tunnel 등)로 공개 URL 을 준 뒤, Vercel 환경변수 `VITE_API_URL` 에 그 주소를 넣는다.
- 공개 URL 을 여는 순간 `WEB_AUTH_SECRET` 은 필수다.

## 구조

FSD. `shared` → `entities` → `features` → `widgets` → `pages` 방향으로만 import 한다.

```
src/
  app/       axios 인스턴스, 라우터, 전역 스타일
  entities/  auth / queue / schedule (api, hooks, model, stores)
  features/  queue-board, schedule-form
  widgets/   app-shell
  pages/     login, dashboard, schedule-list, schedule-new
  shared/    ui, lib
```
