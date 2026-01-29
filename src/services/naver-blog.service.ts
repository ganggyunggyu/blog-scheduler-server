import type { Frame, Page } from 'playwright';
import { logger } from '../lib/logging/logger';
import { ProgressBar } from '../lib/utils/progress';
import {
  createSession,
  closeSession,
  getMainFrame,
  dismissPopups,
  focusEditor,
  setAlignCenter,
  clearAllContent,
  typeContentWithImages,
  openPublishDialog,
  selectCategory,
  setPublicVisibility,
  confirmPublish,
  setScheduleTime,
  clickTitleArea,
  clickContentArea,
  findExcludedImages,
  filterNormalImages,
  uploadExcludedImage,
  insertMaps,
  insertLink,
  insertPhone,
} from '../lib/naver-editor';
import type { ProductMetadata } from '../types/metadata';
import { getBrowser } from '../lib/browser/playwright';

const log = logger.child({ scope: 'NaverBlog' });

// ============================================================
// Login Check
// ============================================================

const isLoginPage = (url: string): boolean => {
  return url.includes('nid.naver.com') || url.includes('nidlogin');
};

const checkLoginStatus = (page: Page): { loggedIn: boolean; redirectedUrl?: string } => {
  const currentUrl = page.url();
  if (isLoginPage(currentUrl)) {
    return { loggedIn: false, redirectedUrl: currentUrl };
  }
  return { loggedIn: true };
};

// ============================================================
// Types
// ============================================================

interface WritePostParams {
  cookies: unknown[];
  title: string;
  content: string;
  images?: string[];
  category?: string;
  scheduleTime?: string;
  metadata?: ProductMetadata;
}

interface WriteResult {
  success: boolean;
  postUrl?: string;
  message: string;
}

// ============================================================
// Common Workflows
// ============================================================

const prepareEditorForWriting = async (page: Page, frame: Frame): Promise<void> => {
  await dismissPopups(frame);
  await focusEditor(page, frame);
  await setAlignCenter(page, frame);
};

const handlePublishDialog = async (
  page: Page,
  frame: Frame,
  options: { category?: string; scheduleTime?: string }
): Promise<string> => {
  await openPublishDialog(page, frame);

  if (options.category) {
    await selectCategory(page, frame, options.category);
  }

  await setPublicVisibility(page, frame);

  if (options.scheduleTime) {
    const scheduleDate = new Date(options.scheduleTime);
    log.info('schedule.time', { scheduleTime: options.scheduleTime, parsed: scheduleDate.toISOString() });
    await setScheduleTime(page, frame, scheduleDate);
  }

  return confirmPublish(page, frame);
};

// ============================================================
// Write Post
// ============================================================

