import 'dotenv/config';
import mongoose from 'mongoose';
import type { Frame, Page } from 'playwright';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import {
  createSession,
  closeSession,
  waitForFrame,
  setAlignCenter,
  openPublishDialog,
  setPublicVisibility,
  confirmPublish,
} from '../src/lib/naver-editor/index.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { redis } from '../src/config/redis.js';

const CENTER_BLOG_IDS = ['mh8j62wm', 'dq1h3bjy'];
const TRIM_TOP_BLOG_IDS = ['nes1p2kx', 'h9ag469z'];
const MAX_RECENT_POSTS = 3;
const WAIT_AFTER_NAVIGATION_MS = 3_000;
const WAIT_AFTER_SAVE_MS = 2_000;
const ACTION = process.env.EYE_MAINTENANCE_ACTION ?? 'all';

interface AccountRecord {
  accountId?: string;
  password?: string;
  nickname?: string;
  blogId?: string;
  isActive?: boolean;
}

interface AccountInfo {
  accountId: string;
  password: string;
  nickname: string;
  blogId: string;
}

interface PostInfo {
  logNo: string;
  title: string;
}

interface PostTitleRaw {
  logNo?: string | number;
  title?: string;
}

interface TrimStats {
  removedComponents: number;
  removedParagraphs: number;
  leadingBlankParagraphsBefore: number;
  leadingBlankParagraphsAfter: number;
  firstTextPreview: string;
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const decodeTitle = (raw: string): string => {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  } catch {
    return raw.trim();
  }
};

const extractJsonArray = (text: string): unknown[] => {
  const listStart = text.indexOf('"postList":[');
  if (listStart < 0) {
    return [];
  }

  const bracketStart = text.indexOf('[', listStart);
  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;

  for (let index = bracketStart; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }

  if (end < 0) {
    return [];
  }

  const parsed = JSON.parse(text.slice(bracketStart, end)) as unknown;
  return Array.isArray(parsed) ? parsed : [];
};

const isPostTitleRaw = (value: unknown): value is PostTitleRaw => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<PostTitleRaw>;
  return record.logNo !== undefined;
};

