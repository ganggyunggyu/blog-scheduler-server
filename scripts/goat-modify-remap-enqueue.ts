import 'dotenv/config';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { format } from 'date-fns';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';

const LIST_PATH = '/tmp/goat-published-list.json';
const JOBS_DIR = path.resolve(process.cwd(), 'jobs');
const DRY_RUN = process.argv.includes('--dry-run');

const SHEET_GID = '1025121967';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/1c9TJ1gETtunuCmzfzap-2lyqXj1cwzITOb1k8W4tL8c/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]; const n = text[i + 1];
    if (c === '"') {
      if (q && n === '"') { cell += '"'; i += 1; } else { q = !q; }
      continue;
    }
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

const fetchSheetKeywords = async (): Promise<string[]> => {
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

interface Item {
  accountId: string;
  password: string;
  blogId: string;
  nickname: string;
  keyword: string;
  logNo: string;
  postUrl: string;
}

const normalizeDisplayName = (nickname: string): string => {
  const compact = nickname.replace(/\s+/g, '');
  if (compact === '미식가2') return '미식가2';
  if (compact === '비밀의정원') return '비밀의정원';
  if (compact.startsWith('빨간모자앤')) return '빨간모자앤';
  return compact;
};

// 대분류 기반 루트 추출 (의미 클러스터 단위)
const getRoot = (keyword: string): string => {
  const n = keyword.replace(/\s+/g, '');
  if (/임산부|임신|산모|산후|수유부|출산/.test(n)) return '임신임산부';
  if (/수족냉증|족냉증|손발|손가락|손저림|손목|손끝|발이차|말초신경/.test(n)) return '수족냉증';
  if (/흑염소|염소즙|염소효능/.test(n)) return '흑염소';
  if (/홍삼/.test(n)) return '홍삼';
  if (/동충하초/.test(n)) return '동충하초';
  if (/만성피로/.test(n)) return '만성피로';
  if (/기력|공진단|녹용|십전대보탕|경옥고/.test(n)) return '기력';
  if (/소음인|소양인/.test(n)) return '체질';
  if (/혈압/.test(n)) return '혈압';
  if (/혈당|당뇨|당수치|당화혈색소/.test(n)) return '혈당당뇨';
  if (/콜레스테롤|중성지방|고지혈증/.test(n)) return '콜레스테롤';
  if (/당귀|감초|도라지|익모초|백출|복령|천궁|숙지황|영지|대추|아라키돈산/.test(n)) return '한약재';
  if (/간에좋|간수치/.test(n)) return '간';
  if (/관절|무릎|뼈/.test(n)) return '관절뼈';
  if (/면역/.test(n)) return '면역';
  if (/비타민|마그네슘|칼슘|칼륨|철분|엽산|오메가3|유산균/.test(n)) return '영양소';
  if (/빈혈/.test(n)) return '빈혈';
  if (/갱년기/.test(n)) return '갱년기';
  if (/남성활력|정력/.test(n)) return '남성';
  if (/소화|위염|속쓰림/.test(n)) return '소화';
  if (/혈액순환/.test(n)) return '혈액순환';
  if (/감기|독감/.test(n)) return '감기';
  if (/피로/.test(n)) return '피로';
  return n.slice(0, 2);
};

const sameRoot = (a: string, b: string): boolean => getRoot(a) === getRoot(b);

const createJobDir = (keyword: string): string => {
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2');
  const safe = keyword.replace(/[^\w가-힣]/g, '_').slice(0, 20);
  const dir = path.join(JOBS_DIR, `${ts}_${safe}_remap`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    keyword, mode: 'modify-goat-remap', createdAt: new Date().toISOString(), status: 'pending',
  }, null, 2));
  return dir;
};

