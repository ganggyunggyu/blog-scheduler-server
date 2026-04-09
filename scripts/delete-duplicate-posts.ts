import 'dotenv/config';
import mongoose from 'mongoose';
import type { Page, Frame } from 'playwright';
import { naverLogin } from '../src/services/naver-auth.service.js';
import {
  createSession,
  closeSession,
  waitForFrame,
} from '../src/lib/naver-editor/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TODAY_STR = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const ACCOUNTS_KEYWORDS: Record<string, string[]> = {
  olgdmp9921: ['공진단효능', '콜레스테롤수치낮추는음식'],
  yenalk: ['소음인특징', '만성피로해결'],
  eytkgy5500: ['흑염소진액효능', '고혈압에좋은음식'],
  uqgidh2690: ['임산부유산균', '기립성저혈압증상'],
  '4giccokx': ['갱년기영양제', '관절에좋은영양제'],
  umhu0m83: ['면역력높이는영양제', '소화불량원인'],
  dhtksk1p: ['동충하초효능', '혈당낮추는음식'],
  regular14631: ['빈혈영양제', '뼈에좋은영양제'],
};

interface PostInfo {
  logNo: string;
  title: string;
  keyword: string;
}

const extractTag = (xml: string, tag: string): string => {
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  if (cdata) return cdata[1].trim();
  const plain = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return plain ? plain[1].trim() : '';
};

const getTodayPosts = async (blogId: string, keywords: string[]): Promise<PostInfo[]> => {
  const res = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const xml = await res.text();
  const posts: PostInfo[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = extractTag(item, 'title');
    const link = extractTag(item, 'link');
    const pubDate = extractTag(item, 'pubDate');
    const d = new Date(pubDate);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (dateStr !== TODAY_STR) continue;
    const logNoMatch = link.match(/\/(\d{10,})/);
    if (!logNoMatch) continue;

    const norm = title.replace(/\s/g, '').toLowerCase();
    const matchedKw = keywords.find((kw) => norm.includes(kw.replace(/\s/g, '').toLowerCase()));
    if (matchedKw) {
      posts.push({ logNo: logNoMatch[1], title, keyword: matchedKw });
    }
  }
  return posts;
};

const pickDuplicatesToDelete = (posts: PostInfo[]): PostInfo[] => {
  const groups = new Map<string, PostInfo[]>();
  for (const p of posts) {
    const existing = groups.get(p.keyword) || [];
    existing.push(p);
    groups.set(p.keyword, existing);
  }

  const toDelete: PostInfo[] = [];
  for (const [kw, group] of groups) {
    if (group.length > 1) {
      group.sort((a, b) => Number(b.logNo) - Number(a.logNo));
      toDelete.push(...group.slice(1));
    }
  }
  return toDelete;
};

const deletePost = async (page: Page, blogId: string, logNo: string): Promise<boolean> => {
  await page.goto(`https://blog.naver.com/${blogId}/${logNo}`, {
    waitUntil: 'load',
    timeout: 60000,
  });
  await sleep(5000);

  const frame = await waitForFrame(page, 'mainFrame', 30000);
  await sleep(2000);

  const result = await frame.evaluate(() => {
    window.confirm = () => true;

    const menuBtn = document.querySelector(
      'button._open_overflowmenu, a._open_overflowmenu, [class*="_open_overflowmenu"]',
    ) as HTMLElement;
    if (!menuBtn) return 'no-menu';
    menuBtn.click();

    const deleteBtn = document.querySelector('a.btn_del._deletePost') as HTMLElement;
    if (!deleteBtn) return 'no-del';
    deleteBtn.click();

    return 'ok';
  });

  if (result !== 'ok') return false;

  await page.waitForURL('**/blog.naver.com/**', { timeout: 15000 }).catch(() => {});
  await sleep(3000);
  return true;
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const db = mongoose.connection.useDb('cafe-bot');
  const col = db.collection('accounts');

  console.log(`=== 중복 글 삭제 (${TODAY_STR}) ===`);
  console.log(`기준: 각 키워드 그룹에서 1개만 유지, 나머지 삭제\n`);

  let totalDeleted = 0;
  let totalTarget = 0;

  for (const [accountId, keywords] of Object.entries(ACCOUNTS_KEYWORDS)) {
    const doc = await col.findOne({ accountId });
    if (!doc) continue;

    const blogId = (doc.blogId as string) || accountId;
    const nickname = (doc.nickname as string) || accountId;

    console.log(`[${nickname}] (${accountId})`);

    const todayPosts = await getTodayPosts(blogId, keywords);
    console.log(`  매칭된 글: ${todayPosts.length}개`);

    const toDelete = pickDuplicatesToDelete(todayPosts);
    console.log(`  삭제 대상: ${toDelete.length}개`);
    totalTarget += toDelete.length;

    if (toDelete.length === 0) {
      console.log(`  스킵 (중복 없음)`);
      continue;
    }

    for (const p of toDelete) {
      console.log(`    삭제 → "${p.title.substring(0, 40)}" [${p.keyword}] (${p.logNo})`);
    }

    const login = await naverLogin(accountId, doc.password as string);
    if (!login.success) {
      console.log(`  로그인 실패`);
      continue;
    }
    console.log(`  로그인 OK`);

    const session = await createSession(login.cookies);
    try {
      for (const post of toDelete) {
        const ok = await deletePost(session.page, blogId, post.logNo);
        if (ok) {
          totalDeleted++;
          console.log(`    ✓ 삭제 완료 (${post.logNo})`);
        } else {
          console.log(`    ✗ 삭제 실패 (${post.logNo})`);
        }
        await sleep(2000);
      }
    } finally {
      await closeSession(session);
    }

    await sleep(3000);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`결과: ${totalDeleted}/${totalTarget} 삭제`);
  console.log('='.repeat(50));

  await mongoose.disconnect();
  process.exit(totalDeleted === totalTarget ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
