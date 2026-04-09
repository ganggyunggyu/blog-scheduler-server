import 'dotenv/config';
import { addMinutes, format } from 'date-fns';
import { findAccountById } from '../src/constants/account-presets.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import {
  createSession,
  closeSession,
  getMainFrame,
  dismissPopups,
  focusEditor,
  setAlignCenter,
  clickTitleArea,
  clickContentArea,
  insertPhone,
  insertLink,
  addSpacing,
  typeContentWithImages,
  openPublishDialog,
  setPublicVisibility,
  setScheduleTime,
  confirmPublish,
} from '../src/lib/naver-editor/index.js';

const ACCOUNT_ID = 'qwzx16';
const PHONE_TEXT = '1566-8713';

const buildWriteUrlFromPostUrl = (postUrl: string): string => {
  const blogId = new URL(postUrl).pathname.replace(/^\/+/, '');
  return `https://blog.naver.com/${blogId}?Redirect=Write&`;
};

const inspectSavedEditor = async (
  page: import('playwright').Page,
  title: string,
) => {
  const frame = await getMainFrame(page);
  await page.waitForTimeout(3000);
  await dismissPopups(frame);

  const paragraphInfo = await frame.evaluate(({ phoneText }) => {
    const list = Array.from(document.querySelectorAll<HTMLParagraphElement>('p.se-text-paragraph'))
      .map((paragraph) => {
        const text = paragraph.innerText?.replace(/\s+/g, ' ').trim() ?? '';
        const target = paragraph.querySelector<HTMLElement>('span, b, a') ?? paragraph;
        const style = window.getComputedStyle(target);
        const paragraphStyle = window.getComputedStyle(paragraph);

        return {
          text,
          html: paragraph.outerHTML,
          textAlign: paragraphStyle.textAlign,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      })
      .filter((item) => item.text.length > 0);

    return {
      phone: list.find((item) => item.text.includes(phoneText)) ?? null,
      body: list.find((item) => item.text.includes('본문 첫줄')) ?? null,
      paragraphs: list.slice(0, 10),
    };
  }, { phoneText: PHONE_TEXT });

  const screenshotPath = `/tmp/phone-align-${Date.now()}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ phase: 'saved-editor', screenshotPath, ...paragraphInfo }, null, 2));
};

const openNewestReservationEntry = async (
  page: import('playwright').Page,
  title: string,
) => {
  const frame = await getMainFrame(page);
  await dismissPopups(frame);
  await frame.locator('button.reserve_btn__Km5Xh').first().click({ force: true });
  await page.waitForTimeout(2000);

  const button = frame.locator('button.article_button__JNVjf').filter({ hasText: title }).first();
  await button.click({ force: true });
  await page.waitForTimeout(5000);
};

const run = async (): Promise<void> => {
  const account = findAccountById(ACCOUNT_ID);
  if (!account) throw new Error('account not found');

  const auth = await getValidCookies(account.id, account.password);
  const session = await createSession(auth.cookies);
  const title = `[pet-verify] phone-align ${Date.now()}`;

  try {
    const { page } = session;
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const frame = await getMainFrame(page);
    await dismissPopups(frame);
    await focusEditor(page, frame);
    await setAlignCenter(page, frame);

    await clickTitleArea(frame);
    await page.waitForTimeout(300);
    await page.keyboard.type(title, { delay: 30 });
    await page.waitForTimeout(500);
    await clickContentArea(page, frame);
    await page.waitForTimeout(300);

    await insertPhone(page, frame, PHONE_TEXT);
    await page.waitForTimeout(300);
    await insertLink(page, frame, 'https://dmanimal.co.kr/');
    await page.waitForTimeout(300);
    await addSpacing(page, 5);
    await page.waitForTimeout(300);
    await typeContentWithImages(page, frame, '본문 첫줄\n본문 둘째줄', [], { keywordCategory: '애견' });
    await page.waitForTimeout(500);

    await setAlignCenter(page, frame);
    await page.waitForTimeout(500);

    await openPublishDialog(page, frame);
    await setPublicVisibility(page, frame);
    const scheduleTime = addMinutes(new Date(), 80);
    await setScheduleTime(page, frame, scheduleTime);
    const postUrl = await confirmPublish(page, frame);

    console.log(JSON.stringify({
      phase: 'published',
      title,
      postUrl,
      scheduleTime: format(scheduleTime, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    }, null, 2));

    await page.goto(buildWriteUrlFromPostUrl(postUrl), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
    await openNewestReservationEntry(page, title);
    await inspectSavedEditor(page, title);
  } finally {
    await closeSession(session).catch(() => undefined);
    await closeBrowser().catch(() => undefined);
  }
};

run().catch(async (error) => {
  await closeBrowser().catch(() => undefined);
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
