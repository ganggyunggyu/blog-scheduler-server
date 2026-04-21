import 'dotenv/config';
import mongoose from 'mongoose';

const SHEET_GID = '1025121967';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1;
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }
    currentCell += char;
  }
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }
  return rows.map((row) => row.map((cell) => cell.trim()));
};

const fetchAllGoatKeywords = async (): Promise<string[]> => {
  const res = await fetch(SHEET_CSV_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' },
  });
  if (!res.ok) throw new Error(`sheet fetch failed: ${res.status}`);

  const rows = parseCsv(await res.text());
  const keywords: string[] = [];
  const seen = new Set<string>();

  for (const [index, row] of rows.entries()) {
    if (index === 0) continue;
    const keyword = row[0]?.trim() ?? '';
    if (!keyword || keyword.startsWith('키워드 ')) continue;
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
  }
  return keywords;
};

interface PostTitle {
  logNo: string;
  title: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fetchPage = async (blogId: string, page: number, perPage: number, attempt = 0): Promise<string | null> => {
  const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=${page}&categoryNo=0&parentCategoryNo=&countPerPage=${perPage}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: `https://blog.naver.com/${blogId}`,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      if (attempt < 2) { await sleep(1000 * (attempt + 1)); return fetchPage(blogId, page, perPage, attempt + 1); }
      return null;
    }
    return await res.text();
  } catch {
    if (attempt < 2) { await sleep(1000 * (attempt + 1)); return fetchPage(blogId, page, perPage, attempt + 1); }
    return null;
  }
};

const fetchAllPostTitles = async (blogId: string): Promise<PostTitle[]> => {
  const perPage = 30;
  const titles: PostTitle[] = [];
  let page = 1;

  while (true) {
    const text = await fetchPage(blogId, page, perPage);
    if (!text) break;

    const listStart = text.indexOf('"postList":[');
    if (listStart < 0) break;
    const bracketStart = text.indexOf('[', listStart);
    let depth = 0;
    let listEnd = -1;
    let inString = false;
    let escape = false;
    for (let i = bracketStart; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '[') depth += 1;
      else if (ch === ']') {
        depth -= 1;
        if (depth === 0) { listEnd = i + 1; break; }
      }
    }
    if (listEnd < 0) break;

    let postList: any[] = [];
    try {
      postList = JSON.parse(text.slice(bracketStart, listEnd));
    } catch {
      break;
    }
    if (postList.length === 0) break;

    for (const item of postList) {
      const rawTitle = (item.title as string) || '';
      let decoded = rawTitle;
      try { decoded = decodeURIComponent(rawTitle.replace(/\+/g, ' ')); } catch {}
      const title = decoded.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      titles.push({ logNo: String(item.logNo ?? ''), title });
    }

    const totalMatch = text.match(/"totalCount"\s*:\s*"?(\d+)/);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    if (total === 0) break;
    if (titles.length >= total) break;
    page += 1;
    if (page > 100) break;
  }

  return titles;
};

const matchesAnyKeyword = (title: string, keywords: string[]): string | null => {
  const normalizedTitle = title.replace(/\s+/g, '').toLowerCase();
  for (const kw of keywords) {
    const normKw = kw.replace(/\s+/g, '').toLowerCase();
    if (normKw && normalizedTitle.includes(normKw)) return kw;
  }
  return null;
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const docs = await cafeDb
    .collection('accounts')
    .find({ isActive: { $ne: false }, category: { $in: ['흑염소', '한려담원'] } })
    .toArray();

  const keywords = await fetchAllGoatKeywords();
  console.log(`\n=== 흑염소 수정 대상 체크 ===`);
  console.log(`시트 키워드 총 ${keywords.length}개`);
  console.log(`대상 계정: ${docs.length}개\n`);

  let totalMatched = 0;
  for (const d of docs) {
    const blogId = (d.blogId as string) || (d.accountId as string);
    const nickname = (d.nickname as string) || (d.accountId as string);

    const posts = await fetchAllPostTitles(blogId);
    const matched = posts.filter((p) => matchesAnyKeyword(p.title, keywords) !== null);
    totalMatched += matched.length;

    console.log(`  ${nickname.padEnd(16)} (${blogId.padEnd(14)})  전체 ${String(posts.length).padStart(4)}개 → 흑염소 매칭 ${String(matched.length).padStart(4)}개`);
    await sleep(800);
  }
  console.log(`\n총 흑염소 매칭글: ${totalMatched}개`);
  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
