import { readFile, writeFile, mkdir } from 'fs/promises';
import { toMarkdown, toSemanticHtml } from '../src/services/article-format.service.js';
import { analyzeGeoArticle } from '../src/services/geo-optimizer.service.js';

/**
 * 네이버 발행용 원고 하나를 다른 플랫폼(GitHub Pages, WordPress, Dev.to 등)에
 * 그대로 올릴 수 있는 마크다운 / 시맨틱 HTML 로 뽑아냄.
 */
const main = async (): Promise<void> => {
  const respPath = process.argv[2];
  const keyword = process.argv[3];
  const outDir = process.argv[4] ?? 'out';
  if (!respPath || !keyword) {
    throw new Error('사용법: tsx scripts/export-article.ts <resp.json> <키워드> [출력디렉터리]');
  }

  const resp = JSON.parse(await readFile(respPath, 'utf8'));
  const html = String(resp.article_html);
  const title = String(resp.content ?? '').split('\n')[0].trim();
  const imageUrls: string[] = (resp.images ?? []).map((image: { url: string }) => image.url);
  const slug = keyword.replace(/\s+/g, '-');

  await mkdir(outDir, { recursive: true });

  const markdown = [
    '---',
    `title: "${title}"`,
    `keyword: "${keyword}"`,
    '---',
    '',
    toMarkdown(html, { imageUrls, imageAltPrefix: keyword }),
  ].join('\n');

  const semantic = toSemanticHtml(html, { title, keyword, imageUrls, imageAltPrefix: keyword });

  await writeFile(`${outDir}/${slug}.md`, markdown, 'utf8');
  await writeFile(`${outDir}/${slug}.html`, semantic, 'utf8');

  const report = analyzeGeoArticle({ title, html, keyword });
  console.log(`[export] ${outDir}/${slug}.md (${markdown.length}자)`);
  console.log(`[export] ${outDir}/${slug}.html (${semantic.length}자)`);
  console.log(`[geo] ${report.score}점 (${report.grade})`);
};

main().catch((error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
