import type { Frame, Page } from 'playwright';
import { logger } from '../lib/logging/logger';
import { ProgressBar } from '../lib/utils/progress';
import {
  createSession,
  closeSession,
  getMainFrame,
  waitForFrame,
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
  insertExcludeLibraryLinks,
  insertPhone,
  uploadFromMultiImageData,
  addSpacing,
  type MultiImageData,
  type WriteResult,
} from '../lib/naver-editor';
import type { ProductMetadata, ExcludeLibraryLinkItem } from '../types/metadata';

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

interface BasePostParams {
  cookies: unknown[];
  title: string;
  content: string;
  images?: string[];
  multiImages?: MultiImageData;
  excludeLibrary?: string[];
  excludeLibraryLink?: ExcludeLibraryLinkItem[];
  category?: string;
  metadata?: ProductMetadata;
  keywordCategory?: string;
}

interface WritePostParams extends BasePostParams {
  scheduleTime?: string;
}

// ============================================================
// Common Workflows
// ============================================================

const prepareEditorForWriting = async (page: Page, frame: Frame): Promise<void> => {
  await dismissPopups(frame);
  await focusEditor(page, frame);
  await setAlignCenter(page, frame);
};

interface ClassifiedImages {
  normalImages: string[];
  excluded1?: string;
  excluded2?: string;
  excluded3?: string;
}

const classifyImages = (
  images?: string[],
  excludeLibrary?: string[],
): ClassifiedImages => {
  if (excludeLibrary?.length) {
    return {
      normalImages: images || [],
      excluded1: excludeLibrary[0],
      excluded2: excludeLibrary[1],
      excluded3: excludeLibrary[2],
    };
  }

  const excludedImages = findExcludedImages(images || []);
  return {
    normalImages: filterNormalImages(images || [], excludedImages),
    excluded1: excludedImages.find((e) => e.order === 1)?.path,
    excluded2: excludedImages.find((e) => e.order === 2)?.path,
    excluded3: excludedImages.find((e) => e.order === 3)?.path,
  };
};