const fetchRecentPosts = async (blogId: string): Promise<PostInfo[]> => {
  const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&viewdate=&currentPage=1&categoryNo=0&parentCategoryNo=&countPerPage=${MAX_RECENT_POSTS}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      Referer: `https://blog.naver.com/${blogId}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`최근 글 조회 실패: ${blogId} status=${response.status}`);
  }

  const rawItems = extractJsonArray(await response.text()).filter(isPostTitleRaw);
  return rawItems
    .map((item) => ({
      logNo: String(item.logNo ?? ''),
      title: decodeTitle(item.title ?? ''),
    }))
    .filter((item) => item.logNo && item.title)
    .slice(0, MAX_RECENT_POSTS);
};

const loadAccounts = async (blogIds: string[]): Promise<Map<string, AccountInfo>> => {
  await mongoose.connect(process.env.MONGO_URI ?? '');
  try {
    const records = await mongoose.connection
      .useDb('cafe-bot')
      .collection<AccountRecord>('accounts')
      .find(
        {
          $and: [
            {
              $or: [
                { isActive: { $exists: false } },
                { isActive: true },
              ],
            },
            {
              $or: [
                { blogId: { $in: blogIds } },
                { accountId: { $in: blogIds } },
              ],
            },
          ],
        },
        {
          projection: {
            _id: 0,
            accountId: 1,
            password: 1,
            nickname: 1,
            blogId: 1,
          },
        },
      )
      .toArray();

    const accounts = new Map<string, AccountInfo>();
    for (const record of records) {
      if (!record.accountId || !record.password) {
        continue;
      }

      const blogId = record.blogId?.trim() || record.accountId;
      accounts.set(blogId, {
        accountId: record.accountId,
        password: record.password,
        nickname: record.nickname?.trim() || blogId,
        blogId,
      });
    }

    const missing = blogIds.filter((blogId) => !accounts.has(blogId));
    if (missing.length > 0) {
      throw new Error(`DB 계정 없음: ${missing.join(', ')}`);
    }

    return accounts;
  } finally {
    await mongoose.disconnect();
  }
};

const isLoginPage = (url: string): boolean =>
  url.includes('nidlogin') || url.includes('nid.naver.com');

const removeEditorOverlays = async (page: Page, frame: Frame): Promise<void> => {
  await page.evaluate(() => {
    document.getElementById('personalNoticeLayer')?.remove();
    document.querySelectorAll('#personalNoticeLayer, #personalNoticeLayer .dimmed').forEach((el) => el.remove());
  }).catch(() => undefined);

  await frame.evaluate(() => {
    document.getElementById('personalNoticeLayer')?.remove();
    document.querySelectorAll('#personalNoticeLayer, #personalNoticeLayer .dimmed').forEach((el) => el.remove());
    document.querySelectorAll('.se-help-panel, .se-help-panel-dimmed, .se-popup-dim').forEach((el) => el.remove());
    document.querySelectorAll('[class*="container__"]').forEach((el) => {
      if (el.querySelector('h1')?.textContent?.includes('도움말')) {
        el.remove();
      }
    });
  }).catch(() => undefined);
};

const openEditor = async (
  cookies: unknown[],
  blogId: string,
  logNo: string,
): Promise<{ session: Awaited<ReturnType<typeof createSession>>; page: Page; frame: Frame }> => {
  const session = await createSession(cookies, blogId);
  const { page } = session;
  await page.goto(`https://blog.naver.com/${blogId}?Redirect=Update&logNo=${logNo}`, {
    waitUntil: 'load',
    timeout: 60_000,
  });
  await sleep(WAIT_AFTER_NAVIGATION_MS);

  if (isLoginPage(page.url())) {
    await closeSession(session);
    throw new Error('세션 만료');
  }

  const frame = await waitForFrame(page, 'mainFrame', 30_000);
  await frame.waitForSelector('.se-content, .se-component', { timeout: 30_000 });
  await sleep(2_000);
  await removeEditorOverlays(page, frame);

  return { session, page, frame };
};

const savePost = async (page: Page, frame: Frame): Promise<string> => {
  await removeEditorOverlays(page, frame);
  await openPublishDialog(page, frame);
  await setPublicVisibility(page, frame);
  const postUrl = await confirmPublish(page, frame);
  await sleep(WAIT_AFTER_SAVE_MS);
  return postUrl;
};

const TRIM_TOP_SPACING_SCRIPT = String.raw`
(() => {
  const normalizeText = (value) =>
    (value ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();

  const getTextComponents = () => {
    const root =
      document.querySelector('.se-main-container') ??
      document.querySelector('.se-content') ??
      document.body;

    return Array.from(root.querySelectorAll('.se-component.se-text'))
      .filter((component) => !component.closest('.se-documentTitle'));
  };

  const countLeadingBlankParagraphs = () => {
    let count = 0;
    for (const component of getTextComponents()) {
      const paragraphs = Array.from(component.querySelectorAll('p.se-text-paragraph'));
      if (paragraphs.length === 0) {
        const text = normalizeText(component.textContent);
        if (text.length > 0) {
          return count;
        }
        count += 1;
        continue;
      }

      for (const paragraph of paragraphs) {
        const text = normalizeText(paragraph.textContent);
        if (text.length > 0) {
          return count;
        }
        count += 1;
      }
    }

    return count;
  };

  const leadingBlankParagraphsBefore = countLeadingBlankParagraphs();
  let removedComponents = 0;
  let removedParagraphs = 0;
  let firstTextPreview = '';

  for (const component of getTextComponents()) {
    const paragraphs = Array.from(component.querySelectorAll('p.se-text-paragraph'));
    const firstTextIndex = paragraphs.findIndex((paragraph) => normalizeText(paragraph.textContent).length > 0);

    if (paragraphs.length === 0) {
      const text = normalizeText(component.textContent);
      if (text.length > 0) {
        firstTextPreview = text.slice(0, 80);
        break;
      }

      component.remove();
      removedComponents += 1;
      continue;
    }

    if (firstTextIndex < 0) {
      component.remove();
      removedComponents += 1;
      continue;
    }

    for (let index = 0; index < firstTextIndex; index += 1) {
      paragraphs[index].remove();
      removedParagraphs += 1;
    }

    firstTextPreview = normalizeText(paragraphs[firstTextIndex].textContent).slice(0, 80);
    break;
  }

  const changedTargets = Array.from(
    document.querySelectorAll('[contenteditable="true"], .se-main-container, .se-content')
  );
  for (const target of changedTargets) {
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return {
    removedComponents,
    removedParagraphs,
    leadingBlankParagraphsBefore,
    leadingBlankParagraphsAfter: countLeadingBlankParagraphs(),
    firstTextPreview,
  };
})()
`;