export const writePost = async (params: WritePostParams): Promise<WriteResult> => {
  const { cookies, title, content, images, category, scheduleTime, metadata } = params;
  const progress = new ProgressBar({ label: 'publish', total: 5, width: 14 });

  const session = await createSession(cookies);
  const { page } = session;

  try {
    const url = 'https://blog.naver.com/GoBlogWrite.naver';
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    log.info(progress.step('page.open'), { url });

    const loginStatus = checkLoginStatus(page);
    if (!loginStatus.loggedIn) {
      log.warn('session.expired', { redirectedUrl: loginStatus.redirectedUrl });
      return { success: false, message: '세션이 만료되었습니다. 재로그인이 필요합니다.' };
    }

    const frame = await getMainFrame(page);
    await page.waitForTimeout(2000);

    await prepareEditorForWriting(page, frame);
    log.info(progress.step('editor.ready'));

    // 라이브러리제외 이미지 분류
    const excludedImages = findExcludedImages(images || []);
    const normalImages = filterNormalImages(images || [], excludedImages);
    const excluded1 = excludedImages.find((e) => e.order === 1)?.path;
    const excluded2 = excludedImages.find((e) => e.order === 2)?.path;
    const excluded3 = excludedImages.find((e) => e.order === 3)?.path;
    log.info('images.classified', {
      excluded: excludedImages.length,
      normal: normalImages.length,
    });

    // 제목 입력
    await clickTitleArea(frame);
    await page.waitForTimeout(500);
    await page.keyboard.type(title, { delay: 30 });
    await page.waitForTimeout(500);
    log.info('title.entered');

    // 본문으로 이동
    await clickContentArea(page, frame);
    await page.waitForTimeout(500);

    // 라이브러리제외_1 업로드 (클립보드 방식)
    if (excluded1) {
      await uploadExcludedImage(page, excluded1);
      await page.waitForTimeout(500);
      log.info('excluded.1.uploaded');
    }

    // 지도 삽입
    if (metadata?.mapQueries?.length) {
      const mapResult = await insertMaps(page, frame, metadata.mapQueries);
      log.info('maps.inserted', { success: mapResult.success, failed: mapResult.failed });
    }

    // 전화번호 삽입
    if (metadata?.phone) {
      const phoneResult = await insertPhone(page, frame, metadata.phone);
      log.info('phone.inserted', { success: phoneResult, phone: metadata.phone });
    }

    // 라이브러리제외_2 업로드 (클립보드 방식)
    if (excluded2) {
      await uploadExcludedImage(page, excluded2);
      await page.waitForTimeout(500);
      log.info('excluded.2.uploaded');
    }

    // 본문 + 일반 이미지 입력
    await typeContentWithImages(page, frame, content, normalImages);
    log.info(progress.step('content.entered'));

    // 라이브러리제외_3 업로드 (클립보드 방식)
    if (excluded3) {
      await uploadExcludedImage(page, excluded3);
      await page.waitForTimeout(500);
      log.info('excluded.3.uploaded');
    }

    // URL 링크 삽입
    if (metadata?.url) {
      const linkResult = await insertLink(page, frame, metadata.url);
      log.info('link.inserted', { success: linkResult, url: metadata.url });
    }

    // 가운데 정렬 (발행 전)
    await setAlignCenter(page, frame);
    await page.waitForTimeout(500);

    log.info(progress.step('publish.dialog'));
    const postUrl = await handlePublishDialog(page, frame, { category, scheduleTime });
    log.info(progress.done('publish.done'), { postUrl });

    return { success: true, postUrl, message: 'Publish success' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publish failed';
    log.error('publish.failed', { message });
    return { success: false, message };
  } finally {
    await closeSession(session);
  }
};

// ============================================================
// Update Post
// ============================================================

interface UpdatePostParams {
  cookies: unknown[];
  blogId: string;
  logNo: string;
  title: string;
  content: string;
  images?: string[];
  category?: string;
  metadata?: ProductMetadata;
}

export const updatePost = async (params: UpdatePostParams): Promise<WriteResult> => {
  const { cookies, blogId, logNo, title, content, images, category, metadata } = params;
  const progress = new ProgressBar({ label: 'update', total: 6, width: 14 });

  const session = await createSession(cookies);
  const { page } = session;

  try {
    const url = `https://blog.naver.com/${blogId}?Redirect=Update&logNo=${logNo}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    log.info(progress.step('page.open'), { url, logNo });

    const loginStatus = checkLoginStatus(page);
    if (!loginStatus.loggedIn) {
      log.warn('session.expired', { redirectedUrl: loginStatus.redirectedUrl, logNo });
      return { success: false, message: '세션이 만료되었습니다. 재로그인이 필요합니다.' };
    }

    const frame = await getMainFrame(page);
    await page.waitForTimeout(2000);

    await dismissPopups(frame);
    await focusEditor(page, frame);
    log.info(progress.step('editor.ready'));

    await clearAllContent(page, frame);
    log.info(progress.step('content.cleared'));

    // 라이브러리제외 이미지 분류
    const excludedImages = findExcludedImages(images || []);
    const normalImages = filterNormalImages(images || [], excludedImages);
    const excluded1 = excludedImages.find((e) => e.order === 1)?.path;
    const excluded2 = excludedImages.find((e) => e.order === 2)?.path;
    const excluded3 = excludedImages.find((e) => e.order === 3)?.path;
    log.info('images.classified', {
      excluded: excludedImages.length,
      normal: normalImages.length,
    });

    // 제목 입력
    await clickTitleArea(frame);
    await page.waitForTimeout(500);
    await page.keyboard.type(title, { delay: 30 });
    await page.waitForTimeout(500);
    log.info('title.entered');

    // 본문으로 이동
    await clickContentArea(page, frame);
    await page.waitForTimeout(500);

    // 라이브러리제외_1 업로드 (클립보드 방식)
    if (excluded1) {
      await uploadExcludedImage(page, excluded1);
      await page.waitForTimeout(500);
      log.info('excluded.1.uploaded');
    }

    // 지도 삽입
    if (metadata?.mapQueries?.length) {
      const mapResult = await insertMaps(page, frame, metadata.mapQueries);
      log.info('maps.inserted', { success: mapResult.success, failed: mapResult.failed });
    }

    // 전화번호 삽입
    if (metadata?.phone) {
      const phoneResult = await insertPhone(page, frame, metadata.phone);
      log.info('phone.inserted', { success: phoneResult, phone: metadata.phone });
    }

    // 라이브러리제외_2 업로드 (클립보드 방식)
    if (excluded2) {
      await uploadExcludedImage(page, excluded2);
      await page.waitForTimeout(500);
      log.info('excluded.2.uploaded');
    }

    // 본문 + 일반 이미지 입력
    log.info('content.typing', { titlePreview: title.slice(0, 30), lines: content.split('\n').length });
    await typeContentWithImages(page, frame, content, normalImages);
    log.info(progress.step('content.entered'));

    // 라이브러리제외_3 업로드 (클립보드 방식)
    if (excluded3) {
      await uploadExcludedImage(page, excluded3);
      await page.waitForTimeout(500);
      log.info('excluded.3.uploaded');
    }

    // URL 링크 삽입
    if (metadata?.url) {
      const linkResult = await insertLink(page, frame, metadata.url);
      log.info('link.inserted', { success: linkResult, url: metadata.url });
    }

    // 가운데 정렬 (발행 전)
    await setAlignCenter(page, frame);
    await page.waitForTimeout(500);

    log.info(progress.step('publish.dialog'));
    const postUrl = await handlePublishDialog(page, frame, { category });
    log.info(progress.done('update.done'), { postUrl, logNo });

    return { success: true, postUrl, message: 'Update success' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update failed';
    log.error('update.failed', { message, logNo });
    return { success: false, message };
  } finally {
    await closeSession(session);
  }
};

// ============================================================
// Post List Helpers
// ============================================================

interface PostListItem {
  logNo: string;
  title: string;
  index: number;
}

const waitForFrame = async (page: Page, name: string, timeout = 10000): Promise<Frame> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frame = page.frame({ name });
    if (frame) return frame;
    await page.waitForTimeout(500);
  }
  throw new Error(`Frame '${name}' not found within ${timeout}ms`);
};

const setListViewTo30 = async (
  frame: Frame,
  page: Page
): Promise<boolean> => {
  try {
    const listCountToggle = await frame.$('a._ListCountToggle');
    if (listCountToggle && (await listCountToggle.isVisible())) {
      await listCountToggle.click();
      await page.waitForTimeout(500);

      const option30 = await frame.$('a.option._returnFalse[data-value="30"]');
      if (option30) {
        await option30.click();
        await page.waitForTimeout(1000);
        log.info('postList.viewCount.set', { count: 30 });
        return true;
      }
    }
  } catch (err) {
    log.warn('postList.viewCount.failed', { error: err instanceof Error ? err.message : String(err) });
  }
  return false;
};

const collectPostsFromPage = async (
  frame: Frame,
  page: Page,
  startIndex: number
): Promise<PostListItem[]> => {
  const posts: PostListItem[] = [];

  await page.waitForTimeout(1000);

  const checkboxes = await frame.$$('input[name="logNo"]');
  log.info('collectPosts.checkboxes', { count: checkboxes.length });

  if (checkboxes.length === 0) {
    const rows = await frame.$$('tr');
    log.info('collectPosts.fallback.rows', { count: rows.length });
  }

  for (let i = 0; i < checkboxes.length; i++) {
    const checkbox = checkboxes[i];
    const logNo = await checkbox.getAttribute('value');
    if (!logNo) continue;

    const row = await checkbox.evaluateHandle((el) => el.closest('tr'));
    const linkEl = await row.asElement()?.$('a._setTopListUrl');
    const title = linkEl ? ((await linkEl.textContent()) || '').trim() : '';

    posts.push({ logNo, title, index: startIndex + i });
  }

  return posts;
};

const getVisiblePageNumbers = async (frame: Frame): Promise<number[]> => {
  const pageLinks = await frame.$$('.blog2_paginate .page, .blog2_paginate strong.page');
  const pageSet = new Set<number>();

  for (const link of pageLinks) {
    const text = await link.textContent();
    const num = parseInt(text?.trim() || '', 10);
    if (!isNaN(num)) pageSet.add(num);
  }

  return [...pageSet].sort((a, b) => a - b);
};

const hasNextPageGroup = async (frame: Frame): Promise<boolean> => {
  const nextBtn = await frame.$('a.next._goPageTop[class*="_param"]');
  return nextBtn !== null;
};

const clickNextPageGroup = async (frame: Frame, page: Page): Promise<boolean> => {
  const nextBtn = await frame.$('a.next._goPageTop[class*="_param"]');
  if (nextBtn) {
    await nextBtn.click();
    await page.waitForTimeout(1500);
    return true;
  }
  return false;
};

const clickPage = async (frame: Frame, page: Page, pageNum: number): Promise<boolean> => {
  const currentPage = await frame.$(`strong.page._goPageTop._param\\(${pageNum}\\)`);
  if (currentPage) return true;

  const pageLink = await frame.$(`a.page._goPageTop._param\\(${pageNum}\\)`);
  if (pageLink) {
    await pageLink.click();
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
};

// ============================================================
// Index All Posts
// ============================================================

export const indexAllPosts = async (
  cookies: unknown[]
): Promise<{ posts: PostListItem[]; blogId: string; totalCount: number }> => {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  await context.addCookies(cookies as any[]);
  const page = await context.newPage();

  try {
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const blogTab = await page.$('a.MyView-module__item_link___Dzbpq');
    if (blogTab) {
      await blogTab.click();
      await page.waitForTimeout(1000);
    }

    const myBlogLink = await page.$('a[href="https://blog.naver.com/MyBlog.naver"]');
    if (myBlogLink) {
      await myBlogLink.click();
      await page.waitForTimeout(3000);
    } else {
      await page.goto('https://blog.naver.com/MyBlog.naver', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    }

    const currentUrl = page.url();
    const blogIdMatch = currentUrl.match(/blog\.naver\.com\/([^/?]+)/);
    const blogId = blogIdMatch ? blogIdMatch[1] : '';
    log.info('indexAllPosts.blogId', { blogId, url: currentUrl });

    const frame = await waitForFrame(page, 'mainFrame');
    await page.waitForTimeout(1000);

    const openListBtn = await frame.$('a._toggleTopList');
    if (openListBtn && (await openListBtn.isVisible())) {
      await openListBtn.click();
      await page.waitForTimeout(1500);
      log.info('indexAllPosts.openList.clicked');
    }

    await setListViewTo30(frame, page);

    const allPosts: PostListItem[] = [];
    let globalIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const visiblePages = await getVisiblePageNumbers(frame);
      log.info('indexAllPosts.pageGroup', { pages: visiblePages });

      for (const pageNum of visiblePages) {
        const clicked = await clickPage(frame, page, pageNum);
        if (!clicked) {
          log.info('indexAllPosts.page.notFound', { pageNum });
          continue;
        }
        const pagePosts = await collectPostsFromPage(frame, page, globalIndex);
        allPosts.push(...pagePosts);
        globalIndex += pagePosts.length;
        log.info('indexAllPosts.page.done', { pageNum, collected: pagePosts.length, total: allPosts.length });
      }

      if (await hasNextPageGroup(frame)) {
        await clickNextPageGroup(frame, page);
      } else {
        hasMore = false;
      }
    }

    log.info('indexAllPosts.complete', { blogId, totalCount: allPosts.length });
    return { posts: allPosts, blogId, totalCount: allPosts.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to index posts';
    log.error('indexAllPosts.failed', { message });
    return { posts: [], blogId: '', totalCount: 0 };
  } finally {
    await context.close();
  }
};

export const getPostList = async (
  cookies: unknown[],
  count: number
): Promise<{ posts: PostListItem[]; blogId: string }> => {
  const { posts, blogId } = await indexAllPosts(cookies);
  return { posts: posts.slice(0, count), blogId };
};

export const getPostsByRange = async (
  cookies: unknown[],
  startIndex: number,
  endIndex: number
): Promise<{ posts: PostListItem[]; blogId: string }> => {
  const { posts, blogId } = await indexAllPosts(cookies);
  return { posts: posts.slice(startIndex, endIndex + 1), blogId };
};
