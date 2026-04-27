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

type ReservationRow = {
  title: string;
  date: string;
};

const ACCOUNT_NAME = 'mad1651';
const TARGET_TITLES = new Set([
  '중국직구사이트 핵심 정보 7가지',
  '알리바바닷컴 도매방법 입문자용 총정리',
  '사업자 도매거래방법 확실히 이해하기',
  '글로벌소싱 후기 어렵게 생각하는 분들 많죠',
  '글로벌소싱업체를 선택할 때 반드시 확인해야 할 것',
]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URI ?? '');
  const doc = await mongoose.connection.useDb('cafe-bot').collection<AccountDoc>('accounts').findOne({
    $or: [{ nickname: ACCOUNT_NAME }, { accountId: ACCOUNT_NAME }, { blogId: ACCOUNT_NAME }],
  });

  if (!doc?.accountId || !doc.password) {
    throw new Error('account_not_found');
  }

  const blogId = doc.blogId || doc.accountId;
  const auth = await getValidCookies(doc.accountId, doc.password);
  const session = await createSession(auth.cookies, doc.accountId);
  const { page } = session;
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => undefined);
  });

  try {
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
    await sleep(2_000);

    await frame.locator('button.reserve_btn__Km5Xh, button[class*="reserve_btn"]').first().click({ force: true });
    await sleep(2_000);

    const collectRows = async (): Promise<ReservationRow[]> => frame.evaluate(() => {
      const rows = [];
      for (const item of [...document.querySelectorAll('li[class*="item"]')]) {
        const title = (item.querySelector('strong[class*="title"]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const date = (item.querySelector('span[class*="date"]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (title || date) {
          rows.push({ title, date });
        }
      }
      return rows;
    });

    const clickConfirmIfVisible = async (): Promise<boolean> => frame.evaluate(() => {
      for (const button of [...document.querySelectorAll<HTMLElement>('button')]) {
        const text = (button.textContent ?? '').replace(/\s+/g, ' ').trim();
        const rect = button.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        if (isVisible && (text === '확인' || text === '삭제')) {
          button.click();
          return true;
        }
      }
      return false;
    });

    const before = await collectRows();
    console.log(JSON.stringify({ step: 'before', account: ACCOUNT_NAME, rows: before }, null, 2));

    const deleted: ReservationRow[] = [];

    while (true) {
      const rows = await collectRows();
      const target = rows.find((row) => TARGET_TITLES.has(row.title));
      if (!target) {
        break;
      }

      const clicked = await frame.evaluate((targetTitle) => {
        for (const item of [...document.querySelectorAll<HTMLElement>('li[class*="item"]')]) {
          const title = (item.querySelector('strong[class*="title"]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (title !== targetTitle) {
            continue;
          }
          const deleteButton = item.querySelector<HTMLElement>('button[title="삭제"], button[id="post_delete_button"], button[class*="delete_button"]');
          deleteButton?.click();
          return Boolean(deleteButton);
        }
        return false;
      }, target.title);

      if (!clicked) {
        throw new Error(`delete_button_not_found:${target.title}`);
      }

      await sleep(700);
      await clickConfirmIfVisible();
      await sleep(2_500);

      const afterClickRows = await collectRows();
      if (afterClickRows.some((row) => row.title === target.title)) {
        console.log(JSON.stringify({ step: 'delete_retry_needed', target }, null, 2));
        await sleep(2_000);
        const retryRows = await collectRows();
        if (retryRows.some((row) => row.title === target.title)) {
          throw new Error(`delete_failed:${target.title}`);
        }
      }

      deleted.push(target);
      console.log(JSON.stringify({ step: 'deleted', target, remaining: afterClickRows.length }, null, 2));
    }

    const after = await collectRows();
    const reserveText = await frame
      .locator('button.reserve_btn__Km5Xh, button[class*="reserve_btn"]')
      .first()
      .textContent()
      .catch(() => '');

    console.log(JSON.stringify({
      step: 'after',
      account: ACCOUNT_NAME,
      blogId,
      deleted,
      rows: after,
      reserveText: (reserveText ?? '').replace(/\s+/g, ' ').trim(),
    }, null, 2));
  } finally {
    await closeSession(session).catch(() => undefined);
    await mongoose.disconnect();
    await closeBrowser().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
