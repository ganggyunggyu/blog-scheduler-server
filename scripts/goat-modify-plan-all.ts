import 'dotenv/config';
import { writeFileSync } from 'fs';
import mongoose from 'mongoose';

const SHEET_GID = '1025121967';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const OUT_PATH = '/tmp/goat-modify-plan-all.json';

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '"') {
      if (q && n === '"') { cell += '"'; i += 1; } else { q = !q; }
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

interface PostTitle { logNo: string; title: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fetchPage = async (blogId: string, page: number, attempt = 0): Promise<string | null> => {
  const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=${page}&categoryNo=0&parentCategoryNo=&countPerPage=30`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', Referer: `https://blog.naver.com/${blogId}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      if (attempt < 2) { await sleep(1000 * (attempt + 1)); return fetchPage(blogId, page, attempt + 1); }
      return null;
    }
    return await res.text();
  } catch {
    if (attempt < 2) { await sleep(1000 * (attempt + 1)); return fetchPage(blogId, page, attempt + 1); }
    return null;
  }
};

const fetchAllPostTitles = async (blogId: string): Promise<PostTitle[]> => {
  const titles: PostTitle[] = [];
  let page = 1;
  while (true) {
    const text = await fetchPage(blogId, page);
    if (!text) break;
    const listStart = text.indexOf('"postList":[');
    if (listStart < 0) break;
    const bracketStart = text.indexOf('[', listStart);
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
    if (end < 0) break;
    let arr: any[] = [];
    try { arr = JSON.parse(text.slice(bracketStart, end)); } catch { break; }
    if (arr.length === 0) break;
    for (const item of arr) {
      const raw = (item.title as string) || '';
      let decoded = raw;
      try { decoded = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch {}
      const title = decoded.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      titles.push({ logNo: String(item.logNo ?? ''), title });
    }
    const totalMatch = text.match(/"totalCount"\s*:\s*"?(\d+)/);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    if (total === 0 || titles.length >= total) break;
    page += 1;
    if (page > 100) break;
  }
  return titles;
};

const normalize = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

const matchKeyword = (title: string, keywords: string[]): string | null => {
  const n = normalize(title);
  for (const kw of keywords) {
    if (normalize(kw) && n.includes(normalize(kw))) return kw;
  }
  return null;
};

const extractRoot = (kw: string): string => {
  const n = kw.replace(/\s+/g, '');
  const stops = ['증상', '원인', '치료법', '치료방법', '치료', '영양제', '음식', '약', '예방', '관리법', '관리', '방법', '효능', '복용법', '부작용', '후기', '추천', '선물', '가격', '비용', '복용시간', '체질'];
  for (const sw of stops) {
    if (n.endsWith(sw) && n.length > sw.length + 1) return n.slice(0, -sw.length);
  }
  return n;
};

const hashString = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const seededRng = (seed: string): (() => number) => {
  let s = hashString(seed) || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
};

const shuffle = <T>(arr: T[], rng: () => number): T[] => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const assignKeywordsToAccount = (
  slots: number,
  keywordPool: string[],
  unused: Set<string>,
  rng: () => number,
): string[] => {
  const result: string[] = [];
  let cycleBuf: string[] = shuffle(keywordPool, rng);
  let lastRoot: string | null = null;

  for (let s = 0; s < slots; s += 1) {
    if (cycleBuf.length === 0) cycleBuf = shuffle(keywordPool, rng);

    let pickedIdx = -1;

    // 1순위: 미사용 & 루트 비충돌
    if (unused.size > 0) {
      for (let i = 0; i < cycleBuf.length; i += 1) {
        if (unused.has(cycleBuf[i]) && extractRoot(cycleBuf[i]) !== lastRoot) {
          pickedIdx = i;
          break;
        }
      }
    }

    // 2순위: 루트 비충돌 (사용됐어도 OK)
    if (pickedIdx < 0) {
      for (let i = 0; i < cycleBuf.length; i += 1) {
        if (extractRoot(cycleBuf[i]) !== lastRoot) {
          pickedIdx = i;
          break;
        }
      }
    }

    // 3순위: 강제 선택
    if (pickedIdx < 0) pickedIdx = 0;

    const kw = cycleBuf.splice(pickedIdx, 1)[0];
    result.push(kw);
    lastRoot = extractRoot(kw);
    unused.delete(kw);
  }

  return result;
};

const main = async () => {
  const seed = process.argv[2] ?? '2026-04-21';
  const rng = seededRng(`goat-all:${seed}`);

  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const docs = await cafeDb.collection('accounts')
    .find({ isActive: { $ne: false }, category: { $in: ['흑염소', '한려담원'] } })
    .toArray();

  const keywords = await fetchKeywords();
  console.log(`시트 키워드: ${keywords.length}개 | 계정: ${docs.length}개\n`);

  interface AccountData {
    accountId: string;
    password: string;
    blogId: string;
    nickname: string;
    slots: { logNo: string; oldTitle: string; oldKeyword: string }[];
  }

  const accountsData: AccountData[] = [];

  for (const d of docs) {
    const accountId = d.accountId as string;
    const blogId = (d.blogId as string) || accountId;
    const nickname = (d.nickname as string) || accountId;
    const posts = await fetchAllPostTitles(blogId);
    const matched = posts
      .map((p) => ({ ...p, oldKeyword: matchKeyword(p.title, keywords) }))
      .filter((p): p is PostTitle & { oldKeyword: string } => p.oldKeyword !== null);
    accountsData.push({
      accountId, password: d.password as string, blogId, nickname,
      slots: matched.map((m) => ({ logNo: m.logNo, oldTitle: m.title, oldKeyword: m.oldKeyword })),
    });
    console.log(`  ${nickname.padEnd(16)} matched ${String(matched.length).padStart(4)}개`);
    await sleep(500);
  }

  // 큰 계정부터 배정 (미사용 키워드 소진 보장)
  const sorted = [...accountsData].sort((a, b) => b.slots.length - a.slots.length);
  const unused = new Set(keywords);

  const byAccountId = new Map<string, any[]>();

  for (const acc of sorted) {
    const assigned = assignKeywordsToAccount(acc.slots.length, keywords, unused, rng);
    const planItems = acc.slots.map((slot, idx) => ({
      accountId: acc.accountId,
      password: acc.password,
      blogId: acc.blogId,
      nickname: acc.nickname,
      logNo: slot.logNo,
      oldTitle: slot.oldTitle,
      oldKeyword: slot.oldKeyword,
      newKeyword: assigned[idx],
    }));
    byAccountId.set(acc.accountId, planItems);
  }

  // 원래 계정 순서로 재정렬
  const plan = accountsData.flatMap((a) => byAccountId.get(a.accountId) || []);

  writeFileSync(OUT_PATH, JSON.stringify(plan, null, 2));

  // 통계
  const totalSlots = plan.length;
  const usedKeywords = new Set(plan.map((p) => p.newKeyword));
  const unusedKeywords = keywords.filter((k) => !usedKeywords.has(k));
  const keywordUsageCount = new Map<string, number>();
  for (const p of plan) keywordUsageCount.set(p.newKeyword, (keywordUsageCount.get(p.newKeyword) ?? 0) + 1);
  const maxUsage = Math.max(...keywordUsageCount.values());
  const minUsage = Math.min(...keywordUsageCount.values());

  // 계정별 루트 연속 충돌 체크
  let rootConflicts = 0;
  for (const acc of accountsData) {
    const items = byAccountId.get(acc.accountId) || [];
    for (let i = 1; i < items.length; i += 1) {
      if (extractRoot(items[i].newKeyword) === extractRoot(items[i - 1].newKeyword)) {
        rootConflicts += 1;
      }
    }
  }

  console.log(`\n=== 배정 통계 ===`);
  console.log(`총 슬롯: ${totalSlots}`);
  console.log(`사용된 키워드: ${usedKeywords.size}/${keywords.length}`);
  console.log(`미사용 키워드: ${unusedKeywords.length}`);
  if (unusedKeywords.length > 0 && unusedKeywords.length <= 20) {
    console.log(`  미사용 목록: ${unusedKeywords.join(', ')}`);
  }
  console.log(`키워드당 사용횟수: 최소 ${minUsage}, 최대 ${maxUsage}`);
  console.log(`계정 내 루트 연속 충돌: ${rootConflicts}건\n`);
  console.log(`저장: ${OUT_PATH}`);

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