const FORCE_CENTER_SCRIPT = String.raw`
(() => {
  const root =
    document.querySelector('.se-main-container') ??
    document.querySelector('.se-content') ??
    document.body;
  const textComponents = Array.from(root.querySelectorAll('.se-component.se-text'))
    .filter((component) => !component.closest('.se-documentTitle'));
  let paragraphs = 0;
  let touched = 0;

  const firstParagraph = textComponents[0]?.querySelector('p.se-text-paragraph');
  const lastComponent = textComponents[textComponents.length - 1];
  const lastParagraphs = lastComponent ? Array.from(lastComponent.querySelectorAll('p.se-text-paragraph')) : [];
  const lastParagraph = lastParagraphs[lastParagraphs.length - 1];
  if (firstParagraph && lastParagraph) {
    firstParagraph.scrollIntoView({ behavior: 'instant', block: 'center' });
    const editable =
      firstParagraph.closest('[contenteditable="true"]') ??
      firstParagraph.closest('.se-component-content') ??
      root;
    editable.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.setStartBefore(firstParagraph);
      range.setEndAfter(lastParagraph);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('justifyCenter', false);
    }
  }

  for (const component of textComponents) {
    component.classList.remove('align_left', 'align_right', 'align_justify');
    component.classList.add('align_center');
    component.style.textAlign = 'center';

    const sections = Array.from(component.querySelectorAll('.se-section'));
    for (const section of sections) {
      section.classList.remove('se-section-align-left', 'se-section-align-right', 'se-section-align-justify');
      section.classList.add('se-section-align-center');
      section.style.textAlign = 'center';
    }

    const paragraphElements = Array.from(component.querySelectorAll('p.se-text-paragraph'));
    for (const paragraph of paragraphElements) {
      for (const className of Array.from(paragraph.classList)) {
        if (className.startsWith('se-text-paragraph-align-')) {
          paragraph.classList.remove(className);
        }
      }
      paragraph.classList.add('se-text-paragraph-align-center');
      paragraph.style.textAlign = 'center';
      paragraph.setAttribute('align', 'center');
      paragraphs += 1;
    }
  }

  const firstTextParagraph = textComponents
    .flatMap((component) => Array.from(component.querySelectorAll('p.se-text-paragraph')))
    .find((paragraph) => (paragraph.textContent ?? '').replace(/\u200b/g, '').trim().length > 0);
  const firstTextNode = firstTextParagraph
    ? document.createTreeWalker(firstTextParagraph, NodeFilter.SHOW_TEXT).nextNode()
    : null;
  if (firstTextNode) {
    firstTextNode.textContent = (firstTextNode.textContent ?? '') + '\u200b';
    touched += 1;
  }

  const changedTargets = Array.from(
    document.querySelectorAll('[contenteditable="true"], .se-main-container, .se-content')
  );
  for (const target of changedTargets) {
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return { components: textComponents.length, paragraphs, touched };
})()
`;

const trimTopSpacing = async (frame: Frame): Promise<TrimStats> =>
  frame.evaluate((scriptText) => {
    const execute = new Function(`return (${scriptText});`) as () => TrimStats;
    return execute();
  }, TRIM_TOP_SPACING_SCRIPT);

