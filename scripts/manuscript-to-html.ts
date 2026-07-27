import { readFile, writeFile } from 'fs/promises';

const COLOR = '#03c75a'; // 네이버 그린

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inlineColor = (text: string): string =>
  text.replace(/\[\[(.+?)\]\]/g, `<span style="color:${COLOR};">$1</span>`);

const render = (line: string): string => inlineColor(escapeHtml(line));

export interface ManuscriptHtml {
  title: string;
  html: string;
}

export const manuscriptToHtml = (content: string): ManuscriptHtml => {
  const lines = content.split('\n');
  const title = (lines[0] ?? '').replace(/\[\[|\]\]/g, '').trim();
  const parts: string[] = [];

  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line) continue;
    // 마크다운 표 구분선(| --- | --- |) 제거
    if (/^\|[\s\-|:]+\|$/.test(line)) continue;

    if (line.startsWith('> ')) {
      parts.push(`<blockquote>${render(line.slice(2))}</blockquote>`);
    } else if (/^\d+\.\s/.test(line)) {
      parts.push(`<h3>${render(line)}</h3>`);
    } else if (line.startsWith('|')) {
      // 표 행 → 셀을 · 로 이어붙인 문단
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      parts.push(`<p>${render(cells.join(' · '))}</p>`);
    } else {
      parts.push(`<p>${render(line)}</p>`);
    }
  }

  return { title, html: parts.join('\n') };
};

const main = async (): Promise<void> => {
  const inPath = process.argv[2];
  if (!inPath) throw new Error('원고 파일 경로 필요');
  const content = await readFile(inPath, 'utf8');
  const { title, html } = manuscriptToHtml(content);

  const outPath = inPath.replace(/\.txt$/, '.html');
  await writeFile(outPath, `<h2>${escapeHtml(title)}</h2>\n${html}`, 'utf8');

  const blockquotes = (html.match(/<blockquote>/g) ?? []).length;
  const colors = (html.match(/<span style="color/g) ?? []).length;
  const h3s = (html.match(/<h3>/g) ?? []).length;
  console.log(`[title] ${title}`);
  console.log(`[stats] blockquote=${blockquotes} color-span=${colors} h3=${h3s}`);
  console.log(`[saved] ${outPath}`);
  console.log('--- HTML preview (first 900) ---');
  console.log(html.slice(0, 900));
};

if (process.argv[1]?.includes('manuscript-to-html')) {
  main().catch((error) => {
    console.error('[error]', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
