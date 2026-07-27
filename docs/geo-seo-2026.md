# GEO / SEO 2026 조사 정리 (2026-07 기준)

자동발행 콘텐츠를 구글 + 생성형 검색(AI Overviews, ChatGPT Search, Perplexity)에 노출시키기 위한
근거 정리임. 실행 코드는 `src/services/geo-optimizer.service.ts`, `src/services/article-format.service.ts` 임.

## 1. 결론 먼저

- 구글 공식 입장(2026-05-15 "생성형 AI 검색 최적화 가이드")은 **"GEO는 별개 분야가 아니다. 결국 SEO다"** 임.
  구조화 데이터 필수 아님, 청킹하지 말 것, llms.txt 만들 필요 없음(구글은 무시함)이라고 명시함.
- 반면 ChatGPT/Perplexity 같은 **RAG 기반 LLM** 은 문서를 청크로 잘라 임베딩하므로 청킹/자기완결 문단이 유효함.
  → 구글 대상이면 구글 가이드를, 오픈 LLM 대상이면 GEO 논문 기법을 따름.
- 즉 **하나의 원고로 두 마리를 다 잡으려면**: 사람이 읽기 좋은 글 + 문단 자기완결성 + 첫 문단 결론 선행.

## 2. 실측으로 확인된 인용 유발 요소

Princeton GEO 논문(KDD 2024)과 이후 업계 실측을 종합한 것임.
아래 배수는 SEO 툴 업체 자체 분석(CXL 100페이지 분석, Searchlab)이라 학술 검증치는 아님. 업계 관측치로 봄.

| 요소 | 효과 | 코드 반영 |
|---|---|---|
| 첫 문단에 정의/결론 선행 | 2.3배 인용 | `answerFirst` 신호 |
| FAQ/Q&A 구조 | 1.9배 인용 | `questionHeading` 신호 + `extractFaqPairs` |
| 통계·수치 인용 | 논문 기준 최대 40% 가시성 향상 | `statistics` 신호 |
| 1차 출처 표기 | 동일 | `citation` 신호 |
| 인용문(quote) 삽입 | 동일 | `quotation` 신호 |
| 12개월 내 갱신 | 1.6배 인용 | (운영 규칙) |
| 텍스트+이미지 혼합 | 1.4배 인용 | 기존 이미지 파이프라인이 이미 충족 |

주의할 관측치: **1,000단어 미만 페이지가 AI Overviews 인용의 53.4%** 를 차지하고 2,000단어 초과는 16% 뿐임.
"길게 쓸수록 유리"는 최소한 AI 인용 관점에서는 사실이 아님. 또 인용의 55% 가 페이지 상단 30% 구간에서 나옴.

## 3. AI 크롤러 대응

### llms.txt — 우선순위 낮음

2026-06 기준 상위 1,000 사이트 중 8.7% 만 채택했고, 실측 크롤 로그상 GPTBot/ClaudeBot/PerplexityBot 이
llms.txt 를 거의 읽지 않고 HTML 을 직접 크롤링함. 구글도 공식적으로 무시한다고 밝힘.
`buildLlmsTxt` 는 만들어 뒀지만 **핵심 작업을 밀어내면서까지 할 일은 아님**.

### robots.txt — 학습용/검색용 분리가 핵심

| 회사 | 학습용 | 검색·인용용 | 사용자 요청 즉시조회 |
|---|---|---|---|
| OpenAI | `GPTBot` | `OAI-SearchBot` | `ChatGPT-User` |
| Anthropic | `ClaudeBot` | `Claude-SearchBot` | `Claude-User` |
| Perplexity | — | `PerplexityBot` | `Perplexity-User` |
| Google | `Google-Extended` | Googlebot(AI Overviews 포함) | — |

노출을 원하면 **검색용은 허용하고 학습용만 선택 차단**하는 게 2026년 일반적인 전략임.
`Google-Extended` 차단은 구글 검색 노출/AI Overviews 등장에 영향 없음(구글 공식 확인).

### 구조화 데이터

구글이 **FAQPage 리치 리절트를 2026-05-07 폐지**했고 HowTo 는 2023년에 이미 폐지함.
마크업 자체가 무효가 된 건 아니고 "검색 화면에 안 보여준다"는 뜻이며 랭킹 영향도 없다고 공식 확인함.
→ FAQPage/HowTo 에 과잉투자하지 않음. 대신 **Article + Organization + Person** 을 유지함.

## 4. 색인 촉진

- **구글은 IndexNow 미채택**(2021년부터 테스트만 하고 도입 안 함). 사이트맵 + 내부링크 + 품질이 정공법임.
- **네이버 서치어드바이저는 2023-07-25 부터 IndexNow 지원함.** 다만 키 파일을 도메인 루트에 올려야 하므로
  `blog.naver.com` 같은 남의 도메인에는 못 씀. 자체 도메인 사이트를 가질 때 쓸 수 있는 카드임.
