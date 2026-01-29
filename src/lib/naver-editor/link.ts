import type { Frame, Page } from 'playwright';
import { logger } from '../logging/logger';

const log = logger.child({ scope: 'Link' });

const SELECTORS = {
  linkBtn: 'button[data-name="oglink"]',
  urlInput: 'input.se-popup-oglink-input',
  searchBtn: 'button.se-popup-oglink-button',
  confirmBtn: 'button.se-popup-button-confirm',
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
