import type { Frame, Page } from 'playwright';
import { logger } from '../logging/logger';

const log = logger.child({ scope: 'Image' });

const IMAGE_BTN_SELECTORS = [
  'button[data-name="image"]',
  'button.se-toolbar-button-image',
  'button[data-name=image]',
  '.se-toolbar button[data-name="image"]',
];

export const uploadImage = async (
  page: Page,
  frame: Frame,
  imagePath: string
): Promise<boolean> => {
  const fileName = imagePath.split('/').pop();
  log.info('upload.start', { fileName, path: imagePath });

  const fs = await import('fs/promises');
  try {
    await fs.access(imagePath);
  } catch {
    log.warn('file.missing', { path: imagePath });
    return false;
  }

  try {
    let imageBtn = null;
    for (const selector of IMAGE_BTN_SELECTORS) {
      imageBtn = await frame.$(selector);
      if (imageBtn) {
        log.info('button.found', { selector });
        break;
      }
    }

    if (!imageBtn) {
      log.warn('button.missing');
      const buttons = await frame.$$('button');
      log.info('button.scan', { count: buttons.length });
      return false;
    }

    const isVisible = await imageBtn.isVisible();
    log.info('button.visible', { visible: isVisible });

    if (!isVisible) {
      await imageBtn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }

    log.info('button.click');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      imageBtn.click({ force: true }),
    ]);

    log.info('filechooser.ready');
    await fileChooser.setFiles(imagePath);
    await page.waitForTimeout(3000);

    log.info('upload.done', { fileName });
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('upload.failed', { fileName, message: msg });
    return false;
  }
};