- **구글 Indexing API 는 `JobPosting` / `BroadcastEvent` 전용**임. 일반 블로그 글에 쓰면 스팸 리스크만 있음.
- URL 검사 API 는 색인 "확인"용이지 "촉진"용이 아님(하루 2,000쿼리 제한).

## 5. 발행 플랫폼 현실 점검

자동발행이 **실제로 가능한 곳** 만 추림. 티스토리/미디엄/브런치/다음카페/Velog 는 사실상 막혔음.

| 순위 | 플랫폼 | 방식 | 인증 | 구글 색인 기대치 |
|---|---|---|---|---|
| 1 | GitHub Pages | REST API/Actions 로 커밋 → 정적 빌드 | PAT / GitHub App | 높음(자체 도메인·사이트맵 완전 통제) |
| 2 | WordPress.com | REST API v2 `POST /wp/v2/.../posts` | Application Password / OAuth2 | 높음 |
| 3 | Blogger | Blogger API v3 `posts.insert` | OAuth2 | 중~높음 |
| 4 | 네이버 블로그 | `openapi.naver.com/blog/writePost.json` | 네아로 액세스 토큰 | 낮음(구글) / 매우 높음(네이버) |
| 5 | Dev.to | Forem API v1 `POST /api/articles` | `api-key` 헤더 | 중간 |
| 6 | 네이버 카페 | `openapi.naver.com/v1/cafe/.../articles` | 네아로 액세스 토큰 | 낮음 |
| 7 | Threads | Graph API 2단계(컨테이너 → 발행) | Meta OAuth + 앱 심사 | 낮음 |
| 8 | Hashnode | GraphQL `publishPost` | API 토큰, **2026-05-13 부터 Pro 유료 필수** | 중간 |

막힌 곳: 티스토리(Open API 2024-02 완전 종료), 미디엄(2023-03 deprecated),
브런치스토리(API 없음 + 작가 승인제), 다음 카페(2017년 폐지), Velog(비공식 GraphQL 뿐, ToS 리스크),
네이버 포스트(2025-04-30 서비스 종료).

**구글 노출이 목적이면 네이버 블로그만으로는 부족함.** 네이버는 구글 크롤링에 우호적이지 않고
개인 서브도메인이라 도메인 자산도 안 쌓임. 자체 도메인 + GitHub Pages 또는 WordPress 축이 필요함.

## 6. 코드에 반영된 것

- `analyzeGeoArticle` — 8개 신호로 0~100 채점 + 개선안 반환. 발행 전 게이트로 씀.
- `parseArticleBlocks` — 네이버형 HTML(div 줄바꿈 + 굵은 blockquote 소제목)을 소제목/인용/문단으로 분해함.
  blockquote 를 무조건 인용으로 세지 않고 굵기·번호 접두어로 소제목과 갈라냄.
- `extractFaqPairs` / `buildFaqJsonLd` — 질문형 소제목에서 Q&A 추출(구글 SERP 이득은 없지만 AI 파서용).
- `buildArticleJsonLd` — Article 스키마. KST offset 문자열 그대로 유지함.
- `toMarkdown` / `toSemanticHtml` — 원고 하나를 마크다운·시맨틱 HTML 로 변환해 다른 플랫폼에 재사용함.

## 출처

- [GEO: Generative Engine Optimization (Princeton, KDD 2024)](https://arxiv.org/abs/2311.09735)
- [구글 공식: 생성형 AI 검색 최적화 가이드](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [구글 공식: AI Features and Your Website](https://developers.google.com/search/docs/appearance/ai-features)
- [Google Drops FAQ Rich Results](https://www.searchenginejournal.com/google-drops-faq-rich-results-from-search/574429/)
- [Where Google AI Overviews Cite From: 100-Page Study (CXL)](https://cxl.com/blog/google-ai-overview-citation-sources/)
- [State of llms.txt 2026](https://presenc.ai/research/state-of-llms-txt-2026)
- [OpenAI 공식 크롤러 문서](https://developers.openai.com/api/docs/bots)
- [티스토리 Open API 종료 공지](https://notice.tistory.com/2664)
- [Medium API deprecated (공식 GitHub)](https://github.com/Medium/medium-api-docs)
- [Blogger API v3](https://developers.google.com/blogger/docs/3.0/using)
- [Forem(Dev.to) API v1](https://developers.forem.com/api/v1)
- [네이버 오픈 API 목록](https://naver.github.io/naver-openapi-guide/apilist.html)
- [구글 Indexing API 는 JobPosting/BroadcastEvent 전용](https://developers.google.com/search/apis/indexing-api)
- [네이버 서치어드바이저 IndexNow 지원](https://news.hada.io/topic?id=19225)
