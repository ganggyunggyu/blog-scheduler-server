import 'dotenv/config';
import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addMinutes, format } from 'date-fns';
import { findAccountById } from '../src/constants/account-presets.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import {
  callManuscriptAPI,
  generateAndDownloadAIImages,
  prepareProductImages,
} from '../src/services/manuscript.service.js';
import { writePost } from '../src/services/naver-blog.service.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import {
  createSession,
  closeSession,
  getMainFrame,
  dismissPopups,
} from '../src/lib/naver-editor/index.js';

const ACCOUNT_ID = 'qwzx16';
const KEYWORD = '강아지';
const KEYWORD_CATEGORY = '애견';
const PHONE_TEXT = '1566-8713';
const VERIFY_EXISTING_TITLE = process.env.VERIFY_EXISTING_TITLE;
const VERIFY_EXISTING_POST_URL = process.env.VERIFY_EXISTING_POST_URL;

const HELP_CLOSE_SELECTORS = [
  'button.se-help-panel-close-button',
  'button[class*="help"][class*="close"]',
  'button[aria-label="닫기"]',
];

const RESERVE_BUTTON_SELECTORS = [
  'button.reserve_btn__Km5Xh',
  'button[class*="reserve_btn"]',
];

interface PopupCandidate {
  tag: string;
  text: string;
  href: string | null;
  className: string;
}

interface ParagraphInfo {
  text: string;
  html: string;
  textAlign: string;
  fontSize: string;
  fontWeight: string;
}

const dismissPageHelpOverlays = async (
  page: import('playwright').Page,
): Promise<void> => {
  for (const selector of HELP_CLOSE_SELECTORS) {
    const button = page.locator(selector).first();
    const count = await button.count().catch(() => 0);
    if (count === 0) {
      continue;
    }

    const visible = await button.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    await button.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(300);
  }

  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(200);
};

const preparePetData = async (
  keyword: string,
  blogId: string,
) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pet-verify-'));
  const imagesDir = path.join(tempRoot, 'images');
  await mkdir(imagesDir, { recursive: true });
  const manuscript = await callManuscriptAPI('pet', keyword, 'blog', '', KEYWORD_CATEGORY);
  const dateCode = format(new Date(), 'MMdd');
  const productData = await prepareProductImages({
    keyword,
    blogId,
    category: KEYWORD_CATEGORY,
    dateCode,
    imagesDir,
  });

  if (productData.bodyImages.length === 0) {
    productData.bodyImages = await generateAndDownloadAIImages(
      keyword,
      5,
      imagesDir,
      KEYWORD_CATEGORY,
    );
  }

  return {
    title: `[pet-verify] ${manuscript.title} ${Date.now()}`,
    content: manuscript.content,
    productData,
    tempRoot,
  };
};

const collectPopupCandidates = async (
  target: import('playwright').Page | import('playwright').Frame,
  title: string,
): Promise<PopupCandidate[]> =>
  target.evaluate((targetTitle) => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('a, button, div, span, strong, li'));
    return nodes
      .map((node) => {
        const text = node.innerText?.replace(/\s+/g, ' ').trim() ?? '';
        const nestedAnchor = node.querySelector('a');
        const href =
          node instanceof HTMLAnchorElement
            ? node.href
            : nestedAnchor instanceof HTMLAnchorElement
              ? nestedAnchor.href
              : null;

        return {
          tag: node.tagName,
          text,
          href,
          className: node.className,
        };
      })
      .filter((item) => item.text.length > 0 && item.text.includes(targetTitle))
      .slice(0, 50);
  }, title);

