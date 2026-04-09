import 'dotenv/config';
import type { Frame, Page } from 'playwright';
import { naverLogin } from '../src/services/naver-auth.service.js';
import {
  createSession,
  closeSession,
  waitForFrame,
} from '../src/lib/naver-editor/index.js';
import { SELECTORS } from '../src/constants/selectors.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ACCOUNTS = [
  { name: '겨울의 눈꽃', id: 'iealpx8p', pw: '2e8f5eg)' },
  { name: '라우드', id: 'loand3324', pw: 'akfalwk12!!' },
  { name: '고구마스틱', id: 'fail5644', pw: 'akfalwk12!' },
  { name: '룰루랄라', id: 'compare14310', pw: 'akfalwk12!' },
  { name: '꼬리별', id: '8i2vlbym', pw: '8wn@1i7u1' },
  { name: '하준리뷰', id: 'heavyzebra240', pw: '*!cje4@@1' },
  { name: '달달한하루', id: 'njmzdksm', pw: 'i5*wx7v11' },
  { name: '봄바람', id: 'e6yb5u4k', pw: '#ic3duzb1' },
  { name: '오늘도 즐겁게', id: 'suc4dce7', pw: '*i93h&6p1' },
  { name: '스탠드', id: 'xzjmfn3f', pw: 'ir%3(pw*1' },
  { name: '세월', id: '8ua1womn', pw: 'efe9uwk71' },
  { name: '오차즈케', id: '0ehz3cb2', pw: '8&ofp4h)1' },
  { name: '기쁨의꽃', id: 'br5rbg', pw: '49thf9gz' },
  { name: '뷰티풀', id: 'beautifulelephant274', pw: 'wn#5ze7#1' },
];

const isLoginPage = (url: string): boolean =>
  url.includes('nidlogin') || url.includes('nid.naver.com');

interface PostInfo { logNo: string; title: string; }

const removeOverlays = async (frame: Frame): Promise<void> => {
  await frame.evaluate(() => {
    document.querySelectorAll('.se-help-panel, .se-help-panel-dimmed, .se-popup-dim').forEach((el) => el.remove());
    document.querySelectorAll('[class*="container__"]').forEach((el) => {
      if (el.querySelector('h1')?.textContent?.includes('도움말')) el.remove();
    });
  });
};

const clickTextParagraph = async (frame: Frame): Promise<boolean> => {
  return frame.evaluate(() => {
    const comps = document.querySelectorAll('.se-component.se-text:not(.se-documentTitle)');
    for (const comp of comps) {
      const p = comp.querySelector('p.se-text-paragraph') as HTMLElement;
      if (p?.textContent?.trim()) {
        p.scrollIntoView({ behavior: 'instant', block: 'center' });
        p.click();
        return true;
      }
    }
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    if (editable) { editable.scrollIntoView({ behavior: 'instant', block: 'center' }); editable.focus(); editable.click(); return true; }
    return false;
  });
};

const applyCenter = async (page: Page, frame: Frame): Promise<boolean> => {
  await removeOverlays(frame);
  await sleep(500);

  const clicked = await clickTextParagraph(frame);
  if (!clicked) return false;
  await sleep(500);

  await page.keyboard.press('Meta+a');
  await sleep(500);

  const alignBtn = await frame.$(SELECTORS.editor.alignDropdown);
  if (!alignBtn) return false;
  await alignBtn.click({ force: true });
  await sleep(1000);

  const centerBtn = await frame.$(SELECTORS.editor.alignCenter);
  if (!centerBtn) return false;
  await centerBtn.click({ force: true });
  await sleep(500);
  return true;
};

const savePost = async (page: Page, frame: Frame): Promise<boolean> => {
  const publishBtn = await frame.$(SELECTORS.publish.btn);
  if (!publishBtn) return false;
  await publishBtn.click({ force: true });
  await sleep(3000);

  const publicLabel = await frame.$("label[for='open_public']");
  if (publicLabel) {
    try { await publicLabel.click({ force: true }); } catch {}
  }
  await sleep(500);

  const confirmBtn = await frame.$(SELECTORS.publish.confirm);
  if (!confirmBtn) return false;
  await confirmBtn.click({ force: true });
  await sleep(5000);
  return true;
};

