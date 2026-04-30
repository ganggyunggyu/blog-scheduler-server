import type { Frame, Page } from 'playwright';
import { SELECTORS } from '../../constants/selectors.js';
import { logger } from '../logging/logger.js';

const log = logger.child({ scope: 'Editor' });

interface PageController {
  waitForTimeout: (ms: number) => Promise<void>;
  keyboard?: {
    press: (key: string) => Promise<void>;
  };
}

interface ClickOptions {
  force?: boolean;
}

interface ToolbarControl {
  click?: (options?: ClickOptions) => Promise<void>;
  isVisible?: () => Promise<boolean>;
  getAttribute?: (name: string) => Promise<string | null>;
}

interface FrameController {
  $: (selector: string) => Promise<ToolbarControl | null>;
  $$?: (selector: string) => Promise<ToolbarControl[]>;
  waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
  evaluate: <T, Arg = undefined>(pageFunction: (arg: Arg) => T | Promise<T>, arg?: Arg) => Promise<T>;
}

interface AlignmentStatus {
  centered: number;
  total: number;
}

const removeEditorOverlays = async (frame: FrameController): Promise<void> => {
  await frame.evaluate(() => {
    document.querySelectorAll('.se-help-panel, .se-help-panel-dimmed, .se-popup-dim').forEach((el) => el.remove());
    document.querySelectorAll('[class*="container__"]').forEach((el) => {
      if (el.querySelector('h1')?.textContent?.includes('도움말')) {
        el.remove();
      }
    });
  });
};

const focusFirstTextParagraph = async (frame: FrameController): Promise<boolean> => {
  const focused = await frame.evaluate(() => {
    const comps = document.querySelectorAll('.se-component.se-text:not(.se-documentTitle)');
    for (const comp of comps) {
      const paragraph = comp.querySelector('p.se-text-paragraph') as HTMLElement | null;
      if (paragraph?.textContent?.trim()) {
        paragraph.scrollIntoView({ behavior: 'instant', block: 'center' });
        paragraph.click();
        return true;
      }
    }

    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
    if (!editable) {
      return false;
    }

    editable.scrollIntoView({ behavior: 'instant', block: 'center' });
    editable.focus();
    editable.click();
    return true;
  });

  if (!focused) {
    log.warn('align.center.no-focus-target');
    return false;
  }

  return true;
};

const selectAllTextParagraphs = async (frame: FrameController): Promise<boolean> => {
  const selected = await frame.evaluate(() => {
    const paragraphs = Array.from(
      document.querySelectorAll<HTMLParagraphElement>('.se-component.se-text:not(.se-documentTitle) p.se-text-paragraph')
    ).filter((paragraph) => {
      const text = paragraph.textContent?.replace(/\s+/g, '') ?? '';
      return text.length > 0 || paragraph.querySelector('span, br') !== null;
    });

    const firstParagraph = paragraphs[0];
    const lastParagraph = paragraphs.at(-1);
    if (!firstParagraph || !lastParagraph) {
      return false;
    }

    firstParagraph.scrollIntoView({ behavior: 'instant', block: 'center' });
    (
      firstParagraph.closest<HTMLElement>('[contenteditable="true"]') ??
      firstParagraph.closest<HTMLElement>('.se-component-content')
    )?.focus();

    const selection = window.getSelection();
    if (!selection) {
      return false;
    }

    const range = document.createRange();
    range.setStartBefore(firstParagraph);
    range.setEndAfter(lastParagraph);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  });

  if (!selected) {
    log.warn('align.center.select-all.failed');
    return false;
  }

  log.info('align.center.select-all.ready');
  return true;
};

const getAlignmentStatus = async (frame: FrameController): Promise<AlignmentStatus> => {
  return frame.evaluate(() => {
    const textComponents = Array.from(
      document.querySelectorAll<HTMLElement>('.se-component.se-text:not(.se-documentTitle)')
    );

    let centered = 0;
    for (const component of textComponents) {
      const className = component.className ?? '';
      const textAlign = window.getComputedStyle(component).textAlign;

      if (className.includes('align_center') || textAlign === 'center') {
        centered += 1;
      }
    }

    return {
      centered,
      total: textComponents.length,
    };
  });
};

const forceAlignTextComponentsCenter = async (frame: FrameController): Promise<number> => {
  return frame.evaluate(() => {
    const textComponents = Array.from(
      document.querySelectorAll<HTMLElement>('.se-component.se-text:not(.se-documentTitle)')
    );

    for (const component of textComponents) {
      component.classList.remove('align_left', 'align_right', 'align_justify');
      component.classList.add('align_center');
      component.style.textAlign = 'center';

      const paragraphs = component.querySelectorAll<HTMLElement>('p.se-text-paragraph');
      for (const paragraph of paragraphs) {
        paragraph.style.textAlign = 'center';
        paragraph.setAttribute('align', 'center');
      }
    }

    return textComponents.length;
  });
};