const main = async () => {
  const list: Item[] = JSON.parse(readFileSync(LIST_PATH, 'utf-8'));

  // blog별 grouping + 타임라인 순 (logNo DESC = 최신 먼저)
  const byBlog = new Map<string, Item[]>();
  for (const it of list) {
    if (!byBlog.has(it.accountId)) byBlog.set(it.accountId, []);
    byBlog.get(it.accountId)!.push(it);
  }
  for (const [, arr] of byBlog) {
    arr.sort((a, b) => BigInt(b.logNo) > BigInt(a.logNo) ? 1 : -1);
  }

  // logNo 빈값/중복 제거
  for (const [accountId, posts] of byBlog) {
    const seen = new Set<string>();
    const clean: Item[] = [];
    for (const p of posts) {
      if (!p.logNo) continue;
      if (seen.has(p.logNo)) continue;
      seen.add(p.logNo);
      clean.push(p);
    }
    byBlog.set(accountId, clean);
  }

  // 시트 전체 키워드 fetch 후 기존 published 제외
  const sheetKeywords = await fetchSheetKeywords();
  const usedKws = new Set(list.map((it) => it.keyword));
  const allKeywords = sheetKeywords.filter((k) => !usedKws.has(k));
  console.log(`시트 ${sheetKeywords.length} - 기존 ${usedKws.size} = 후보 ${allKeywords.length}개`);

  // 루트별 글로벌 풀
  const poolByRoot = new Map<string, string[]>();
  for (const kw of allKeywords) {
    const r = getRoot(kw);
    if (!poolByRoot.has(r)) poolByRoot.set(r, []);
    poolByRoot.get(r)!.push(kw);
  }

  console.log('\n=== 글로벌 루트 분포 ===');
  for (const [r, kws] of [...poolByRoot.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${r}: ${kws.length}개`);
  }
  console.log('');

  // 블로그 순회 (round-robin). 각 블로그의 마지막 2개 루트 피함.
  interface Assignment { logNo: string; oldKeyword: string; newKeyword: string; item: Item }
  const remapped: Assignment[] = [];
  let totalConflicts = 0;

  const blogStates = new Map<string, { posts: Item[]; lastRoots: string[]; slotIdx: number }>();
  for (const [accId, posts] of byBlog) {
    blogStates.set(accId, { posts, lastRoots: [], slotIdx: 0 });
  }

  const maxSlot = Math.max(...[...byBlog.values()].map((p) => p.length));

  for (let i = 0; i < maxSlot; i += 1) {
    for (const [accId, state] of blogStates) {
      if (state.slotIdx >= state.posts.length) continue;
      const post = state.posts[state.slotIdx];

      // 큰 풀부터 순회, 직전 2개 루트 피함
      const sortedRoots = [...poolByRoot.entries()]
        .filter(([, kws]) => kws.length > 0)
        .sort((a, b) => b[1].length - a[1].length);

      let picked: { root: string; kw: string } | null = null;
      for (const [r, kws] of sortedRoots) {
        if (state.lastRoots.includes(r)) continue;
        picked = { root: r, kw: kws[0] };
        break;
      }
      if (!picked) {
        // 직전 2개 루트 제외하니 고를 게 없음. 직전 1개만 피함.
        for (const [r, kws] of sortedRoots) {
          if (state.lastRoots[0] === r) continue;
          picked = { root: r, kw: kws[0] };
          break;
        }
      }
      if (!picked) {
        // 그래도 없으면 강제
        const first = sortedRoots[0];
        if (first) {
          picked = { root: first[0], kw: first[1][0] };
          totalConflicts += 1;
        }
      }
      if (!picked) continue;

      // pool에서 제거
      const rootList = poolByRoot.get(picked.root)!;
      const idx = rootList.indexOf(picked.kw);
      rootList.splice(idx, 1);

      // 블로그 상태 업데이트
      state.lastRoots.unshift(picked.root);
      if (state.lastRoots.length > 2) state.lastRoots.pop();
      state.slotIdx += 1;

      remapped.push({
        logNo: post.logNo,
        oldKeyword: post.keyword,
        newKeyword: picked.kw,
        item: post,
      });
    }
  }

  console.log(`재매핑 완료: ${remapped.length}개, 강제 충돌 ${totalConflicts}건\n`);

  // 블로그별 순서 미리보기
  for (const [accountId, posts] of byBlog) {
    const nick = posts[0].nickname;
    console.log(`[${nick}]`);
    const assignmentsForAcc = remapped.filter((r) => r.item.accountId === accountId);
    for (const a of assignmentsForAcc) {
      console.log(`  logNo=${a.logNo} kw=${a.newKeyword.padEnd(16)} (이전: ${a.oldKeyword})`);
    }
  }

  // plan 저장 (항상, missing 체크 전에)
  writeFileSync('/tmp/goat-remap-plan.json', JSON.stringify(remapped.map((a) => ({
    accountId: a.item.accountId,
    password: a.item.password,
    blogId: a.item.blogId,
    nickname: a.item.nickname,
    normalizedBlogName: normalizeDisplayName(a.item.nickname),
    logNo: a.logNo,
    oldKeyword: a.oldKeyword,
    newKeyword: a.newKeyword,
  })), null, 2));

  if (DRY_RUN) {
    console.log('\n[DRY RUN] plan 저장: /tmp/goat-remap-plan.json');
    return;
  }

  // 원고 존재 여부 (enqueue 모드만 체크)
  const missing = remapped.filter((a) => !existsSync(`/tmp/goat-manuscript-${a.newKeyword}.json`));
  if (missing.length > 0) {
    console.log(`\n원고 없는 키워드 ${missing.length}개: ${missing.map((m) => m.newKeyword).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n전부 원고 준비됨. enqueue 시작.\n`);

  await mongoose.connect(process.env.MONGO_URI!);
  const scheduleDate = format(new Date(), 'yyyy-MM-dd');
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const startBase = Date.now() + 60 * 1000;
  const accOffset = new Map<string, number>();

  for (const a of remapped) {
    const ms = JSON.parse(readFileSync(`/tmp/goat-manuscript-${a.newKeyword}.json`, 'utf-8'));
    const jobDir = createJobDir(a.newKeyword);
    const offset = accOffset.get(a.item.accountId) ?? 0;
    accOffset.set(a.item.accountId, offset + 1);
    const scheduledAt = new Date(startBase + offset * 60 * 1000).toISOString();

    const schedule = await ScheduleModel.create({
      accountId: a.item.accountId, service: 'modify-goat-remap', ref: '', scheduleDate,
      generateImages: true, imageCount: 5, delayBetweenPostsSeconds: 10,
      totalJobs: 1, status: 'pending',
    });
    const scheduleJob = await ScheduleJobModel.create({
      scheduleId: schedule._id, keyword: a.newKeyword, category: '한려담원',
      scheduledAt, slot: 1, status: 'pending',
    });

    const safeAcc = a.item.accountId.replace(/[^a-zA-Z0-9]/g, '_');
    const queue = new Queue(`generate_${safeAcc}`, { connection });
    const job = await queue.add('generate', {
      scheduleId: schedule._id, scheduleJobId: scheduleJob._id,
      keyword: a.newKeyword, category: '한려담원',
      account: { id: a.item.accountId, password: a.item.password, blogId: a.item.blogId },
      service: 'modify-goat-remap', ref: '',
      generateImages: true, imageCount: 5, imageSource: 'product',
      manuscriptType: 'hanryeodamwon', delayBetweenPostsSeconds: 10,
      scheduledAt, mode: 'update', logNo: a.logNo,
      keywordCategory: '한려담원',
      blogName: normalizeDisplayName(a.item.nickname), // ★ UTM 매칭용 정제
      providedManuscript: { title: ms.title, content: ms.content },
    }, {
      delay: Math.max(0, new Date(scheduledAt).getTime() - Date.now()),
      attempts: 3, backoff: { type: 'exponential', delay: 30000 },
    });
    await ScheduleJobModel.findByIdAndUpdate(scheduleJob._id, { generateJobId: String(job.id) });
    await queue.close();
  }

  console.log(`\n${remapped.length}개 enqueue 완료`);
  await connection.quit();
  await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
