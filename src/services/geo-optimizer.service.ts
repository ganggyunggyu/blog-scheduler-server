/**
 * GEO(Generative Engine Optimization) + 검색 노출 최적화 서비스.
 *
 * 생성형 검색엔진(AI Overviews, ChatGPT Search, Perplexity 등)이 본문을 인용하려면
 * "근거 있는 수치 / 출처 표기 / 인용 / 질문형 소제목 / 첫 문단 직답" 같은 신호가
 * 문서 안에 실제로 들어 있어야 함. 이 모듈은 발행 직전 원고를 그 기준으로 채점하고,
 * 구조화 데이터(JSON-LD)와 AI 크롤러용 llms.txt 를 만들어 줌.
 */

export interface GeoArticleInput {
  title: string;
  html: string;
  keyword: string;
  url?: string;
  authorName?: string;
  publisherName?: string;
  publishedAt?: string;
  imageUrls?: string[];
}

export interface GeoSignal {
  key: string;
  label: string;
  score: number;
  weight: number;
  passed: boolean;
  detail: string;
}

export interface GeoReport {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  signals: GeoSignal[];
  suggestions: string[];
}

export interface FaqPair {
  question: string;
  answer: string;
}

export interface LlmsTxtEntry {
  title: string;
  url: string;
  summary?: string;
}

export interface LlmsTxtInput {
  siteName: string;
  siteUrl: string;
  summary?: string;
  entries: LlmsTxtEntry[];
}

type BlockType = 'heading' | 'quote' | 'paragraph';

export interface ArticleBlock {
  type: BlockType;
  text: string;
}

const PASS_THRESHOLD = 0.6;
const HEADING_MAX_LENGTH = 60;
const PARAGRAPH_BREAK = '\n\n';

const CITATION_PATTERNS = [
  /에\s*따르면/,
  /출처/,
  /자료/,
  /조사\s*결과/,
  /발표/,
  /보고서/,
  /통계청/,
  /통계를\s*보면/,
  /논문/,
  /가이드라인/,
];

const QUESTION_TAIL = /(까요|나요|인가요|은가요|을까|일까|무엇|어떻게|왜|얼마)/;

const stripTags = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const matchAll = (html: string, pattern: RegExp): string[] =>
  [...html.matchAll(pattern)].map((m) => m[1] ?? m[0]);

/**
 * 네이버 발행용 HTML 은 h 태그를 쓰지 않고 `<blockquote>` + 굵은 `<div>` 로 소제목을 만듦.
 * blockquote 하나만 보고 "인용구"라고 단정하면 소제목을 인용으로 잘못 세게 되므로
 * 굵기/번호 접두어로 소제목과 진짜 인용을 갈라냄.
 */
const isHeadingBlockquote = (rawTag: string, text: string): boolean => {
  if (text.length > HEADING_MAX_LENGTH) return false;
  if (/font-weight:\s*(700|800|900|bold)/i.test(rawTag)) return true;
  return /^\d+[.)]\s/.test(text);
};

const splitLooseParagraphs = (chunk: string): string[] => {
  if (/<p[\s>]/i.test(chunk)) {
    return matchAll(chunk, /<p[^>]*>([\s\S]*?)<\/p>/gi)
      .map((raw) => stripTags(raw))
      .filter((text) => text.length > 0);
  }

  return chunk
    .replace(/<br\s*\/?>/gi, PARAGRAPH_BREAK)
    .replace(/<\/(div|li)>/gi, ' ')
    .split(PARAGRAPH_BREAK)
    .map((part) => stripTags(part))
    .filter((text) => text.length > 0);
};