const clickToolbarButtonByDom = async (
  frame: FrameController,
  selector: string,
  logKey: string
): Promise<boolean> => {
  const clicked = await frame.evaluate((targetSelector) => {
    const button = document.querySelector(targetSelector) as HTMLElement | null;
    if (!button) {
      return false;
    }

    button.click();
    return true;
  }, selector);

  if (!clicked) {
    log.warn(`${logKey}.dom.notFound`);
    return false;
  }

  log.info(`${logKey}.dom.clicked`);
  return true;
};

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
    const prepareSelectionStrategies: Array<() => Promise<boolean>> = [
      async () => {
        await removeEditorOverlays(frame);
        await page.waitForTimeout(200);
        return selectAllTextParagraphs(frame);
      },
      async () => {
        await removeEditorOverlays(frame);
        await page.waitForTimeout(200);

        const focused = await focusFirstTextParagraph(frame);
        if (!focused || !page.keyboard) {
          return false;
        }

        await page.waitForTimeout(300);
        await page.keyboard.press('Meta+a');
        await page.waitForTimeout(300);
        await page.keyboard.press('Meta+a');
        return true;
      },
    ];

    for (let attempt = 0; attempt < prepareSelectionStrategies.length; attempt += 1) {
      const prepared = await prepareSelectionStrategies[attempt]();
      if (!prepared) {
        continue;
      }

      await page.waitForTimeout(300);

      const alignDropdownClicked = await clickToolbarButtonWithFallback(
        frame,
        SELECTORS.editor.alignDropdown,
        'align.center.dropdown'
      );
      if (!alignDropdownClicked) {
        continue;
      }

      await page.waitForTimeout(500);
      await frame.waitForSelector(SELECTORS.editor.alignCenter, { timeout: 3000 }).catch(() => undefined);

      const alignCenterClicked = await clickToolbarButtonWithFallback(
        frame,
        SELECTORS.editor.alignCenter,
        'align.center.option'
      );
      if (!alignCenterClicked) {
        continue;
      }

      await page.waitForTimeout(400);

      const status = await getAlignmentStatus(frame);
      log.info('align.center.status', {
        attempt: attempt + 1,
        centered: status.centered,
        total: status.total,
      });

      if (status.total === 0 || status.centered === status.total) {
        log.info('align.center.set', { attempt: attempt + 1 });
        return true;
      }
    }

    const forcedCount = await forceAlignTextComponentsCenter(frame);
    if (forcedCount > 0) {
      await page.waitForTimeout(400);

      const forcedStatus = await getAlignmentStatus(frame);
      log.info('align.center.dom.status', {
        centered: forcedStatus.centered,
        total: forcedStatus.total,
      });

      if (forcedStatus.centered === forcedStatus.total) {
        log.info('align.center.set', { attempt: 'dom' });
        return true;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('align.center.failed', { message });
  }

  log.warn('align.center.partial');
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
  logKey: string,
  options: ClickOptions = {}
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

  await button.click(options);
  return true;
};

const clickToolbarButtonWithFallback = async (
  frame: FrameController,
  selector: string,
  logKey: string
): Promise<boolean> => {
  const visibleClicked = await clickVisibleToolbarButton(frame, selector, logKey, { force: true });
  if (visibleClicked) {
    return true;
  }

  const rawButton = await frame.$(selector);
  if (rawButton?.click) {
    await rawButton.click({ force: true });
    log.info(`${logKey}.force.clicked`);
    return true;
  }

  return clickToolbarButtonByDom(frame, selector, logKey);
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

export const forceTextComponentsFontColorWhite = async (frame: FrameController): Promise<number> => {
  const updated = await frame.evaluate(() => {
    const textComponents = Array.from(
      document.querySelectorAll<HTMLElement>('.se-component.se-text:not(.se-documentTitle)')
    );

    let count = 0;
    for (const component of textComponents) {
      const textNodes = component.querySelectorAll<HTMLElement>(
        'p.se-text-paragraph, p.se-text-paragraph span, p.se-text-paragraph b, p.se-text-paragraph i, p.se-text-paragraph u'
      );

      for (const node of textNodes) {
        if ((node.textContent?.replace(/\s+/g, '') ?? '').length === 0) {
          continue;
        }

        node.style.color = 'rgb(255, 255, 255)';
        count += 1;
      }
    }

    return count;
  });

  log.info('fontColor.white.dom.applied', { updated });
  return updated;
};

export const setFontColorWhite = async (page: Page, frame: Frame): Promise<boolean> => {
  try {
    await removeEditorOverlays(frame);
    await page.waitForTimeout(200);

    const selected = await selectAllTextParagraphs(frame);
    if (!selected) {
      const focused = await focusFirstTextParagraph(frame);
      if (focused) {
        await page.waitForTimeout(300);
        await page.keyboard.press('Meta+a');
        await page.waitForTimeout(300);
        await page.keyboard.press('Meta+a');
      } else {
        log.warn('fontColor.white.selection.failed');
      }
    }

    await page.waitForTimeout(300);

    const toolbarApplied = await applyFontColorWhite(page, frame);
    const forcedCount = await forceTextComponentsFontColorWhite(frame);
    return toolbarApplied || forcedCount > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('fontColor.white.failed', { message });
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