const enterTitle = async (page: Page, frame: Frame, title: string): Promise<void> => {
  await clickTitleArea(frame);
  await page.waitForTimeout(500);
  await page.keyboard.type(title, { delay: 30 });
  await page.waitForTimeout(500);
  log.info('title.entered');

  await clickContentArea(page, frame);
  await page.waitForTimeout(500);
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
// Content Pipeline
// ============================================================

type ContentBlock = 'excluded1' | 'excluded2' | 'excluded3' | 'allExcluded' | 'maps' | 'phone' | 'content' | 'excludeLibraryLinks' | 'spacing' | 'link' | 'multiImages';

const DEFAULT_PIPELINE: ContentBlock[] = [
  'excluded1', 'maps', 'phone', 'excluded2', 'content', 'excluded3', 'link', 'multiImages',
];

const CONTENT_PIPELINES: Record<string, ContentBlock[]> = {
  default: DEFAULT_PIPELINE,
  '애견': ['excluded1', 'maps', 'phone', 'excluded2', 'content', 'excluded3', 'link'],
  '안과': ['allExcluded', 'excludeLibraryLinks', 'maps', 'spacing', 'content', 'multiImages'],
  '한려담원': ['content', 'link'],
};

const getPipeline = (keywordCategory?: string): ContentBlock[] => {
  if (keywordCategory && CONTENT_PIPELINES[keywordCategory]) {
    return CONTENT_PIPELINES[keywordCategory];
  }
  return CONTENT_PIPELINES.default;
};

interface ContentBlockContext {
  page: Page;
  frame: Frame;
  content: string;
  normalImages: string[];
  excluded1?: string;
  excluded2?: string;
  excluded3?: string;
  metadata?: ProductMetadata;
  multiImages?: MultiImageData;
  excludeLibrary?: string[];
  excludeLibraryLink?: ExcludeLibraryLinkItem[];
}

const BLOCK_EXECUTORS: Record<ContentBlock, (ctx: ContentBlockContext) => Promise<void>> = {
  excluded1: async ({ page, excluded1 }) => {
    if (!excluded1) return;
    await uploadExcludedImage(page, excluded1);
    await page.waitForTimeout(500);
    log.info('excluded.1.uploaded');
  },
  maps: async ({ page, frame, metadata }) => {
    if (!metadata?.mapQueries?.length) return;
    const result = await insertMaps(page, frame, metadata.mapQueries);
    log.info('maps.inserted', { success: result.success, failed: result.failed });
  },
  phone: async ({ page, frame, metadata }) => {
    if (!metadata?.phone) return;
    const result = await insertPhone(page, frame, metadata.phone);
    log.info('phone.inserted', { success: result, phone: metadata.phone });
  },
  excluded2: async ({ page, excluded2 }) => {
    if (!excluded2) return;
    await uploadExcludedImage(page, excluded2);
    await page.waitForTimeout(500);
    log.info('excluded.2.uploaded');
  },
  content: async ({ page, frame, content, normalImages }) => {
    await typeContentWithImages(page, frame, content, normalImages);
    log.info('content.entered');
  },
  excluded3: async ({ page, excluded3 }) => {
    if (!excluded3) return;
    await uploadExcludedImage(page, excluded3);
    await page.waitForTimeout(500);
    log.info('excluded.3.uploaded');
  },
  allExcluded: async ({ page, excludeLibrary }) => {
    if (!excludeLibrary?.length) return;
    for (const imagePath of excludeLibrary) {
      await uploadExcludedImage(page, imagePath);
      await page.waitForTimeout(500);
    }
    log.info('allExcluded.uploaded', { count: excludeLibrary.length });
  },
  spacing: async ({ page }) => {
    await addSpacing(page);
  },
  excludeLibraryLinks: async ({ page, frame, excludeLibraryLink }) => {
    if (!excludeLibraryLink?.length) return;
    const result = await insertExcludeLibraryLinks(page, frame, excludeLibraryLink);
    log.info('excludeLibraryLinks.done', result);
  },
  link: async ({ page, frame, metadata }) => {
    if (!metadata?.url) return;
    const result = await insertLink(page, frame, metadata.url);
    log.info('link.inserted', { success: result, url: metadata.url });
  },
  multiImages: async ({ page, frame, multiImages }) => {
    if (!multiImages) return;
    const result = await uploadFromMultiImageData(page, frame, multiImages);
    log.info('multiImages.uploaded', { total: result.total, success: result.success, failed: result.failed });
  },
};

const executeContentPipeline = async (ctx: ContentBlockContext, keywordCategory?: string): Promise<void> => {
  const pipeline = getPipeline(keywordCategory);
  log.info('pipeline.start', { category: keywordCategory ?? 'default', blocks: pipeline });
  for (const block of pipeline) {
    await BLOCK_EXECUTORS[block](ctx);
  }
};

// ============================================================
// Write Post
// ============================================================

export const writePost = async (params: WritePostParams): Promise<WriteResult> => {
  const { cookies, title, content, images, multiImages, excludeLibrary, excludeLibraryLink, category, scheduleTime, metadata, keywordCategory } = params;
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

    const { normalImages, excluded1, excluded2, excluded3 } = classifyImages(images, excludeLibrary);
    log.info('images.classified', { excluded: excludeLibrary?.length ?? 0, normal: normalImages.length });

    await enterTitle(page, frame, title);

    await executeContentPipeline(
      { page, frame, content, normalImages, excluded1, excluded2, excluded3, metadata, multiImages, excludeLibrary, excludeLibraryLink },
      keywordCategory
    );
    log.info(progress.step('content.entered'));

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

interface UpdatePostParams extends BasePostParams {
  blogId: string;
  logNo: string;
}

export const updatePost = async (params: UpdatePostParams): Promise<WriteResult> => {
  const { cookies, blogId, logNo, title, content, images, multiImages, excludeLibrary, excludeLibraryLink, category, metadata, keywordCategory } = params;
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

    const { normalImages, excluded1, excluded2, excluded3 } = classifyImages(images, excludeLibrary);
    log.info('images.classified', { excluded: excludeLibrary?.length ?? 0, normal: normalImages.length });

    await enterTitle(page, frame, title);

    await executeContentPipeline(
      { page, frame, content, normalImages, excluded1, excluded2, excluded3, metadata, multiImages, excludeLibrary, excludeLibraryLink },
      keywordCategory
    );
    log.info(progress.step('content.entered'));

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
  const session = await createSession(cookies);
  const { page } = session;

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
    await closeSession(session);
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
