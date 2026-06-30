import type { Frame, Page } from 'playwright';
import { logger } from '../logging/logger.js';
import { dismissPopups } from './popup.js';

const log = logger.child({ scope: 'Link' });

const SELECTORS = {
  linkBtn: 'button[data-name="oglink"]',
  urlInput: 'input.se-popup-oglink-input',
  searchBtn: 'button.se-popup-oglink-button',
  confirmBtn: 'button.se-popup-button-confirm',
  alertPopup: 'div[data-group="popupLayer"][data-name="se-popup-alert"]',
};

const getVisibleAlertText = async (frame: Frame): Promise<string | null> => {
  const popup = await frame.$(SELECTORS.alertPopup);
  if (!popup || !(await popup.isVisible().catch(() => false))) {
    return null;
  }

  const text = await popup.textContent().catch(() => '');
  return text?.replace(/\s+/g, ' ').trim() || 'unknown alert';
};

export const insertLink = async (
  page: Page,
  frame: Frame,
  url: string
): Promise<boolean> => {
  log.info('link.insert.start', { url });

  try {
    // 1. 링크 버튼 클릭
    const linkBtn = await frame.$(SELECTORS.linkBtn);
    if (!linkBtn || !(await linkBtn.isVisible())) {
      log.warn('link.button.notFound');
      return false;
    }

    await linkBtn.click();
    await page.waitForTimeout(1000);
    log.info('link.button.clicked');

    // 2. URL 입력
    const urlInput = await frame.$(SELECTORS.urlInput);
    if (!urlInput) {
      log.warn('link.input.notFound');
      return false;
    }

    await urlInput.fill(url);
    await page.waitForTimeout(300);
    log.info('link.input.filled', { url });

    // 3. 검색 버튼 클릭
    const searchBtn = await frame.$(SELECTORS.searchBtn);
    if (searchBtn) {
      await searchBtn.click();
      log.info('link.search.clicked');
    }

    // 4. 대기 (링크 미리보기 로딩)
    await page.waitForTimeout(8000);
    log.info('link.preview.loaded');

    const alertText = await getVisibleAlertText(frame);
    if (alertText) {
      await dismissPopups(frame);
      log.warn('link.preview.alert', { message: alertText });
      return false;
    }

    // 5. 확인 버튼 클릭
    const confirmBtn = await frame.$(SELECTORS.confirmBtn);
    if (confirmBtn) {
      await confirmBtn.click();
      await page.waitForTimeout(1000);
      log.info('link.confirm.clicked');
    }

    log.info('link.insert.done', { url });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('link.insert.failed', { url, message });
    return false;
  }
};
