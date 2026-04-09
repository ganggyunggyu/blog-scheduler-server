import type { Frame, Page } from 'playwright';
import { SELECTORS } from '../../constants/selectors.js';
import { logger } from '../logging/logger.js';

const log = logger.child({ scope: 'Editor' });

interface PageController {
  waitForTimeout: (ms: number) => Promise<void>;
}

interface ToolbarControl {
  click?: () => Promise<void>;
  isVisible?: () => Promise<boolean>;
  getAttribute?: (name: string) => Promise<string | null>;
}

interface FrameController {
  $: (selector: string) => Promise<ToolbarControl | null>;
  $$?: (selector: string) => Promise<ToolbarControl[]>;
  waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
  evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
}

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
    // 텍스트 paragraph 클릭으로 에디터 포커스 확보
    const focused = await frame.evaluate(() => {
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
      if (editable) { editable.focus(); editable.click(); return true; }
      return false;
    });

    if (!focused) {
      log.warn('align.center.no-focus-target');
      return false;
    }
    await page.waitForTimeout(500);

    // 전체 선택
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(500);

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

export const selectCurrentParagraphText = async (frame: FrameController): Promise<boolean> => {
  const selected = await frame.evaluate(() => {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    const anchorElement =
      anchorNode?.nodeType === Node.TEXT_NODE
        ? anchorNode.parentElement
        : anchorNode instanceof Element
          ? anchorNode
          : null;

    const paragraph =
      anchorElement?.closest('p.se-text-paragraph') ??
      (document.activeElement instanceof Element
        ? document.activeElement.closest('p.se-text-paragraph')
        : null);

    if (!selection || !paragraph) {
      return false;
    }

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString().trim().length > 0;
  });

  if (!selected) {
    log.warn('paragraph.select.failed');
    return false;
  }

  log.info('paragraph.selected');
  return true;
};

