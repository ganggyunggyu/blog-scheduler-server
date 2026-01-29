import type { Frame, Page } from 'playwright';
import { SELECTORS } from '../../constants/selectors';
import { logger } from '../logging/logger';

const log = logger.child({ scope: 'Publish' });

export const openPublishDialog = async (page: Page, frame: Frame): Promise<void> => {
  await frame.click(SELECTORS.publish.btn);
  await page.waitForTimeout(2000);
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
    await page.waitForTimeout(500);

    const categoryItems = await frame.$$(SELECTORS.publish.categoryItem);

    for (const item of categoryItems) {
      const text = await item.textContent();
      if (text && text.includes(category)) {
        await item.click();
        await page.waitForTimeout(300);
        log.info('category.selected', { category });
        return true;
      }
    }

    if (categoryItems.length > 0) {
      await categoryItems[0].click();
      await page.waitForTimeout(300);
      const firstCategoryText = await categoryItems[0].textContent();
      log.warn('category.fallback', { requested: category, selected: firstCategoryText?.trim() });
      return true;
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    log.warn('category.skip', { category });
    return false;
  } catch (err) {
    log.warn('category.failed', { category, message: err instanceof Error ? err.message : String(err) });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    return false;
  }
};

export const setPublicVisibility = async (page: Page, frame: Frame): Promise<void> => {
  try {
    const privateRadio = await frame.$('input#open_private');
    if (privateRadio) {
      const isPrivate = await privateRadio.isChecked();
      if (isPrivate) {
        await frame.click(SELECTORS.publish.publicRadio);
        await page.waitForTimeout(300);
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
    await frame.click(SELECTORS.publish.publicRadio);
    await page.waitForTimeout(300);
  } catch {
    await page.click(SELECTORS.publish.publicRadio);
    await page.waitForTimeout(300);
  }
};

export const confirmPublish = async (page: Page, frame: Frame): Promise<string> => {
  await frame.click(SELECTORS.publish.confirm);
  log.info('confirm.clicked');
  await page.waitForTimeout(3000);
  const postUrl = page.url();
  log.info('publish.done', { postUrl });
  return postUrl;
};