const getReservationEntryHref = async (
  target: import('playwright').Page | import('playwright').Frame,
  title: string,
): Promise<string | null> =>
  target.evaluate((targetTitle) => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('a, button, div, span, strong, li'));

    for (const node of nodes) {
      const text = node.innerText?.replace(/\s+/g, ' ').trim() ?? '';
      if (!text.includes(targetTitle)) {
        continue;
      }

      const directAnchor = node.closest('a');
      if (directAnchor?.href) {
        return directAnchor.href;
      }

      const childAnchor = node.querySelector('a');
      if (childAnchor instanceof HTMLAnchorElement && childAnchor.href) {
        return childAnchor.href;
      }

      const editAnchor = node.parentElement?.querySelector('a[href*="Redirect=Update"]');
      if (editAnchor instanceof HTMLAnchorElement && editAnchor.href) {
        return editAnchor.href;
      }
    }

    const fallback = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="Redirect=Update"]'));
    return fallback[0]?.href ?? null;
  }, title);

const openReservationEntry = async (
  page: import('playwright').Page,
  frame: import('playwright').Frame,
  title: string,
): Promise<{
  href: string | null;
  opened: boolean;
  pageCandidates: PopupCandidate[];
  frameCandidates: PopupCandidate[];
  pageBodyText: string;
  frameBodyText: string;
}> => {
  const [pageCandidates, frameCandidates, pageHref, frameHref, pageBodyText, frameBodyText] =
    await Promise.all([
      collectPopupCandidates(page, title),
      collectPopupCandidates(frame, title),
      getReservationEntryHref(page, title),
      getReservationEntryHref(frame, title),
      page.evaluate(() => document.body.innerText.slice(0, 4000)),
      frame.evaluate(() => document.body.innerText.slice(0, 4000)),
    ]);

  const articleButton = frame.locator('button.article_button__JNVjf').filter({ hasText: title }).first();
  const hasArticleButton = (await articleButton.count().catch(() => 0)) > 0;

  if (hasArticleButton) {
    await articleButton.click({ force: true });
    await page.waitForTimeout(5000);

    return {
      href: null,
      opened: true,
      pageCandidates,
      frameCandidates,
      pageBodyText,
      frameBodyText,
    };
  }

  const href = pageHref ?? frameHref;

  if (href) {
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  }

  return {
    href,
    opened: Boolean(href),
    pageCandidates,
    frameCandidates,
    pageBodyText,
    frameBodyText,
  };
};

