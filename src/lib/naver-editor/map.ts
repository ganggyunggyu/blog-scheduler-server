import type { Frame, Page } from 'playwright';
import { logger } from '../logging/logger';

const log = logger.child({ scope: 'Map' });

const SELECTORS = {
  mapBtn: 'button[data-name="map"]',
  searchInput: 'input.react-autosuggest__input',
  searchBtn: 'button.se-place-search-button',
  resultItem: 'li.se-place-map-search-result-item',
  addBtn: 'button.se-place-add-button',
  confirmBtn: 'button.se-popup-button-confirm',
  popupClose: 'button.se-popup-close-button',
};

export const insertMap = async (
  page: Page,
  frame: Frame,
  query: string
): Promise<boolean> => {
  log.info('map.insert.start', { query });

  try {
    // 1. 지도 버튼 클릭 (frame에서)
    const mapBtn = await frame.$(SELECTORS.mapBtn);
    if (!mapBtn || !(await mapBtn.isVisible())) {
      log.warn('map.button.notFound');
      return false;
    }

    await mapBtn.click();
    await page.waitForTimeout(1500);
    log.info('map.button.clicked');

    // 2. 검색 입력창 찾기 (frame에서)
    const searchInput = await frame.$(SELECTORS.searchInput);
    if (!searchInput) {
      log.warn('map.search.input.notFound');
      return false;
    }

    // 3. 검색어 입력
    await searchInput.click();
    await page.waitForTimeout(300);
    await searchInput.fill(query);
    await page.waitForTimeout(500);
    log.info('map.search.query.entered', { query });

    // 4. 검색 버튼 클릭
    const searchBtn = await frame.$(SELECTORS.searchBtn);
    if (searchBtn) {
      await searchBtn.click();
      log.info('map.search.button.clicked');
    } else {
      await page.keyboard.press('Enter');
      log.info('map.search.enter.pressed');
    }

    await page.waitForTimeout(2000);

    // 5. 첫 번째 검색 결과 클릭 (추가 버튼 활성화)
    const resultItem = await frame.$(SELECTORS.resultItem);
    if (!resultItem) {
      log.warn('map.result.notFound', { query });
      return false;
    }

    await resultItem.click();
    await page.waitForTimeout(500);
    log.info('map.result.clicked', { query });

    // 6. 추가 버튼 클릭
    const addBtn = await frame.$(`${SELECTORS.resultItem} ${SELECTORS.addBtn}`);
    if (!addBtn) {
      log.warn('map.addBtn.notFound', { query });
      return false;
    }

    await addBtn.click();
    await page.waitForTimeout(500);
    log.info('map.result.added', { query });

    // 7. 확인 버튼 클릭
    const confirmBtn = await frame.$(SELECTORS.confirmBtn);
    if (confirmBtn) {
      await confirmBtn.click();
      await page.waitForTimeout(1000);
      log.info('map.confirm.clicked');
    }

    log.info('map.insert.done', { query });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('map.insert.failed', { query, message });
    return false;
  }
};

export const insertMaps = async (
  page: Page,
  frame: Frame,
  queries: string[]
): Promise<{ success: number; failed: number }> => {
  log.info('maps.insert.start', { count: queries.length });

  let success = 0;
  let failed = 0;

  try {
    // 1. 지도 버튼 클릭 (frame에서)
    const mapBtn = await frame.$(SELECTORS.mapBtn);
    if (!mapBtn || !(await mapBtn.isVisible())) {
      log.warn('map.button.notFound');
      return { success: 0, failed: queries.length };
    }

    await mapBtn.click();
    await page.waitForTimeout(1500);
    log.info('map.button.clicked');

    // 2. 각 검색어에 대해 검색 후 추가
    for (const query of queries) {
      // 검색 입력창 (frame에서)
      const searchInput = await frame.$(SELECTORS.searchInput);
      if (!searchInput) {
        log.warn('map.search.input.notFound');
        failed++;
        continue;
      }

      // 입력창 비우고 새 검색어 입력
      await searchInput.click();
      await page.waitForTimeout(200);
      await searchInput.fill('');
      await page.waitForTimeout(100);
      await searchInput.fill(query);
      await page.waitForTimeout(500);

      // 검색
      const searchBtn = await frame.$(SELECTORS.searchBtn);
      if (searchBtn) {
        await searchBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(2000);

      // 첫 번째 결과 클릭 (추가 버튼 활성화)
      const resultItem = await frame.$(SELECTORS.resultItem);
      if (!resultItem) {
        log.warn('map.result.notFound', { query });
        failed++;
        continue;
      }

      await resultItem.click();
      await page.waitForTimeout(500);
      log.info('map.result.clicked', { query });

      // 추가 버튼 클릭
      const addBtn = await frame.$(`${SELECTORS.resultItem} ${SELECTORS.addBtn}`);
      if (!addBtn) {
        log.warn('map.addBtn.notFound', { query });
        failed++;
        continue;
      }

      await addBtn.click();
      await page.waitForTimeout(500);
      log.info('map.result.added', { query });
      success++;
    }

    // 3. 모든 추가 완료 후 확인 버튼 클릭
    const confirmBtn = await frame.$(SELECTORS.confirmBtn);
    if (confirmBtn) {
      await confirmBtn.click();
      await page.waitForTimeout(1000);
      log.info('map.confirm.clicked');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('maps.insert.failed', { message });
  }

  log.info('maps.insert.done', { success, failed, total: queries.length });
  return { success, failed };
};
