import 'dotenv/config';
import { writeFileSync } from 'fs';
import mongoose from 'mongoose';

const SHEET_GID = '1025121967';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const OUT_PATH = '/tmp/goat-modify-single.json';
const TARGET_NICK = process.argv[2] ?? '힘차게';

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '"') {
      if (q && n === '"') { cell += '"'; i += 1; }
      else { q = !q; }
      continue;
    }
    if (c === ',' && !q) { row.push(cell); cell = ''; continue; }
    if ((c === '\n' || c === '\r') && !q) {
      if (c === '\r' && n === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
      continue;
    }
    cell += c;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim()));
};

const fetchKeywords = async (): Promise<string[]> => {
  const res = await fetch(SHEET_CSV_URL, { headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' } });
  const rows = parseCsv(await res.text());
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    if (i === 0) continue;
    const kw = r[0]?.trim() ?? '';
    if (!kw || kw.startsWith('키워드 ')) continue;
    if (seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
  }
  return out;
};

const fetchLatestPost = async (blogId: string) => {
  const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=1&categoryNo=0&parentCategoryNo=&countPerPage=50`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', Referer: `https://blog.naver.com/${blogId}` },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  const bracketStart = text.indexOf('[', text.indexOf('"postList":['));
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = bracketStart; i < text.length; i += 1) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '[') depth += 1;
    else if (ch === ']') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  const arr = JSON.parse(text.slice(bracketStart, end));
  return arr.map((item: any) => {
    const raw = (item.title as string) || '';
    let decoded = raw;
    try { decoded = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch {}
    const title = decoded.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    return { logNo: String(item.logNo ?? ''), title, addDate: item.addDate as string };
  });
};

const normalize = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

const matchKeyword = (title: string, keywords: string[]): string | null => {
  const n = normalize(title);
  for (const kw of keywords) {
    if (normalize(kw) && n.includes(normalize(kw))) return kw;
  }
  return null;
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const acc = await cafeDb.collection('accounts').findOne({
    isActive: { $ne: false },
    category: { $in: ['흑염소', '한려담원'] },
    nickname: TARGET_NICK,
  });
  if (!acc) {
    console.error(`account not found: nickname=${TARGET_NICK}`);
    process.exit(1);
  }

  const accountId = acc.accountId as string;
  const password = acc.password as string;
  const blogId = (acc.blogId as string) || accountId;

  const keywords = await fetchKeywords();
  const posts = await fetchLatestPost(blogId);

  const latest = posts.find((p: any) => matchKeyword(p.title, keywords));
  if (!latest) {
    console.error(`no matched latest post for ${blogId}`);
    process.exit(1);
  }
  const oldKw = matchKeyword(latest.title, keywords)!;

  const usedInTest = new Set([
    '근감소증', '임산부철분', '당뇨영양제', '기립성저혈압치료',
    '관절에좋은영양제', '소음인남자', '흑염소진액먹는법', '중성지방정상수치',
  ]);

  const extractRoot = (kw: string): string => {
    const n = kw.replace(/\s+/g, '');
    const stops = ['증상', '원인', '치료', '치료법', '치료방법', '영양제', '음식', '약', '예방', '관리', '관리법', '방법', '효능', '복용법', '부작용', '후기', '추천', '선물'];
    for (const sw of stops) {
      if (n.endsWith(sw) && n.length > sw.length) return n.slice(0, -sw.length);
    }
    return n;
  };
  const oldRoot = extractRoot(oldKw);

  const shuffled = [...keywords].sort(() => Math.random() - 0.5);
  let newKw: string | null = null;
  for (const cand of shuffled) {
    if (usedInTest.has(cand)) continue;
    if (normalize(cand) === normalize(oldKw)) continue;
    if (extractRoot(cand) === oldRoot) continue;
    newKw = cand;
    break;
  }
  if (!newKw) { console.error('no new keyword found'); process.exit(1); }

  const plan = {
    accountId, password, blogId,
    nickname: (acc.nickname as string) || accountId,
    logNo: latest.logNo,
    oldTitle: latest.title,
    oldKeyword: oldKw,
    oldAddDate: latest.addDate,
    newKeyword: newKw,
  };

  writeFileSync(OUT_PATH, JSON.stringify(plan, null, 2));
  console.log(`[단일 테스트 플랜]`);
  console.log(`  계정: ${plan.nickname} (${accountId})`);
  console.log(`  blogId: ${blogId}`);
  console.log(`  logNo: ${plan.logNo}`);
  console.log(`  기존글: ${plan.oldTitle} [${plan.oldAddDate}]`);
  console.log(`  기존키워드: ${plan.oldKeyword}`);
  console.log(`  신규키워드: ${plan.newKeyword}`);
  console.log(`\n저장: ${OUT_PATH}`);

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