export const focusLastParagraphEnd = async (frame: FrameController): Promise<boolean> => {
  const focused = await frame.evaluate(() => {
    const paragraphs = Array.from(document.querySelectorAll<HTMLParagraphElement>('p.se-text-paragraph'));
    const paragraph = paragraphs.at(-1);

    if (!paragraph) {
      return false;
    }

    let textNode: Text | null = null;
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();
    while (currentNode) {
      textNode = currentNode as Text;
      currentNode = walker.nextNode();
    }

    if (!textNode) {
      paragraph.innerHTML = '';

      const span = document.createElement('span');
      span.className = 'se-ff-nanumgothic se-fs15 __se-node';
      span.style.color = 'rgb(0, 0, 0)';

      textNode = document.createTextNode('');
      span.appendChild(textNode);
      paragraph.appendChild(span);
    }

    const editable =
      paragraph.closest<HTMLElement>('[contenteditable="true"]') ??
      paragraph.closest<HTMLElement>('.se-component-content');

    editable?.focus();

    const selection = window.getSelection();
    if (!selection || !textNode) {
      return false;
    }

    const range = document.createRange();
    range.setStart(textNode, textNode.textContent?.length ?? 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    return true;
  });

  if (!focused) {
    log.warn('paragraph.last.focus.failed');
    return false;
  }

  log.info('paragraph.last.focused');
  return true;
};

export const normalizeCurrentEmptyParagraphStyle = async (
  frame: FrameController
): Promise<boolean> => {
  const normalized = await frame.evaluate(() => {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    const anchorElement =
      anchorNode?.nodeType === Node.TEXT_NODE
        ? anchorNode.parentElement
        : anchorNode instanceof Element
          ? anchorNode
          : null;

    const paragraph =
      anchorElement?.closest('p.se-text-paragraph') ??
      (document.activeElement instanceof Element
        ? document.activeElement.closest('p.se-text-paragraph')
        : null);

    if (!selection || !paragraph) {
      return false;
    }

    const paragraphText = paragraph.textContent?.replace(/\s+/g, '') ?? '';
    if (paragraphText.length > 0) {
      return false;
    }

    paragraph.innerHTML = '';

    const span = document.createElement('span');
    span.className = 'se-ff-nanumgothic se-fs15 __se-node';
    span.style.color = 'rgb(0, 0, 0)';

    const textNode = document.createTextNode('');
    span.appendChild(textNode);
    paragraph.appendChild(span);

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    return true;
  });

  if (normalized) {
    log.info('paragraph.normalized.default');
    return true;
  }

  log.info('paragraph.normalize.skipped');
  return false;
};

const getVisibleToolbarButton = async (
  frame: FrameController,
  selector: string
): Promise<ToolbarControl | null> => {
  if (frame.$$) {
    const buttons = await frame.$$(selector);
    for (const button of buttons) {
      if (!button.click || !button.isVisible) {
        continue;
      }

      if (await button.isVisible()) {
        return button;
      }
    }
  }

  const button = await frame.$(selector);
  if (!button?.click || !button.isVisible) {
    return null;
  }

  if (!(await button.isVisible())) {
    return null;
  }

  return button;
};

const clickVisibleToolbarButton = async (
  frame: FrameController,
  selector: string,
  logKey: string
): Promise<boolean> => {
  const button = await getVisibleToolbarButton(frame, selector);
  if (!button) {
    log.warn(`${logKey}.notFound`);
    return false;
  }

  if (!button.click) {
    log.warn(`${logKey}.unsupported`);
    return false;
  }

  await button.click();
  return true;
};

const isVisibleToolbarButtonActive = async (
  frame: FrameController,
  selector: string
): Promise<boolean> => {
  const button = await getVisibleToolbarButton(frame, selector);
  if (!button?.getAttribute) {
    return false;
  }

  const [className, ariaPressed] = await Promise.all([
    button.getAttribute('class'),
    button.getAttribute('aria-pressed'),
  ]);

  return className?.includes('se-is-activated') === true || ariaPressed === 'true';
};

export const applyBoldToSelection = async (
  page: PageController,
  frame: FrameController
): Promise<boolean> => {
  const clicked = await clickVisibleToolbarButton(frame, SELECTORS.editor.bold, 'selection.bold');
  if (!clicked) {
    return false;
  }

  await page.waitForTimeout(300);
  log.info('selection.bold.applied');
  return true;
};

const applyFontSize = async (
  page: PageController,
  frame: FrameController,
  size: 15 | 24
): Promise<boolean> => {
  const targetSelector =
    size === 24 ? SELECTORS.editor.fontSize24 : SELECTORS.editor.fontSize15;

  const dropdownClicked = await clickVisibleToolbarButton(
    frame,
    SELECTORS.editor.fontSizeDropdown,
    'selection.fontSize.dropdown'
  );
  if (!dropdownClicked) {
    return false;
  }

  await page.waitForTimeout(300);
  await frame.waitForSelector(targetSelector, { timeout: 3000 });
  const optionClicked = await clickVisibleToolbarButton(
    frame,
    targetSelector,
    `selection.fontSize.${size}`
  );
  if (!optionClicked) {
    return false;
  }

  await page.waitForTimeout(300);
  log.info('selection.fontSize.applied', { size });
  return true;
};

export const applyFontSize24ToSelection = async (
  page: PageController,
  frame: FrameController
): Promise<boolean> => applyFontSize(page, frame, 24);

export const applyFontSize15ToSelection = async (
  page: PageController,
  frame: FrameController
): Promise<boolean> => applyFontSize(page, frame, 15);

export const resetTypingStyleToDefault = async (
  page: PageController,
  frame: FrameController
): Promise<void> => {
  const boldActive = await isVisibleToolbarButtonActive(frame, SELECTORS.editor.bold);
  let boldReset = false;

  if (boldActive) {
    boldReset = await clickVisibleToolbarButton(frame, SELECTORS.editor.bold, 'typing.bold.reset');
    await page.waitForTimeout(300);
  }

  log.info('typing.bold.reset', { boldActive, boldReset });

  const fontSizeReset = await applyFontSize(page, frame, 15);
  log.info('typing.fontSize.reset', { size: 15, fontSizeReset });
  await normalizeCurrentEmptyParagraphStyle(frame);
};

export const forceResetTypingStyleToDefault = async (
  page: PageController,
  frame: FrameController
): Promise<void> => {
  const firstToggle = await clickVisibleToolbarButton(frame, SELECTORS.editor.bold, 'typing.bold.forceToggle');
  if (firstToggle) {
    await page.waitForTimeout(300);
  }

  const boldActiveAfterFirstToggle = await isVisibleToolbarButtonActive(frame, SELECTORS.editor.bold);
  let secondToggle = false;

  if (boldActiveAfterFirstToggle) {
    secondToggle = await clickVisibleToolbarButton(frame, SELECTORS.editor.bold, 'typing.bold.forceToggle.final');
    if (secondToggle) {
      await page.waitForTimeout(300);
    }
  }

  const finalBoldActive = await isVisibleToolbarButtonActive(frame, SELECTORS.editor.bold);
  log.info('typing.bold.forceReset', {
    firstToggle,
    secondToggle,
    finalBoldActive,
  });

  const fontSizeReset = await applyFontSize(page, frame, 15);
  log.info('typing.fontSize.forceReset', { size: 15, fontSizeReset });
  await normalizeCurrentEmptyParagraphStyle(frame);
};

export const applyFontColorWhite = async (
  page: PageController,
  frame: FrameController
): Promise<boolean> => {
  const colorBtnClicked = await frame.evaluate(() => {
    const btn = document.querySelector(
      'button[data-name="font-color"][data-group="propertyToolbar"], button[data-name="font-color"][data-group="contentsToolbar"]'
    ) as HTMLElement | null;
    if (!btn) return false;
    btn.click();
    return true;
  });

  if (!colorBtnClicked) {
    log.warn('fontColor.btn.notFound');
    return false;
  }

  await page.waitForTimeout(500);

  const whiteClicked = await frame.evaluate(() => {
    const btn = document.querySelector(
      'button.se-color-palette[title="#ffffff"]'
    ) as HTMLElement | null;
    if (!btn) return false;
    btn.click();
    return true;
  });

  if (!whiteClicked) {
    log.warn('fontColor.white.notFound');
    return false;
  }

  await page.waitForTimeout(300);
  log.info('fontColor.white.applied');
  return true;
};

export const setFontColorWhite = async (page: Page, frame: Frame): Promise<boolean> => {
  try {
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(300);

    return await applyFontColorWhite(page, frame);
  } catch {
    log.warn('fontColor.white.failed');
  }
  return false;
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
