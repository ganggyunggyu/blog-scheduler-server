import 'dotenv/config';
import mongoose from 'mongoose';
import type { Page } from 'playwright';
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

const SUPPLEMENT_KEYWORDS: Record<string, string[]> = {
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
}

const extractTag = (xml: string, tag: string): string => {
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  if (cdata) return cdata[1].trim();
  const plain = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return plain ? plain[1].trim() : '';
};

const getTodayPosts = async (blogId: string): Promise<PostInfo[]> => {
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
    if (dateStr === TODAY_STR) {
      const logNoMatch = link.match(/\/(\d{10,})/);
      if (logNoMatch) posts.push({ logNo: logNoMatch[1], title });
    }
  }
  return posts;
};

const findSupplementPosts = (posts: PostInfo[], keywords: string[]): PostInfo[] =>
  posts.filter((p) => {
    const norm = p.title.replace(/\s/g, '').toLowerCase();
    return keywords.some((kw) => norm.includes(kw.replace(/\s/g, '').toLowerCase()));
  });

const deletePost = async (page: Page, blogId: string, logNo: string, title: string): Promise<boolean> => {
  try {
    page.once('dialog', (dialog) => { dialog.accept().catch(() => {}); });

    await page.goto(`https://blog.naver.com/${blogId}/${logNo}`, {
      waitUntil: 'load',
      timeout: 60000,
    });
    await sleep(5000);

    const frame = await waitForFrame(page, 'mainFrame', 30000);
    await sleep(2000);

    const deleted = await frame.evaluate(() => {
      const btns = document.querySelectorAll('a, button, span');
      for (const btn of btns) {
        const text = (btn.textContent || '').trim();
        if (text === '삭제' || text === 'Delete') {
          (btn as HTMLElement).click();
          return 'direct';
        }
      }

      const moreBtns = document.querySelectorAll(
        'button[class*="more"], a[class*="more"], button[class*="option"], [class*="btn_more"], [class*="ico_more"]',
      );
      for (const btn of moreBtns) {
        (btn as HTMLElement).click();
        return 'more-menu';
      }
      return null;
    });

    if (deleted === 'more-menu') {
      await sleep(1000);
      await frame.evaluate(() => {
        const items = document.querySelectorAll('a, button, li, span');
        for (const item of items) {
          if ((item.textContent || '').trim() === '삭제') {
            (item as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
    }

    if (deleted) {
      await sleep(2000);

      const confirmClicked = await frame.evaluate(() => {
        const btns = document.querySelectorAll('button, a');
        for (const btn of btns) {
          const text = (btn.textContent || '').trim();
          if (text === '확인' || text === '삭제' || text === '네') {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      }).catch(() => false);

      await sleep(3000);
      console.log(`      삭제됨: "${title.substring(0, 30)}..." (${logNo})`);
      return true;
    }

    console.log(`      삭제 버튼 못 찾음 — 관리페이지로 시도`);
    return await deleteViaManagement(page, blogId, logNo, title);
  } catch (err) {
    console.log(`      에러: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
};

const deleteViaManagement = async (page: Page, blogId: string, logNo: string, title: string): Promise<boolean> => {
  try {
    page.once('dialog', (dialog) => { dialog.accept().catch(() => {}); });

    await page.goto(`https://blog.naver.com/${blogId}`, {
      waitUntil: 'load',
      timeout: 60000,
    });
    await sleep(5000);

    const frame = await waitForFrame(page, 'mainFrame', 30000);
    await page.evaluate(() => { document.getElementById('personalNoticeLayer')?.remove(); });

    const toggleBtn = await frame.$('a._toggleTopList');
    if (toggleBtn && (await toggleBtn.isVisible().catch(() => false))) {
      await toggleBtn.click();
      await sleep(2000);
    }

    const checkbox = await frame.$(`input[name="logNo"][value="${logNo}"]`);
    if (!checkbox) {
      console.log(`      관리페이지에서도 체크박스 못 찾음`);
      return false;
    }
    await checkbox.check({ force: true });
    await sleep(500);

    const deleteClicked = await frame.evaluate(() => {
      const selectors = ['a._topListDeleteBtn', 'button._topListDeleteBtn'];
      for (const sel of selectors) {
        const btn = document.querySelector(sel) as HTMLElement;
        if (btn) { btn.click(); return true; }
      }
      const btns = document.querySelectorAll('a, button');
      for (const btn of btns) {
        const text = (btn.textContent || '').trim();
        const cls = btn.className || '';
        if ((text.includes('삭제') && !text.includes('전체')) || cls.includes('delete') || cls.includes('del_btn')) {
          (btn as HTMLElement).click();
          return true;
        }
      }
      return false;
    });

    if (deleteClicked) {
      await sleep(5000);
      console.log(`      관리페이지 삭제: "${title.substring(0, 30)}..." (${logNo})`);
      return true;
    }

    console.log(`      관리페이지 삭제 버튼도 못 찾음`);
    return false;
  } catch (err) {
    console.log(`      관리 에러: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const db = mongoose.connection.useDb('cafe-bot');
  const col = db.collection('accounts');

  console.log(`=== 보충분 삭제 (${TODAY_STR}) ===\n`);

  let totalDeleted = 0;
  let totalTarget = 0;

  for (const [accountId, keywords] of Object.entries(SUPPLEMENT_KEYWORDS)) {
    const doc = await col.findOne({ accountId });
    if (!doc) { console.log(`[SKIP] ${accountId}: DB에 없음`); continue; }

    const blogId = (doc.blogId as string) || accountId;
    const password = doc.password as string;
    const nickname = (doc.nickname as string) || accountId;

    console.log(`\n[${nickname}] (${accountId})`);

    const todayPosts = await getTodayPosts(blogId);
    console.log(`  오늘 글: ${todayPosts.length}개`);

    const toDelete = findSupplementPosts(todayPosts, keywords);
    console.log(`  삭제 대상: ${toDelete.length}개`);
    totalTarget += toDelete.length;

    if (toDelete.length === 0) {
      console.log(`  스킵`);
      continue;
    }

    for (const p of toDelete) {
      console.log(`    → "${p.title.substring(0, 40)}..." (${p.logNo})`);
    }

    const login = await naverLogin(accountId, password);
    if (!login.success) {
      console.log(`  로그인 실패: ${login.message}`);
      continue;
    }
    console.log(`  로그인 OK`);

    const session = await createSession(login.cookies);

    try {
      for (const post of toDelete) {
        const ok = await deletePost(session.page, blogId, post.logNo, post.title);
        if (ok) totalDeleted++;
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