export const parseArticleBlocks = (html: string): ArticleBlock[] => {
  const blockPattern = /<(h[1-6]|blockquote)[^>]*>[\s\S]*?<\/\1>/gi;
  const blocks: ArticleBlock[] = [];
  let cursor = 0;

  for (const match of html.matchAll(blockPattern)) {
    const index = match.index ?? 0;
    splitLooseParagraphs(html.slice(cursor, index)).forEach((text) =>
      blocks.push({ type: 'paragraph', text }),
    );

    const raw = match[0];
    const text = stripTags(raw);
    if (text.length > 0) {
      const isHeading = match[1].toLowerCase().startsWith('h') || isHeadingBlockquote(raw, text);
      blocks.push({ type: isHeading ? 'heading' : 'quote', text });
    }
    cursor = index + raw.length;
  }

  splitLooseParagraphs(html.slice(cursor)).forEach((text) =>
    blocks.push({ type: 'paragraph', text }),
  );

  return blocks;
};

const isQuestion = (text: string): boolean => text.includes('?') || QUESTION_TAIL.test(text);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const toSignal = (
  key: string,
  label: string,
  weight: number,
  score: number,
  detail: string,
): GeoSignal => ({
  key,
  label,
  weight,
  score: clamp01(score),
  passed: clamp01(score) >= PASS_THRESHOLD,
  detail,
});

const resolveGrade = (score: number): GeoReport['grade'] => {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
};

const SUGGESTION_BY_KEY: Record<string, string> = {
  statistics:
    '가격/시간/횟수 같은 구체적 수치를 6개 이상 본문에 넣음. 생성형 검색은 수치가 있는 문장을 우선 인용함.',
  citation: '"~자료에 따르면", "출처:" 처럼 근거 출처를 한 곳 이상 명시함.',
  quotation:
    '핵심 문장을 인용구(blockquote)로 한 번 이상 강조함. 인용 블록은 AI 요약에서 그대로 발췌되기 쉬움.',
  questionHeading: '소제목을 "원주마사지 가격은 얼마인가요?" 처럼 실제 검색 질문 문장으로 2개 이상 바꿈.',
  answerFirst: '첫 문단에서 키워드를 정의하고 결론을 먼저 말함(답변 우선 구조).',
  entityConsistency: '핵심 키워드를 제목, 첫 문단, 소제목에 모두 등장시켜 주제 엔티티를 분명히 함.',
  headingStructure: '소제목을 4개 이상 두어 문서를 검색 가능한 청크로 나눔.',
  chunkSize: '한 문단을 40~300자 사이로 맞춤. 너무 길거나 짧은 문단은 청크 단위 검색에서 밀림.',
};

export const analyzeGeoArticle = ({ title, html, keyword }: GeoArticleInput): GeoReport => {
  const blocks = parseArticleBlocks(html);
  const headings = blocks.filter((block) => block.type === 'heading').map((block) => block.text);
  const paragraphs = blocks.filter((block) => block.type === 'paragraph').map((block) => block.text);
  const quotes = blocks.filter((block) => block.type === 'quote');
  const text = blocks.map((block) => block.text).join('\n');
  const firstParagraph = paragraphs[0] ?? '';

  const numberCount = (text.match(/\d+/g) ?? []).length;
  const citationHits = CITATION_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const questionHeadings = headings.filter(isQuestion);

  const keywordInTitle = title.includes(keyword) ? 1 : 0;
  const keywordInFirst = firstParagraph.includes(keyword) ? 1 : 0;
  const keywordInHeading = headings.some((heading) => heading.includes(keyword)) ? 1 : 0;

  const definitionHit = new RegExp(
    `${keyword}[은는이가]?[^.]{0,60}(말합니다|입니다|뜻합니다|의미합니다)`,
  ).test(firstParagraph);

  const paragraphLengths = paragraphs.map((paragraph) => paragraph.length);
  const averageLength = paragraphLengths.length
    ? paragraphLengths.reduce((sum, len) => sum + len, 0) / paragraphLengths.length
    : 0;
  const chunkScore = averageLength >= 40 && averageLength <= 300 ? 1 : averageLength > 0 ? 0.4 : 0;

  const signals: GeoSignal[] = [
    toSignal('statistics', '수치·통계 밀도', 3, numberCount / 6, `숫자 표현 ${numberCount}개`),
    toSignal('citation', '출처 표기', 2, citationHits, `출처 패턴 ${citationHits}건`),
    toSignal('quotation', '인용구 활용', 2, quotes.length, `인용 블록 ${quotes.length}개`),
    toSignal(
      'questionHeading',
      '질문형 소제목',
      3,
      questionHeadings.length / 3,
      `질문형 소제목 ${questionHeadings.length}개`,
    ),
    toSignal(
      'answerFirst',
      '첫 문단 직답',
      2,
      definitionHit ? 1 : 0,
      definitionHit ? '첫 문단에 정의 문장 있음' : '첫 문단 정의 문장 없음',
    ),
    toSignal(
      'entityConsistency',
      '키워드 엔티티 일관성',
      3,
      (keywordInTitle + keywordInFirst + keywordInHeading) / 3,
      `제목:${keywordInTitle} 첫문단:${keywordInFirst} 소제목:${keywordInHeading}`,
    ),
    toSignal('headingStructure', '소제목 구조', 2, headings.length / 4, `소제목 ${headings.length}개`),
    toSignal('chunkSize', '문단 청크 길이', 1, chunkScore, `평균 문단 ${Math.round(averageLength)}자`),
  ];

  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const weighted = signals.reduce((sum, signal) => sum + signal.score * signal.weight, 0);
  const score = Math.round((weighted / totalWeight) * 100);

  const suggestions = signals
    .filter((signal) => !signal.passed)
    .map((signal) => SUGGESTION_BY_KEY[signal.key])
    .filter((suggestion): suggestion is string => Boolean(suggestion));

  return { score, grade: resolveGrade(score), signals, suggestions };
};

