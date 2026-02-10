import { chromium } from 'playwright';

import { createSession, closeSession, getMainFrame, dismissPopups, focusEditor, clickContentArea } from '../../../../src/lib/naver-editor/index.ts';

import type { Cookie, Frame, Page } from 'playwright';

export interface EditorSession {
  page: Page;
  frame: Frame;
  close: () => Promise<void>;
}

const LOGIN_URL = 'https://nid.naver.com/nidlogin.login';
const EDITOR_URL = 'https://blog.naver.com/GoBlogWrite.naver';
const LOGIN_BROWSER_OPTIONS = {
  headless: false,
  slowMo: 100,
};

export const getLoginCookies = async (id: string, password: string): Promise<Cookie[]> => {
  const browser = await chromium.launch(LOGIN_BROWSER_OPTIONS);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URL);
    await page.waitForTimeout(2000);
    await page.locator('#id').fill(id);
    await page.waitForTimeout(500);
    await page.locator('#pw').fill(password);
    await page.waitForTimeout(500);
    await page.locator('#log\\.login').click();
    await page.waitForTimeout(5000);

    const cookies = await context.cookies();
    return cookies;
  } finally {
    await browser.close();
  }
};

export const openEditorSession = async (cookies: Cookie[]): Promise<EditorSession> => {
  const session = await createSession(cookies);
  const { page } = session;

  await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const frame = await getMainFrame(page);
  await page.waitForTimeout(2000);

  await dismissPopups(frame);
  await focusEditor(page, frame);
  await clickContentArea(page, frame);
  await page.waitForTimeout(500);

  const close = async (): Promise<void> => {
    await closeSession(session);
  };

  return { page, frame, close };
};
