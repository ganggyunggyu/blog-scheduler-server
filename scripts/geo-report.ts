import { readFile } from 'fs/promises';
import {
  analyzeGeoArticle,
  buildArticleJsonLd,
  buildFaqJsonLd,
  extractFaqPairs,
  parseArticleBlocks,
} from '../src/services/geo-optimizer.service.js';

const main = async (): Promise<void> => {
  const respPath = process.argv[2];
  const keyword = process.argv[3];
  if (!respPath || !keyword) throw new Error('사용법: tsx scripts/geo-report.ts <resp.json> <키워드>');

  const resp = JSON.parse(await readFile(respPath, 'utf8'));
  const html = String(resp.article_html);
  const title = String(resp.content ?? '').split('\n')[0].trim();

  const blocks = parseArticleBlocks(html);
  const headings = blocks.filter((block) => block.type === 'heading');
  const quotes = blocks.filter((block) => block.type === 'quote');
  const paragraphs = blocks.filter((block) => block.type === 'paragraph');

  console.log(`제목: ${title}`);
  console.log(`구조: 소제목 ${headings.length} / 인용 ${quotes.length} / 문단 ${paragraphs.length}`);
  headings.forEach((heading) => console.log(`  - ${heading.text}`));

  const report = analyzeGeoArticle({ title, html, keyword });
  console.log(`\nGEO 점수: ${report.score} (${report.grade})`);
  report.signals.forEach((signal) => {
    console.log(`  ${signal.passed ? 'O' : 'X'} ${signal.label} — ${signal.detail}`);
  });

  if (report.suggestions.length) {
    console.log('\n개선안:');
    report.suggestions.forEach((suggestion) => console.log(`  - ${suggestion}`));
  }

  const faqs = extractFaqPairs(html);
  console.log(`\nFAQ 추출: ${faqs.length}쌍`);

  if (process.env.PRINT_JSONLD === 'true') {
    console.log('\n--- Article JSON-LD ---');
    console.log(buildArticleJsonLd({ title, html, keyword }));
    const faqLd = buildFaqJsonLd(faqs);
    if (faqLd) {
      console.log('\n--- FAQ JSON-LD ---');
      console.log(faqLd);
    }
  }
};

main().catch((error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
