import type { Frame, Page } from 'playwright';

export const waitForFrame = async (
  page: Page,
  name: string,
  timeout = 10000
): Promise<Frame> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frame = page.frame({ name });
    if (frame) return frame;
    await page.waitForTimeout(500);
  }
  throw new Error(`Frame '${name}' not found within ${timeout}ms`);
};

export const getMainFrame = async (page: Page): Promise<Frame> => {
  return waitForFrame(page, 'mainFrame');
};