const inspectSavedEditor = async (
  page: import('playwright').Page,
  title: string,
): Promise<void> => {
  await dismissPageHelpOverlays(page);
  const frame = await getMainFrame(page);
  await page.waitForTimeout(3000);
  await dismissPopups(frame);

  const paragraphInfo = await frame.evaluate(({ phoneText }) => {
    const list = Array.from(document.querySelectorAll<HTMLParagraphElement>('p.se-text-paragraph'))
      .map((paragraph) => {
        const text = paragraph.innerText?.replace(/\s+/g, ' ').trim() ?? '';
        const target = paragraph.querySelector<HTMLElement>('span, b, a') ?? paragraph;
        const style = window.getComputedStyle(target);
        const paragraphStyle = window.getComputedStyle(paragraph);

        return {
          text,
          html: paragraph.outerHTML,
          textAlign: paragraphStyle.textAlign,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      })
      .filter((item) => item.text.length > 0);

    const phone = list.find((item) => item.text.includes(phoneText)) ?? null;
    const firstContent = list.find((item) => item.text !== phoneText && !item.text.includes('전화번호')) ?? null;

    return { list, phone, firstContent };
  }, { phoneText: PHONE_TEXT });

  const screenshotPath = `/tmp/${title.replace(/[^\w가-힣-]/g, '_').slice(0, 40)}-saved.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(JSON.stringify({
    phase: 'saved-editor',
    screenshotPath,
    phone: paragraphInfo.phone,
    firstContent: paragraphInfo.firstContent,
    paragraphs: paragraphInfo.list.slice(0, 12),
  }, null, 2));
};

const clickReservationButton = async (
  page: import('playwright').Page,
): Promise<void> => {
  await dismissPageHelpOverlays(page);
  const frame = await getMainFrame(page);
  await dismissPopups(frame);

  for (const selector of RESERVE_BUTTON_SELECTORS) {
    const button = frame.locator(selector).first();
    const count = await button.count().catch(() => 0);
    if (count === 0) {
      continue;
    }

    const visible = await button.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    await button.click({ force: true });
    await page.waitForTimeout(2000);
    return;
  }

  throw new Error('reservation button not found');
};

const buildWriteUrlFromPostUrl = (postUrl: string): string => {
  const blogId = new URL(postUrl).pathname.replace(/^\/+/, '');
  if (!blogId) {
    throw new Error(`blogId not found from postUrl: ${postUrl}`);
  }

  return `https://blog.naver.com/${blogId}?Redirect=Write&`;
};

const run = async (): Promise<void> => {
  const account = findAccountById(ACCOUNT_ID);
  if (!account) {
    throw new Error('account preset not found');
  }

  const auth = await getValidCookies(account.id, account.password);

  if (VERIFY_EXISTING_TITLE && VERIFY_EXISTING_POST_URL) {
    const session = await createSession(auth.cookies);
    try {
      const { page } = session;
      await page.goto(buildWriteUrlFromPostUrl(VERIFY_EXISTING_POST_URL), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(7000);

      await clickReservationButton(page);
      const frame = await getMainFrame(page);
      const { href, opened, pageCandidates, frameCandidates, pageBodyText, frameBodyText } = await openReservationEntry(page, frame, VERIFY_EXISTING_TITLE);

      console.log(JSON.stringify({
        phase: 'reservation-entry',
        href,
        opened,
        pageCandidates,
        frameCandidates,
        pageBodyText,
        frameBodyText,
      }, null, 2));

      if (!opened) {
        throw new Error('reservation entry not opened');
      }

      await inspectSavedEditor(page, VERIFY_EXISTING_TITLE);
      return;
    } finally {
      await closeSession(session).catch(() => undefined);
      await closeBrowser().catch(() => undefined);
    }
  }

  const petData = await preparePetData(KEYWORD, account.id);
  const scheduleTime = format(addMinutes(new Date(), 80), "yyyy-MM-dd'T'HH:mm:ssxxx");

  console.log(JSON.stringify({
    phase: 'prepared',
    title: petData.title,
    bodyImages: petData.productData.bodyImages.length,
    excludeLibrary: petData.productData.excludeLibrary.length,
    metadata: petData.productData.metadata,
    scheduleTime,
  }, null, 2));

  const publishResult = await writePost({
    cookies: auth.cookies,
    title: petData.title,
    content: petData.content,
    images: petData.productData.bodyImages,
    excludeLibrary: petData.productData.excludeLibrary,
    excludeLibraryLink: petData.productData.excludeLibraryLink,
    metadata: petData.productData.metadata,
    keywordCategory: KEYWORD_CATEGORY,
    scheduleTime,
  });

  console.log(JSON.stringify({ phase: 'publish', publishResult }, null, 2));

  if (!publishResult.success) {
    throw new Error(publishResult.message);
  }

  const session = await createSession(auth.cookies);
  try {
    const { page } = session;
    await page.goto(buildWriteUrlFromPostUrl(publishResult.postUrl!), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);

    await clickReservationButton(page);
    const frame = await getMainFrame(page);
    const { href, opened, pageCandidates, frameCandidates, pageBodyText, frameBodyText } = await openReservationEntry(page, frame, petData.title);

    console.log(JSON.stringify({
      phase: 'reservation-entry',
      href,
      opened,
      pageCandidates,
      frameCandidates,
      pageBodyText,
      frameBodyText,
    }, null, 2));

    if (!opened) {
      throw new Error('reservation entry not opened');
    }

    await inspectSavedEditor(page, petData.title);
  } finally {
    await closeSession(session).catch(() => undefined);
    await closeBrowser().catch(() => undefined);
  }
};

run().catch(async (error) => {
  await closeBrowser().catch(() => undefined);
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
