import type { Frame, Page } from 'playwright';
import { SELECTORS } from '../../constants/selectors.js';
import { logger } from '../logging/logger.js';

const log = logger.child({ scope: 'Editor' });

export const focusEditor = async (page: Page, frame: Frame): Promise<void> => {
  const editorSelector = 'div.se-component-content, div[contenteditable="true"], p.se-text-paragraph';
  try {
    const editor = await frame.waitForSelector(editorSelector, { timeout: 10000 });
    if (editor) {
      await editor.click();
      await page.waitForTimeout(500);
    }
  } catch {
    log.warn('editor.focus.fallback');
    await frame.click(SELECTORS.editor.content);
  }
};

export const setAlignCenter = async (page: Page, frame: Frame): Promise<boolean> => {
  try {
    // 전체 선택
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(300);

    const alignBtn = await frame.$(SELECTORS.editor.alignDropdown);
    if (alignBtn && (await alignBtn.isVisible())) {
      await alignBtn.click();
      await page.waitForTimeout(500);
      await frame.waitForSelector(SELECTORS.editor.alignCenter, { timeout: 3000 });
      await frame.click(SELECTORS.editor.alignCenter);
      await page.waitForTimeout(300);
      log.info('align.center.set');
      return true;
    }
  } catch {
    log.warn('align.center.failed');
  }
  return false;
};

export const clickTitleArea = async (frame: Frame): Promise<void> => {
  const placeholder = await frame.$('span.se-placeholder.__se_placeholder');
  if (placeholder && (await placeholder.isVisible())) {
    await placeholder.click();
    return;
  }

  const titleText = await frame.$('div.se-title-text p.se-text-paragraph');
  if (titleText && (await titleText.isVisible())) {
    await titleText.click();
    return;
  }

  await frame.click(SELECTORS.editor.content);
};

export const clickContentArea = async (page: Page, frame: Frame): Promise<void> => {
  const allTextComponents = await frame.$$('.se-component.se-text');
  for (const component of allTextComponents) {
    const isTitle = await component.evaluate((el) => el.closest('.se-documentTitle') !== null);
    if (isTitle) continue;

    const paragraph = await component.$('p.se-text-paragraph');
    if (paragraph && (await paragraph.isVisible())) {
      await paragraph.click();
      log.info('content.area.clicked');
      return;
    }
  }

  const contentSelectors = [
    '.se-content .se-component.se-text p.se-text-paragraph',
    'div.se-component-content p.se-text-paragraph:not(:first-child)',
  ];

  for (const selector of contentSelectors) {
    const el = await frame.$(selector);
    if (el && (await el.isVisible())) {
      await el.click();
      log.info('content.area.clicked', { selector });
      return;
    }
  }

  await page.keyboard.press('Tab');
  log.info('content.area.fallback.tab');
};

export const addSpacing = async (page: Page, count = 100): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Enter');
  }
  log.info('spacing.added', { count });
};

export const clearAllContent = async (page: Page, frame: Frame): Promise<void> => {
  await clickTitleArea(frame);
  await page.waitForTimeout(300);
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(200);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  log.info('title.cleared');

  await clickContentArea(page, frame);
  await page.waitForTimeout(300);
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(200);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  log.info('content.cleared');

  await clickTitleArea(frame);
  await page.waitForTimeout(300);
};
