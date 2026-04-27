import 'dotenv/config';
import mongoose from 'mongoose';
import { closeBrowser } from '../src/lib/browser/playwright.js';
import { closeSession, createSession, waitForFrame } from '../src/lib/naver-editor/index.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';

type AccountDoc = {
  accountId?: string;
  password?: string;
  nickname?: string;
  blogId?: string;
};

const TARGETS = ['weed3122', 'mad1651', 'chemical12568', 'copy11525', 'individual14144'] as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URI ?? '');
  const accounts = mongoose.connection.useDb('cafe-bot').collection<AccountDoc>('accounts');
  const results = [];

  for (const target of TARGETS) {
    const doc = await accounts.findOne({
      $or: [{ nickname: target }, { accountId: target }, { blogId: target }],
    });

    if (!doc?.accountId || !doc.password) {
      results.push({ account: target, error: 'account_not_found' });
      continue;
    }

    const blogId = doc.blogId || doc.accountId;
    const auth = await getValidCookies(doc.accountId, doc.password);
    const session = await createSession(auth.cookies, doc.accountId);

    try {
      const { page } = session;
      await page.goto(`https://blog.naver.com/${blogId}?Redirect=Write&`, { waitUntil: 'load', timeout: 120_000 });
      await sleep(5_000);
      const frame = await waitForFrame(page, 'mainFrame', 30_000);

      await frame.evaluate(() => {
        document.querySelectorAll('.se-help-panel, .se-help-panel-dimmed').forEach((el) => el.remove());
        if (!(document.body.textContent ?? '').includes('작성 중인 글이 있습니다')) {
          return;
        }
        for (const button of [...document.querySelectorAll<HTMLElement>('button')]) {
          const text = (button.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (text === '취소') {
            button.click();
            break;
          }
        }
      });
      await sleep(1_500);

      const reserveText = (await frame
        .locator('button.reserve_btn__Km5Xh, button[class*="reserve_btn"]')
        .first()
        .textContent()
        .catch(() => ''))?.replace(/\s+/g, ' ').trim() ?? '';

      const clicked = await frame.evaluate(() => {
        const reserveButton = [...document.querySelectorAll<HTMLElement>('button')]
          .find((button) => (button.textContent ?? '').includes('예약 발행'));
        reserveButton?.click();
        return Boolean(reserveButton);
      });
      if (!clicked) {
        throw new Error(`reserve_button_not_found:${target}`);
      }
      await sleep(1_500);

      const popup = await frame.evaluate(() => {
        const rows = [];
        for (const item of [...document.querySelectorAll('li[class*="item"]')]) {
          const title = (item.querySelector('strong[class*="title"]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
          const date = (item.querySelector('span[class*="date"]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (title || date) {
            rows.push({ title, date });
          }
        }

        const popupText = [...document.querySelectorAll<HTMLElement>('div[class*="popup_content"], div[class*="layer_popup"]')]
          .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
          .find((text) => text.includes('예약 발행 글')) ?? '';

        return {
          rows,
          popupText: popupText.slice(0, 300),
        };
      });

      results.push({
        account: target,
        accountId: doc.accountId,
        blogId,
        reserveText,
        popup,
      });
    } finally {
      await closeSession(session).catch(() => undefined);
      await sleep(1_000);
    }
  }

  console.log(JSON.stringify(results, null, 2));
  await mongoose.disconnect();
  await closeBrowser().catch(() => undefined);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
