import { chromium, type Browser } from 'playwright';
import { env } from '../config/env';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: env.PLAYWRIGHT_HEADLESS,
      slowMo: env.PLAYWRIGHT_SLOW_MO,
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
