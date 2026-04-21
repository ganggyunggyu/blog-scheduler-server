import 'dotenv/config';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { format } from 'date-fns';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';

const SHEET_GID = '1025121967';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const JOBS_DIR = path.resolve(process.cwd(), 'jobs');
const PER_ACCOUNT = Number(process.argv[2] ?? 10);

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]; const n = text[i + 1];
    if (c === '"') { if (q && n === '"') { cell += '"'; i += 1; } else { q = !q; } continue; }
    if (c === ',' && !q) { row.push(cell); cell = ''; continue; }
    if ((c === '\n' || c === '\r') && !q) {
      if (c === '\r' && n === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = ''; continue;
    }
    cell += c;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim()));
};

const fetchKeywords = async (): Promise<string[]> => {
  const res = await fetch(SHEET_CSV_URL, { headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' } });
  const rows = parseCsv(await res.text());
  const out: string[] = []; const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    if (i === 0) continue;
    const kw = r[0]?.trim() ?? '';
    if (!kw || kw.startsWith('키워드 ')) continue;
    if (seen.has(kw)) continue;
    seen.add(kw); out.push(kw);
  }
  return out;
};

interface PostItem { logNo: string; title: string }

const fetchLatestPosts = async (blogId: string, limit = 30): Promise<PostItem[]> => {
  const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=1&categoryNo=0&parentCategoryNo=&countPerPage=${limit}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', Referer: `https://blog.naver.com/${blogId}` },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  const listStart = text.indexOf('"postList":[');
  if (listStart < 0) return [];
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
  const arr = JSON.parse(text.slice(bracketStart, end));
  return arr.map((item: any) => {
    const raw = (item.title as string) || '';
    let decoded = raw;
    try { decoded = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch {}
    const title = decoded.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    return { logNo: String(item.logNo ?? ''), title };
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

const extractRoot = (kw: string): string => {
  const n = kw.replace(/\s+/g, '');
  const stops = ['증상', '원인', '치료법', '치료방법', '치료', '영양제', '음식', '약', '예방', '관리법', '관리', '방법', '효능', '복용법', '부작용', '후기', '추천', '선물'];
  for (const sw of stops) {
    if (n.endsWith(sw) && n.length > sw.length + 1) return n.slice(0, -sw.length);
  }
  return n;
};

const createJobDir = (keyword: string): string => {
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2');
  const safe = keyword.replace(/[^\w가-힣]/g, '_').slice(0, 20);
  const dir = path.join(JOBS_DIR, `${ts}_${safe}_modify`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    keyword, mode: 'modify-goat-top10', createdAt: new Date().toISOString(), status: 'pending',
  }, null, 2));
  return dir;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const accs = await cafeDb.collection('accounts')
    .find({ isActive: { $ne: false }, category: { $in: ['흑염소', '한려담원'] } })
    .toArray();

  const keywords = await fetchKeywords();
  console.log(`시트 키워드 ${keywords.length}개, 계정 ${accs.length}개\n`);

  // 이미 이번 modify-goat-* 세션에서 처리된 logNo 조회
  const prevSchedules = await mongoose.connection.db!
    .collection('schedules')
    .find({ service: { $regex: /^modify-goat-/ } })
    .toArray();
  const prevIds = prevSchedules.map((s) => s._id);
  const prevJobs = await mongoose.connection.db!
    .collection('schedulejobs')
    .find({ scheduleId: { $in: prevIds } })
    .toArray();
  // postUrl의 logNo + scheduledAt 기록에서 logNo 파싱
  const usedLogNos = new Set<string>();
  for (const j of prevJobs) {
    if (j.postUrl) {
      const m = (j.postUrl as string).match(/\/(\d{10,})(?:\?|$)/);
      if (m) usedLogNos.add(m[1]);
    }
  }
  // generate job의 원본 logNo도 추출 (Redis 큐 data에서)
  // 간단히: postUrl 없어도 job.data.logNo 있음. 하지만 ScheduleJob에는 logNo 필드 없음.
  // => 직접 generate queue 조회해야 하나. 복잡 → 일단 postUrl만 기준. publishing 중인 것은 포함 안 됨.
  // 대안: keyword 기준 중복 방지
  const usedKeywordsPerAcc = new Map<string, Set<string>>();
  for (const sj of prevJobs) {
    const sch = prevSchedules.find((s) => s._id === sj.scheduleId);
    if (!sch) continue;
    const acc = sch.accountId as string;
    if (!usedKeywordsPerAcc.has(acc)) usedKeywordsPerAcc.set(acc, new Set());
    usedKeywordsPerAcc.get(acc)!.add(sj.keyword as string);
  }

  // 각 계정별로 최신 posts fetch → 최신 PER_ACCOUNT matched 글 선정 (used 제외)
  interface Target {
    accountId: string; password: string; blogId: string; nickname: string;
    logNo: string; oldTitle: string; oldKeyword: string; newKeyword: string;
  }
  const targets: Target[] = [];

  // 원고 준비된 키워드 풀
  const readyKws = new Set<string>();
  for (const kw of keywords) {
    if (existsSync(`/tmp/goat-manuscript-${kw}.json`)) readyKws.add(kw);
  }
  console.log(`원고 준비된 키워드: ${readyKws.size}/${keywords.length}\n`);

  const usedNewKwGlobal = new Set<string>();

  for (const acc of accs) {
    const accountId = acc.accountId as string;
    const blogId = (acc.blogId as string) || accountId;
    const nickname = (acc.nickname as string) || accountId;
    const password = acc.password as string;

    const posts = await fetchLatestPosts(blogId, 30);
    const matched = posts
      .map((p) => ({ ...p, oldKeyword: matchKeyword(p.title, keywords) }))
      .filter((p): p is PostItem & { oldKeyword: string } => p.oldKeyword !== null);

    const usedKwsInAcc = usedKeywordsPerAcc.get(accountId) ?? new Set<string>();
    const usedLogNosInAcc = new Set<string>(); // 이번 호출 내 중복 방지용

    console.log(`[${nickname}] 최신 matched ${matched.length}개, 이미 처리된 키워드 ${usedKwsInAcc.size}개`);

    let picked = 0;
    let lastRoot: string | null = null;
    const accTargets: Target[] = [];
    const candidateKws = [...readyKws].filter((k) => !usedKwsInAcc.has(k) && !usedNewKwGlobal.has(k));

    for (const post of matched) {
      if (picked >= PER_ACCOUNT) break;
      if (usedLogNosInAcc.has(post.logNo)) continue;

      // 이 logNo가 이미 처리됐는지(postUrl 매칭) 확인
      let alreadyDone = false;
      for (const j of prevJobs) {
        const sch = prevSchedules.find((s) => s._id === j.scheduleId);
        if (!sch || sch.accountId !== accountId) continue;
        if (j.postUrl && (j.postUrl as string).includes(`/${post.logNo}`)) {
          alreadyDone = true; break;
        }
      }
      if (alreadyDone) {
        console.log(`    스킵(이미 수정): ${post.logNo} "${post.title.slice(0, 30)}"`);
        picked += 1; // 카운트 포함
        continue;
      }

      // 새 키워드 고르기 (루트 충돌/중복 방지)
      const oldRoot = extractRoot(post.oldKeyword);
      let chosen: string | null = null;
      for (let i = 0; i < candidateKws.length; i += 1) {
        const cand = candidateKws[i];
        const r = extractRoot(cand);
        if (r === oldRoot) continue;
        if (r === lastRoot) continue;
        if (normalize(cand) === normalize(post.oldKeyword)) continue;
        chosen = cand;
        candidateKws.splice(i, 1);
        break;
      }
      if (!chosen) {
        console.log(`    키워드 부족: ${post.logNo}`);
        picked += 1;
        continue;
      }
      usedNewKwGlobal.add(chosen);
      usedLogNosInAcc.add(post.logNo);
      lastRoot = extractRoot(chosen);

      accTargets.push({
        accountId, password, blogId, nickname,
        logNo: post.logNo, oldTitle: post.title, oldKeyword: post.oldKeyword, newKeyword: chosen,
      });
      picked += 1;
    }

    console.log(`  선정 ${accTargets.length}개 (실제 신규 enqueue)`);
    targets.push(...accTargets);
    await sleep(500);
  }

  console.log(`\n총 신규 enqueue: ${targets.length}개\n`);
  if (targets.length === 0) { await mongoose.disconnect(); return; }

  const scheduleDate = format(new Date(), 'yyyy-MM-dd');
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const startBase = Date.now() + 60 * 1000;
  const accOffset = new Map<string, number>();

  for (const t of targets) {
    const msPath = `/tmp/goat-manuscript-${t.newKeyword}.json`;
    const ms = JSON.parse(readFileSync(msPath, 'utf-8'));
    const jobDir = createJobDir(t.newKeyword);

    const offset = accOffset.get(t.accountId) ?? 0;
    accOffset.set(t.accountId, offset + 1);
    const scheduledAt = new Date(startBase + offset * 60 * 1000).toISOString();

    const schedule = await ScheduleModel.create({
      accountId: t.accountId, service: 'modify-goat-top10', ref: '', scheduleDate,
      generateImages: true, imageCount: 5, delayBetweenPostsSeconds: 10,
      totalJobs: 1, status: 'pending',
    });
    const scheduleJob = await ScheduleJobModel.create({
      scheduleId: schedule._id, keyword: t.newKeyword, category: '한려담원',
      scheduledAt, slot: 1, status: 'pending',
    });

    const safeAcc = t.accountId.replace(/[^a-zA-Z0-9]/g, '_');
    const queue = new Queue(`generate_${safeAcc}`, { connection });
    const job = await queue.add('generate', {
      scheduleId: schedule._id, scheduleJobId: scheduleJob._id,
      keyword: t.newKeyword, category: '한려담원',
      account: { id: t.accountId, password: t.password, blogId: t.blogId },
      service: 'modify-goat-top10', ref: '',
      generateImages: true, imageCount: 5, imageSource: 'product',
      manuscriptType: 'hanryeodamwon', delayBetweenPostsSeconds: 10,
      scheduledAt, mode: 'update', logNo: t.logNo,
      keywordCategory: '한려담원', blogName: t.nickname,
      providedManuscript: { title: ms.title, content: ms.content },
    }, {
      delay: Math.max(0, new Date(scheduledAt).getTime() - Date.now()),
      attempts: 3, backoff: { type: 'exponential', delay: 30000 },
    });
    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, { generateJobId: String(job.id) });
    console.log(`  ${t.nickname.padEnd(14)} logNo=${t.logNo} kw=${t.newKeyword.padEnd(14)} at=${scheduledAt.slice(11, 19)}`);
    await queue.close();
  }

  await connection.quit();
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