const forceCenterClasses = async (frame: Frame): Promise<{ components: number; paragraphs: number; touched: number }> =>
  frame.evaluate((scriptText) => {
    const execute = new Function(`return (${scriptText});`) as () => { components: number; paragraphs: number; touched: number };
    return execute();
  }, FORCE_CENTER_SCRIPT);

const centerAlignPost = async (
  account: AccountInfo,
  post: PostInfo,
  cookies: unknown[],
): Promise<boolean> => {
  const { session, page, frame } = await openEditor(cookies, account.blogId, post.logNo);
  try {
    const aligned = await setAlignCenter(page, frame);
    if (!aligned) {
      console.log(`    [FAIL] center ${post.logNo} 정렬 실패`);
      return false;
    }
    const forced = await forceCenterClasses(frame);

    const postUrl = await savePost(page, frame);
    console.log(`    [OK] center ${post.logNo} components=${forced.components} paragraphs=${forced.paragraphs} touched=${forced.touched} ${post.title} -> ${postUrl}`);
    return true;
  } catch (error) {
    console.log(`    [FAIL] center ${post.logNo}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    await closeSession(session);
  }
};

const trimTopSpacingPost = async (
  account: AccountInfo,
  post: PostInfo,
  cookies: unknown[],
): Promise<boolean> => {
  const { session, page, frame } = await openEditor(cookies, account.blogId, post.logNo);
  try {
    const stats = await trimTopSpacing(frame);
    if (stats.removedComponents === 0 && stats.removedParagraphs === 0) {
      console.log(`    [SKIP] trim ${post.logNo} 제거할 상단 공백 없음 before=${stats.leadingBlankParagraphsBefore}`);
      return true;
    }

    const postUrl = await savePost(page, frame);
    console.log(
      `    [OK] trim ${post.logNo} comp=${stats.removedComponents} p=${stats.removedParagraphs} before=${stats.leadingBlankParagraphsBefore} after=${stats.leadingBlankParagraphsAfter} first="${stats.firstTextPreview}" -> ${postUrl}`
    );
    return true;
  } catch (error) {
    console.log(`    [FAIL] trim ${post.logNo}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    await closeSession(session);
  }
};

const processBlog = async (
  action: 'center' | 'trim',
  account: AccountInfo,
): Promise<{ total: number; ok: number }> => {
  console.log(`\n[${action}] ${account.nickname} (${account.blogId})`);
  const posts = await fetchRecentPosts(account.blogId);
  console.log(`  recent=${posts.map((post) => post.logNo).join(', ')}`);

  const auth = await getValidCookies(account.accountId, account.password);
  let ok = 0;

  for (const post of posts) {
    const success = action === 'center'
      ? await centerAlignPost(account, post, auth.cookies)
      : await trimTopSpacingPost(account, post, auth.cookies);

    if (success) {
      ok += 1;
    }
    await sleep(2_000);
  }

  console.log(`  result=${ok}/${posts.length}`);
  return { total: posts.length, ok };
};

const main = async (): Promise<void> => {
  const shouldRunCenter = ACTION !== 'trim-only';
  const shouldRunTrim = ACTION !== 'center-only';
  const allBlogIds = [
    ...(shouldRunCenter ? CENTER_BLOG_IDS : []),
    ...(shouldRunTrim ? TRIM_TOP_BLOG_IDS : []),
  ];
  const accounts = await loadAccounts(allBlogIds);

  let total = 0;
  let ok = 0;

  if (shouldRunCenter) {
    for (const blogId of CENTER_BLOG_IDS) {
      const result = await processBlog('center', accounts.get(blogId) as AccountInfo);
      total += result.total;
      ok += result.ok;
    }
  }

  if (shouldRunTrim) {
    for (const blogId of TRIM_TOP_BLOG_IDS) {
      const result = await processBlog('trim', accounts.get(blogId) as AccountInfo);
      total += result.total;
      ok += result.ok;
    }
  }

  console.log(`\n[DONE] ${ok}/${total}`);
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => undefined);
    }
    await redis.quit().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
  });
