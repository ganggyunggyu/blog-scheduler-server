import type { Frame } from 'playwright';
import { SELECTORS } from '../../constants/selectors.js';

const POPUP_SELECTORS = [
  SELECTORS.popup.cancel,
  SELECTORS.popup.helpClose,
  'button.se-popup-button-confirm',
  'button.se-popup-button-cancel',
  'button.se-popup-close-button',
  'button[class*="close"]',
];

export const dismissPopups = async (frame: Frame): Promise<void> => {
  for (const selector of POPUP_SELECTORS) {
    try {
      const el = await frame.$(selector);
      if (el && (await el.isVisible())) {
        await el.click();
        await frame.page().waitForTimeout(300);
      }
    } catch {
      continue;
    }
  }
};
