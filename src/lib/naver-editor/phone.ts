import type { Frame, Page } from 'playwright';
import { logger } from '../logging/logger.js';

const log = logger.child({ scope: 'Phone' });

const SELECTORS = {
  textLinkBtn: 'button[data-name="text-link"]',
  linkInput: 'input.se-custom-layer-link-input',
};

export const insertPhone = async (
  page: Page,
  frame: Frame,
  phone: string
): Promise<boolean> => {
  log.info('phone.insert.start', { phone });

  try {
    // 1. 전화번호 입력
    await page.keyboard.type(phone, { delay: 30 });
    await page.waitForTimeout(500);
    log.info('phone.typed', { phone });

    // 2. 전화번호 줄 선택 (더블클릭)
    await page.keyboard.press('Home');
    await page.waitForTimeout(200);
    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);
    log.info('phone.selected');

    // 3. 링크 버튼 클릭
    const linkBtn = await frame.$(SELECTORS.textLinkBtn);
    if (!linkBtn) {
      log.warn('phone.linkBtn.notFound');
      return false;
    }

    await linkBtn.click();
    await page.waitForTimeout(500);
    log.info('phone.linkBtn.clicked');

    // 4. tel: 형식으로 입력
    const linkInput = await frame.$(SELECTORS.linkInput);
    if (!linkInput) {
      log.warn('phone.linkInput.notFound');
      return false;
    }

    const telUrl = `tel:${phone.replace(/-/g, '')}`;
    await linkInput.fill(telUrl);
    await page.waitForTimeout(300);
    log.info('phone.linkInput.filled', { telUrl });

    // 5. Enter
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    log.info('phone.enter.pressed');

    // 6. 줄바꿈
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    log.info('phone.insert.done', { phone });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('phone.insert.failed', { phone, message });
    return false;
  }
};
