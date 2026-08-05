# 네이버 에디터를 실제 브라우저로 조작하는 서버라 크로미움이 같이 들어가야 한다.
# 예전 node:20-alpine 이미지는 브라우저가 없어서 발행 단계에서 죽었고,
# alpine 은 musl 이라 Playwright 공식 지원 대상도 아니다.
# 브라우저와 폰트, 의존 라이브러리가 버전까지 맞춰져 있는 공식 이미지를 쓴다.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

ENV NODE_ENV=production \
    TZ=Asia/Seoul \
    PLAYWRIGHT_HEADLESS=true

COPY package.json pnpm-lock.yaml* ./
COPY tsconfig.json tsconfig.build.json ./

# 이미지에 딸려 온 corepack 은 서명키가 오래돼 pnpm 을 못 받아온다.
# npm 으로 직접 설치한다. 락파일이 9.0 이라 그걸 읽는 버전으로 고정한다.
RUN npm install -g pnpm@10.27.0

# 빌드에 devDependencies(typescript)가 필요해서 일단 전부 받는다.
RUN pnpm install --frozen-lockfile

# 베이스 이미지에 든 브라우저는 그 이미지 태그의 Playwright 버전에 맞춰져 있다.
# 여기 의존성은 rebrowser-playwright 를 ^ 로 잡아서 더 높은 버전이 깔리고,
# 그러면 이미지의 브라우저 경로와 어긋나 실행 파일을 못 찾는다.
# 실제로 깔린 버전이 요구하는 브라우저를 직접 받는다.
RUN pnpm exec playwright install chromium

COPY src ./src
RUN pnpm build

# 빌드가 끝나면 실행에 필요 없는 것들을 덜어낸다.
RUN pnpm prune --prod

# 한국어 원고를 다루므로 한글 폰트가 없으면 에디터 화면이 깨진다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-nanum fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 컨테이너 안에서는 PORT 환경변수로 받는다. 기본값은 앱과 맞춘다.
ENV PORT=8001
EXPOSE 8001

CMD ["node", "dist/server.js"]