export const extractFaqPairs = (html: string): FaqPair[] => {
  const blocks = parseArticleBlocks(html);
  const pairs: FaqPair[] = [];

  blocks.forEach((block, index) => {
    if (block.type !== 'heading' || !isQuestion(block.text)) return;

    const answerParts: string[] = [];
    for (let cursor = index + 1; cursor < blocks.length; cursor += 1) {
      if (blocks[cursor].type === 'heading') break;
      answerParts.push(blocks[cursor].text);
    }

    const answer = answerParts.join(' ').trim();
    if (answer.length > 0) pairs.push({ question: block.text, answer });
  });

  return pairs;
};

const buildDescription = (html: string): string => {
  const text = parseArticleBlocks(html)
    .map((block) => block.text)
    .join(' ');
  return text.length > 150 ? `${text.slice(0, 150)}…` : text;
};

export const buildArticleJsonLd = ({
  title,
  html,
  keyword,
  url,
  authorName,
  publisherName,
  publishedAt,
  imageUrls,
}: GeoArticleInput): string => {
  const payload: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: buildDescription(html),
    keywords: keyword,
    inLanguage: 'ko-KR',
  };

  if (url) payload.mainEntityOfPage = { '@type': 'WebPage', '@id': url };
  if (authorName) payload.author = { '@type': 'Person', name: authorName };
  if (publisherName) payload.publisher = { '@type': 'Organization', name: publisherName };
  if (publishedAt) {
    payload.datePublished = publishedAt;
    payload.dateModified = publishedAt;
  }
  if (imageUrls?.length) payload.image = imageUrls;

  return JSON.stringify(payload, null, 2);
};

export const buildFaqJsonLd = (pairs: FaqPair[]): string => {
  if (!pairs.length) return '';

  return JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: pairs.map((pair) => ({
        '@type': 'Question',
        name: pair.question,
        acceptedAnswer: { '@type': 'Answer', text: pair.answer },
      })),
    },
    null,
    2,
  );
};

export const buildLlmsTxt = ({ siteName, siteUrl, summary, entries }: LlmsTxtInput): string => {
  const lines = [`# ${siteName}`, ''];

  if (summary) {
    lines.push(`> ${summary}`, '');
  }
  lines.push(`사이트: ${siteUrl}`, '', '## 글', '');

  entries.forEach((entry) => {
    const tail = entry.summary ? `: ${entry.summary}` : '';
    lines.push(`- [${entry.title}](${entry.url})${tail}`);
  });

  return `${lines.join('\n')}\n`;
};
