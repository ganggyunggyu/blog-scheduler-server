import type { Frame, Page } from 'playwright';
import { env } from '../../config/env.js';
import { SELECTORS } from '../../constants/selectors.js';
import { logger } from '../logging/logger.js';

const log = logger.child({ scope: 'Publish' });
const ACTION_TIMEOUT_MS = env.PLAYWRIGHT_ACTION_TIMEOUT_MS;

/**
 * 에디터 우측 도움말/사이드 패널이 열려 있으면 발행 버튼을 덮어버림.
 * force 클릭은 성공한 것처럼 보이지만 실제로는 발행 레이어가 안 열리므로
 * 발행 진입 전에 반드시 먼저 닫음.
 */
const SIDE_PANEL_CLOSE_SELECTORS = [
  '.se-help-panel-close-button',
  '.se-sidebar-close-button',
  '.se-flayer-unified-fold-button',
];

export const closeSidePanels = async (frame: Frame): Promise<void> => {
  for (const selector of SIDE_PANEL_CLOSE_SELECTORS) {
    const closed = await frame
      .locator(selector)
      .filter({ visible: true })
      .first()
      .click({ timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    if (closed) log.info('sidePanel.closed', { selector });
  }
};

export const openPublishDialog = async (page: Page, frame: Frame): Promise<void> => {
  await closeSidePanels(frame);
  await page.waitForTimeout(600);

  await frame.click(SELECTORS.publish.btn, {
    timeout: ACTION_TIMEOUT_MS,
  });
  await page.waitForTimeout(3000);
  log.info('dialog.opened');
};

export const selectCategory = async (
  page: Page,
  frame: Frame,
  category: string
): Promise<boolean> => {
  try {
    const categoryBtn = await frame.$(SELECTORS.publish.categoryBtn);
    if (!categoryBtn || !(await categoryBtn.isVisible())) {
      log.warn('category.button.missing');
      return false;
    }

    await categoryBtn.click();
    await page.waitForTimeout(1000);

    const categoryItems = await frame.$$(SELECTORS.publish.categoryItem);

    for (const item of categoryItems) {
      const text = await item.textContent();
      if (text && text.includes(category)) {
        await item.click();
        await page.waitForTimeout(500);
        log.info('category.selected', { category });
        return true;
      }
    }

    if (categoryItems.length > 0) {
      await categoryItems[0].click();
      await page.waitForTimeout(500);
      const firstCategoryText = await categoryItems[0].textContent();
      log.warn('category.fallback', { requested: category, selected: firstCategoryText?.trim() });
      return true;
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    log.warn('category.skip', { category });
    return false;
  } catch (err) {
    log.warn('category.failed', { category, message: err instanceof Error ? err.message : String(err) });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
    return false;
  }
};

export const setPublicVisibility = async (page: Page, frame: Frame): Promise<void> => {
  try {
    const privateRadio = await frame.$('input#open_private');
    if (privateRadio) {
      const isPrivate = await privateRadio.isChecked();
      if (isPrivate) {
        await frame.click(SELECTORS.publish.publicRadio, {
          timeout: ACTION_TIMEOUT_MS,
        });
        await page.waitForTimeout(500);
        log.info('visibility.changed', { from: 'private', to: 'public' });
        return;
      }
      log.info('visibility.already', { status: 'public' });
      return;
    }
  } catch {
    // fallback
  }

  try {
    await frame.click(SELECTORS.publish.publicRadio, {
      timeout: ACTION_TIMEOUT_MS,
    });
    await page.waitForTimeout(500);
  } catch {
    await page.click(SELECTORS.publish.publicRadio, {
      timeout: ACTION_TIMEOUT_MS,
    });
    await page.waitForTimeout(500);
  }
};

export const confirmPublish = async (page: Page, frame: Frame): Promise<string> => {
  const urlBefore = page.url();

  await frame.click(SELECTORS.publish.confirm, {
    timeout: ACTION_TIMEOUT_MS,
  });
  log.info('confirm.clicked');

  try {
    await page.waitForURL(
      (url) => url.href !== urlBefore,
      { timeout: env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS }
    );
    log.info('publish.navigated');
  } catch {
    log.warn('publish.url.unchanged', { url: urlBefore });

    const errorSelectors = ['.layer_error', '.error_message', 'div[role="alert"]'];
    for (const selector of errorSelectors) {
      const el = await frame.$(selector).catch(() => null);
      if (!el) continue;
      const text = (await el.textContent())?.trim();
      if (text) {
        throw new Error(`발행 실패: ${text}`);
      }
    }
  }

  await page.waitForTimeout(1000);
  const postUrl = page.url();
  log.info('publish.done', { postUrl });
  return postUrl;
};
