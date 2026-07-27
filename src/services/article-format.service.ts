/**
 * 네이버 발행용 HTML(=div 줄바꿈 + blockquote 소제목) 한 벌을
 * 다른 플랫폼이 받아먹을 수 있는 포맷으로 바꿔주는 변환기.
 *
 * - `toMarkdown`: Dev.to, GitHub Pages, Velog 처럼 마크다운을 먹는 곳
 * - `toSemanticHtml`: WordPress, Blogger 처럼 HTML 을 먹는 곳 (h2/p 승격 + JSON-LD)
 */

import { buildArticleJsonLd, parseArticleBlocks } from './geo-optimizer.service.js';

const BOLD_OPEN = '@@B@@';
const BOLD_CLOSE = '@@/B@@';
const IMAGE_MARKER = /^이미지(\d+)\)$/;

export interface MarkdownOptions {
  imageUrls?: string[];
  imageAltPrefix?: string;
}

export interface SemanticHtmlOptions {
  title: string;
  keyword: string;
  url?: string;
  authorName?: string;
  publisherName?: string;
  publishedAt?: string;
  imageUrls?: string[];
  imageAltPrefix?: string;
  includeJsonLd?: boolean;
}

const protectBold = (html: string): string =>
  html.replace(/<strong[^>]*>/gi, BOLD_OPEN).replace(/<\/strong>/gi, BOLD_CLOSE);

const restoreBold = (text: string, open: string, close: string): string =>
  text.split(BOLD_OPEN).join(open).split(BOLD_CLOSE).join(close);

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const resolveImageMarker = (text: string): number | undefined => {
  const match = text.match(IMAGE_MARKER);
  return match ? Number(match[1]) : undefined;
};

export const toMarkdown = (html: string, options: MarkdownOptions = {}): string => {
  const { imageUrls = [], imageAltPrefix = '이미지' } = options;
  const blocks = parseArticleBlocks(protectBold(html));

  const lines = blocks
    .map((block) => {
      const text = restoreBold(block.text, '**', '**');

      const markerIndex = resolveImageMarker(block.text);
      if (markerIndex !== undefined) {
        const url = imageUrls[markerIndex - 1];
        return url ? `![${imageAltPrefix} ${markerIndex}](${url})` : '';
      }

      if (block.type === 'heading') return `## ${text}`;
      if (block.type === 'quote') return `> ${text}`;
      return text;
    })
    .filter((line) => line.length > 0);

  return `${lines.join('\n\n')}\n`;
};

export const toSemanticHtml = (html: string, options: SemanticHtmlOptions): string => {
  const { imageUrls = [], imageAltPrefix = '이미지', includeJsonLd = true } = options;
  const blocks = parseArticleBlocks(protectBold(html));

  const body = blocks
    .map((block) => {
      const text = restoreBold(escapeHtml(block.text), '<strong>', '</strong>');

      const markerIndex = resolveImageMarker(block.text);
      if (markerIndex !== undefined) {
        const url = imageUrls[markerIndex - 1];
        return url ? `<figure><img src="${url}" alt="${imageAltPrefix} ${markerIndex}" loading="lazy"></figure>` : '';
      }

      if (block.type === 'heading') return `<h2>${text}</h2>`;
      if (block.type === 'quote') return `<blockquote><p>${text}</p></blockquote>`;
      return `<p>${text}</p>`;
    })
    .filter((line) => line.length > 0);

  if (!includeJsonLd) return body.join('\n');

  const jsonLd = buildArticleJsonLd({
    title: options.title,
    html,
    keyword: options.keyword,
    url: options.url,
    authorName: options.authorName,
    publisherName: options.publisherName,
    publishedAt: options.publishedAt,
    imageUrls: options.imageUrls,
  });

  return [...body, `<script type="application/ld+json">\n${jsonLd}\n</script>`].join('\n');
};
