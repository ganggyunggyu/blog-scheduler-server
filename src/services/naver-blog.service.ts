import type { Frame, Page } from 'playwright';
import { SELECTORS } from '../constants/selectors';
import { getBrowser } from '../lib/playwright';
import { logger } from '../lib/logger';

interface WritePostParams {
  cookies: unknown[];
  title: string;
  content: string;
  images?: string[];
  scheduleTime?: Date;
}

export function shouldPublishImmediately(scheduleTime?: Date): boolean {
  if (!scheduleTime) return true;
  return scheduleTime.getTime() <= Date.now();
}

async function waitForFrame(page: Page, name: string, timeout = 10000): Promise<Frame> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frame = page.frame({ name });
    if (frame) return frame;
    await page.waitForTimeout(500);
  }
  throw new Error(`Frame '${name}' not found within ${timeout}ms`);
}

async function dismissPopups(frame: Frame): Promise<void> {
  const popupSelectors = [
    SELECTORS.popup.cancel,
    SELECTORS.popup.helpClose,
    'button.se-popup-button-cancel',
    'button[class*="close"]',
  ];

  for (const selector of popupSelectors) {
    try {
      const el = await frame.$(selector);
      if (el && await el.isVisible()) {
        await el.click();
        await frame.page().waitForTimeout(300);
      }
    } catch {
      continue;
    }
  }
}

function isSubheading(line: string): boolean {
  const patterns = [
    /^\d+\.\s/,
    /^[①②③④⑤⑥⑦⑧⑨⑩]/,
    /^【\d+】/,
    /^\[\d+\]/,
    /^▶\s*\d+/,
  ];
  const trimmed = line.trim();
  return patterns.some((pattern) => pattern.test(trimmed));
}

function matchImagesToSubheadings(paragraphs: string[], images: string[]): Map<number, string> {
  const result = new Map<number, string>();
  const subheadingIndices = paragraphs
    .map((paragraph, index) => (isSubheading(paragraph) ? index : -1))
    .filter((index) => index >= 0);

  subheadingIndices.forEach((index, i) => {
    if (i < images.length) {
      result.set(index, images[i]);
    }
  });

  return result;
}

async function uploadImage(page: Page, frame: Frame, imagePath: string): Promise<boolean> {
  try {
    const imageBtn = 'button[data-name="image"], button.se-toolbar-button-image';
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      frame.click(imageBtn, { timeout: 5000 }),
    ]);
    await fileChooser.setFiles(imagePath);
    await page.waitForTimeout(2000);
    logger.info(`[WritePost] Image uploaded: ${imagePath.split('/').pop()}`);
    return true;
  } catch (error) {
    logger.warn(`[WritePost] Image upload failed: ${imagePath.split('/').pop()}`);
    return false;
  }
}

async function typeContentWithImages(
  page: Page,
  frame: Frame,
  content: string,
  images?: string[]
): Promise<void> {
  const paragraphs = content.split('\n');
  const imageMap = images?.length ? matchImagesToSubheadings(paragraphs, images) : new Map();

  const editorSelector = 'div.se-component-content, div[contenteditable="true"], p.se-text-paragraph';
  try {
    const editor = await frame.waitForSelector(editorSelector, { timeout: 5000 });
    if (editor) {
      await editor.click();
      await page.waitForTimeout(500);
    }
  } catch {
    await frame.click(SELECTORS.editor.content);
  }

  let prevWasList = false;

  for (let i = 0; i < paragraphs.length; i += 1) {
    let line = paragraphs[i].trim();

    if (line.length > 0) {
      const isList = line.startsWith('- ');
      if (isList && prevWasList) {
        line = line.slice(2);
      }
      await page.keyboard.type(line, { delay: 10 });
      prevWasList = isList;
    } else {
      prevWasList = false;
    }

    if (i < paragraphs.length - 1) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
    }

    const imagePath = imageMap.get(i);
    if (imagePath) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      await uploadImage(page, frame, imagePath);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    }
  }
}

export async function writePost(params: WritePostParams): Promise<{
  success: boolean;
  postUrl?: string;
  message: string;
}> {
  const { cookies, title, content, images, scheduleTime } = params;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  await context.addCookies(cookies as any[]);
  const page = await context.newPage();

  try {
    logger.info('[WritePost] Opening blog write page');
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' });

    const frame = await waitForFrame(page, 'mainFrame');
    logger.info('[WritePost] mainFrame found');

    await dismissPopups(frame);

    logger.info('[WritePost] Entering title');
    await frame.locator(SELECTORS.editor.title).waitFor({ state: 'visible', timeout: 10000 });
    await frame.fill(SELECTORS.editor.title, title);

    logger.info('[WritePost] Entering content');
    await typeContentWithImages(page, frame, content, images);

    logger.info('[WritePost] Opening publish dialog');
    await frame.click(SELECTORS.publish.btn);
    await page.waitForTimeout(1000);

    const publishNow = shouldPublishImmediately(scheduleTime);

    if (!publishNow && scheduleTime) {
      logger.info('[WritePost] Setting schedule time');
      await frame.click(SELECTORS.publish.scheduleRadio);
      await page.waitForTimeout(500);

      const now = new Date();
      const isSameDate =
        now.getFullYear() === scheduleTime.getFullYear() &&
        now.getMonth() === scheduleTime.getMonth() &&
        now.getDate() === scheduleTime.getDate();

      if (!isSameDate) {
        logger.info('[WritePost] Setting date via datepicker');
        await frame.click(SELECTORS.publish.dateInput, { timeout: 5000 });
        await frame.locator('.ui-datepicker-header').waitFor({ state: 'visible', timeout: 5000 });

        const monthDiff =
          (scheduleTime.getFullYear() - now.getFullYear()) * 12 +
          (scheduleTime.getMonth() - now.getMonth());

        const nextClicks = Math.max(0, monthDiff);
        const prevClicks = Math.max(0, -monthDiff);

        for (let i = 0; i < nextClicks; i += 1) {
          await frame.click(SELECTORS.publish.datepickerNextMonth, { timeout: 3000 });
          await page.waitForTimeout(300);
        }

        for (let i = 0; i < prevClicks; i += 1) {
          await frame.click(SELECTORS.publish.datepickerPrevMonth, { timeout: 3000 });
          await page.waitForTimeout(300);
        }

        const dayButtons = await frame.$$('td:not(.ui-state-disabled) button.ui-state-default');
        const targetDay = String(scheduleTime.getDate());
        for (const button of dayButtons) {
          const text = (await button.textContent())?.trim();
          if (text === targetDay) {
            await button.click();
            await page.waitForTimeout(300);
            break;
          }
        }
      }

      const hour = scheduleTime.getHours().toString().padStart(2, '0');
      const minute = (Math.floor(scheduleTime.getMinutes() / 10) * 10).toString().padStart(2, '0');
      logger.info(`[WritePost] Setting time: ${hour}:${minute}`);
      await frame.selectOption(SELECTORS.publish.hourSelect, hour);
      await frame.selectOption(SELECTORS.publish.minuteSelect, minute);
    }

    logger.info('[WritePost] Setting public visibility and confirming');
    await frame.click(SELECTORS.publish.publicRadio);
    await page.waitForTimeout(300);
    await frame.click(SELECTORS.publish.confirm);

    await page.waitForTimeout(3000);

    const postUrl = page.url();
    logger.info(`[WritePost] Completed: ${postUrl}`);

    return { success: true, postUrl, message: 'Publish success' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publish failed';
    logger.error(`[WritePost] Failed: ${message}`);
    return { success: false, message };
  } finally {
    await context.close();
  }
}
