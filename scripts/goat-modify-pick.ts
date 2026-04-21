import 'dotenv/config';
import { writeFileSync } from 'fs';
import mongoose from 'mongoose';

const SHEET_GID = '1025121967';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const OUT_PATH = '/tmp/goat-modify-plan.json';

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '"') {
      if (inQuotes && n === '"') { currentCell += '"'; i += 1; }
      else { inQuotes = !inQuotes; }
      continue;
    }
    if (c === ',' && !inQuotes) { currentRow.push(currentCell); currentCell = ''; continue; }
    if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && n === '\n') i += 1;
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }
    currentCell += c;
  }
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }
  return rows.map((r) => r.map((c) => c.trim()));
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
    const kw = row[0]?.trim() ?? '';
    if (!kw || kw.startsWith('키워드 ')) continue;
    if (seen.has(kw)) continue;
    seen.add(kw);
    keywords.push(kw);
  }
  return keywords;
};

interface PostTitle { logNo: string; title: string }

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
    let depth = 0, listEnd = -1, inString = false, escape = false;
    for (let i = bracketStart; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '[') depth += 1;
      else if (ch === ']') { depth -= 1; if (depth === 0) { listEnd = i + 1; break; } }
    }
    if (listEnd < 0) break;
    let postList: any[] = [];
    try { postList = JSON.parse(text.slice(bracketStart, listEnd)); } catch { break; }
    if (postList.length === 0) break;
    for (const item of postList) {
      const raw = (item.title as string) || '';
      let decoded = raw;
      try { decoded = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch {}
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

const normalize = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

const findMatchedKeyword = (title: string, keywords: string[]): string | null => {
  const n = normalize(title);
  for (const kw of keywords) {
    if (normalize(kw) && n.includes(normalize(kw))) return kw;
  }
  return null;
};

const extractRoot = (keyword: string): string => {
  const normalized = keyword.replace(/\s+/g, '');
  const stopWords = ['증상', '원인', '치료', '치료법', '치료방법', '영양제', '음식', '약', '예방', '관리', '관리법', '방법', '효능', '복용법', '부작용', '후기', '추천', '선물'];
  let root = normalized;
  for (const sw of stopWords) {
    if (root.endsWith(sw) && root.length > sw.length) {
      root = root.slice(0, -sw.length);
      break;
    }
  }
  return root;
};

const pickRandom = <T>(arr: T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];

const hashString = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const createSeededRng = (seed: string): (() => number) => {
  let s = hashString(seed) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
};

const main = async () => {
  const seed = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const rng = createSeededRng(`goat-test:${seed}`);

  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const docs = await cafeDb
    .collection('accounts')
    .find({ isActive: { $ne: false }, category: { $in: ['흑염소', '한려담원'] } })
    .toArray();

  const keywords = await fetchAllGoatKeywords();
  console.log(`시트 키워드 ${keywords.length}개 | 계정 ${docs.length}개 | seed=${seed}\n`);

  const shuffledKeywords = [...keywords];
  for (let i = shuffledKeywords.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffledKeywords[i], shuffledKeywords[j]] = [shuffledKeywords[j], shuffledKeywords[i]];
  }

  const plan: any[] = [];
  const usedRoots = new Set<string>();
  let kwIdx = 0;

  for (const d of docs) {
    const blogId = (d.blogId as string) || (d.accountId as string);
    const accountId = d.accountId as string;
    const password = d.password as string;
    const nickname = (d.nickname as string) || accountId;

    const posts = await fetchAllPostTitles(blogId);
    const matched = posts
      .map((p) => ({ ...p, matchedKw: findMatchedKeyword(p.title, keywords) }))
      .filter((p) => p.matchedKw !== null);

    if (matched.length === 0) {
      console.log(`  [스킵] ${nickname} (${blogId}) — 매칭글 0개`);
      continue;
    }

    const picked = pickRandom(matched, rng);

    const oldRoot = extractRoot(picked.matchedKw!);
    let newKw: string | null = null;
    let attempts = 0;
    while (attempts < shuffledKeywords.length * 2) {
      if (kwIdx >= shuffledKeywords.length) kwIdx = 0;
      const candidate = shuffledKeywords[kwIdx];
      kwIdx += 1;
      attempts += 1;
      const root = extractRoot(candidate);
      if (usedRoots.has(root)) continue;
      if (root === oldRoot) continue;
      if (normalize(candidate) === normalize(picked.matchedKw!)) continue;
      newKw = candidate;
      usedRoots.add(root);
      break;
    }
    if (!newKw) {
      console.log(`  [스킵] ${nickname} — 새 키워드 할당 실패`);
      continue;
    }

    plan.push({
      accountId,
      password,
      blogId,
      nickname,
      logNo: picked.logNo,
      oldTitle: picked.title,
      oldKeyword: picked.matchedKw,
      newKeyword: newKw,
    });

    console.log(`  ${nickname.padEnd(16)} logNo=${picked.logNo}`);
    console.log(`    기존: ${picked.title.slice(0, 40)} (${picked.matchedKw})`);
    console.log(`    신규 키워드: ${newKw}`);
    await sleep(600);
  }

  writeFileSync(OUT_PATH, JSON.stringify(plan, null, 2));
  console.log(`\n${plan.length}개 플랜 저장 → ${OUT_PATH}`);
  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