const alignAndSave = async (cookies: unknown[], blogId: string, logNo: string): Promise<boolean> => {
  const session = await createSession(cookies);
  const { page } = session;

  try {
    await page.goto(`https://blog.naver.com/${blogId}?Redirect=Update&logNo=${logNo}`, {
      waitUntil: 'load', timeout: 60000,
    });
    await sleep(3000);
    if (isLoginPage(page.url())) { console.log('      세션만료'); return false; }

    const frame = await waitForFrame(page, 'mainFrame', 30000);
    await frame.waitForSelector('.se-content, .se-component', { timeout: 30000 });
    await sleep(3000);

    const aligned = await applyCenter(page, frame);
    if (!aligned) { console.log('      정렬 실패'); return false; }
    console.log('      정렬 적용');

    const saved = await savePost(page, frame);
    if (!saved) { console.log('      저장 실패'); return false; }
    console.log('      저장 완료');
    return true;
  } catch (err) {
    console.log(`      에러: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  } finally {
    await closeSession(session);
  }
};

const getRecentPosts = async (cookies: unknown[], blogId: string): Promise<PostInfo[]> => {
  const session = await createSession(cookies);
  const { page } = session;

  try {
    await page.goto(`https://blog.naver.com/${blogId}`, { waitUntil: 'load', timeout: 60000 });
    await sleep(5000);
    if (isLoginPage(page.url())) return [];

    const frame = await waitForFrame(page, 'mainFrame', 30000);
    await page.evaluate(() => { document.getElementById('personalNoticeLayer')?.remove(); });

    const openListBtn = await frame.$('a._toggleTopList');
    if (openListBtn && (await openListBtn.isVisible().catch(() => false))) {
      await openListBtn.click();
      await sleep(2000);
    }

    const posts: PostInfo[] = [];
    const checkboxes = await frame.$$('input[name="logNo"]');
    for (let i = 0; i < Math.min(checkboxes.length, 10); i++) {
      const logNo = await checkboxes[i].getAttribute('value');
      if (!logNo) continue;
      const row = await checkboxes[i].evaluateHandle((el) => el.closest('tr'));
      const linkEl = await row.asElement()?.$('a._setTopListUrl');
      const title = linkEl ? ((await linkEl.textContent()) || '').trim() : `글 ${i + 1}`;
      posts.push({ logNo, title });
    }

    if (posts.length === 0) {
      const ids = await frame.$$eval('a[href*="logNo="]', (links) => {
        const seen = new Set<string>();
        return links
          .map((a) => { const m = a.getAttribute('href')?.match(/logNo=(\d+)/); return m ? { logNo: m[1], title: a.textContent?.trim() || '' } : null; })
          .filter((p): p is { logNo: string; title: string } => p !== null && p.title.length > 2 && !seen.has(p.logNo) && (seen.add(p.logNo), true))
          .slice(0, 10);
      });
      posts.push(...ids);
    }

    return posts;
  } catch (err) {
    console.log(`    글목록 에러: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  } finally {
    await closeSession(session);
  }
};

const getScheduledPosts = async (cookies: unknown[]): Promise<PostInfo[]> => {
  const session = await createSession(cookies);
  const { page } = session;

  try {
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'load', timeout: 60000 });
    await sleep(8000);
    if (isLoginPage(page.url())) return [];

    const frame = await waitForFrame(page, 'mainFrame', 30000);
    await sleep(2000);
    await removeOverlays(frame);
    await sleep(1000);

    // 예약글 탭/버튼 찾아서 클릭
    const found = await frame.evaluate(() => {
      const els = document.querySelectorAll('button, a, span, div');
      for (const el of els) {
        const text = el.textContent?.trim() || '';
        if ((text === '예약' || text.includes('예약 글') || text.includes('예약글')) && !(el as HTMLElement).closest('.se-help-panel')) {
          (el as HTMLElement).click();
          return text;
        }
      }
      return null;
    });
    if (found) {
      console.log(`    예약 탭: "${found}"`);
      await sleep(2000);
    }

    const posts: PostInfo[] = [];
    const links = await frame.$$('a[href*="logNo="]');
    const seen = new Set<string>();
    for (const link of links) {
      const href = await link.getAttribute('href');
      const m = href?.match(/logNo=(\d+)/);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        const title = (await link.textContent())?.trim() || '';
        posts.push({ logNo: m[1], title });
      }
    }
    return posts;
  } catch (err) {
    console.log(`    예약글 에러: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  } finally {
    await closeSession(session);
  }
};

const processAccount = async (account: typeof ACCOUNTS[0]): Promise<string> => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`[${account.name}] ${account.id}`);
  console.log('='.repeat(50));

  const login = await naverLogin(account.id, account.pw);
  if (!login.success) { console.log(`  로그인 실패: ${login.message}`); return 'login_fail'; }
  console.log(`  로그인 OK`);

  // blogId 확인
  let blogId = account.id;
  const idSession = await createSession(login.cookies);
  try {
    await idSession.page.goto('https://blog.naver.com/MyBlog.naver', { waitUntil: 'load', timeout: 60000 });
    await sleep(3000);
    const m = idSession.page.url().match(/blog\.naver\.com\/([^/?]+)/);
    if (m) blogId = m[1];
  } finally { await closeSession(idSession); }

  // 최근 글
  console.log(`  [최근 글]`);
  const posts = await getRecentPosts(login.cookies, blogId);
  console.log(`  ${posts.length}개 발견`);
  let ok = 0;
  for (const p of posts) {
    console.log(`    "${p.title}" (${p.logNo})`);
    if (await alignAndSave(login.cookies, blogId, p.logNo)) ok++;
    await sleep(2000);
  }
  console.log(`  정렬: ${ok}/${posts.length}`);

  // 예약 글
  console.log(`  [예약 글]`);
  const scheduled = await getScheduledPosts(login.cookies);
  if (scheduled.length === 0) {
    console.log(`  없음`);
  } else {
    console.log(`  ${scheduled.length}개 발견`);
    let sok = 0;
    for (const p of scheduled) {
      console.log(`    예약: "${p.title}" (${p.logNo})`);
      if (await alignAndSave(login.cookies, blogId, p.logNo)) sok++;
      await sleep(2000);
    }
    console.log(`  정렬: ${sok}/${scheduled.length}`);
  }

  return 'ok';
};

const main = async () => {
  console.log('=== 가운데정렬 자동화 ===');
  console.log(`${ACCOUNTS.length}개 계정\n`);

  const results: { name: string; status: string }[] = [];
  for (const acc of ACCOUNTS) {
    try {
      results.push({ name: acc.name, status: await processAccount(acc) });
    } catch (err) {
      results.push({ name: acc.name, status: `error: ${err instanceof Error ? err.message : String(err)}` });
    }
    await sleep(3000);
  }

  console.log('\n' + '='.repeat(50));
  console.log('결과:');
  for (const r of results) console.log(`  [${r.status === 'ok' ? 'OK' : 'FAIL'}] ${r.name}`);
  console.log('='.repeat(50));
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
