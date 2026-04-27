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

const ACCOUNT_NAME = 'mad1651';
const KEYWORDS = ['글로벌소싱업체', '글로벌소싱추천', '글로벌소싱후기', '도매거래방법', '알리바바닷컴도매방법', '중국직구사이트'];

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

  try {
    const { page } = session;
    await page.goto(`https://blog.naver.com/${blogId}?Redirect=Write&`, { waitUntil: 'load', timeout: 120_000 });
    await sleep(5_000);
    const frame = await waitForFrame(page, 'mainFrame', 30_000);
    await frame.evaluate(() => {
      document.querySelectorAll('.se-help-panel, .se-help-panel-dimmed').forEach((el) => el.remove());
      const bodyText = document.body.textContent ?? '';
      if (!bodyText.includes('작성 중인 글이 있습니다')) {
        return;
      }
      const cancelButton = [...document.querySelectorAll<HTMLElement>('button')]
        .find((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim() === '취소');
      cancelButton?.click();
    });
    await sleep(2_000);

    const reserveButton = frame.locator('button.reserve_btn__Km5Xh, button[class*="reserve_btn"]').first();
    const reserveText = (await reserveButton.textContent().catch(() => ''))?.replace(/\s+/g, ' ').trim();
    await reserveButton.click({ force: true });
    await sleep(3_000);

    const result = await frame.evaluate((keywords) => {
      const popupRoots = [];
      for (const el of [...document.querySelectorAll('div, section, article')]) {
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!text.includes('예약 발행 글') || !text.includes('총')) {
          continue;
        }
        popupRoots.push({
          tag: el.tagName,
          id: el.getAttribute('id') ?? '',
          cls: el.getAttribute('class') ?? '',
          role: el.getAttribute('role') ?? '',
          href: el.getAttribute('href') ?? '',
          text: text.slice(0, 1_000),
          len: text.length,
          html: (el as HTMLElement).outerHTML.slice(0, 12_000),
        });
      }
      popupRoots.sort((a, b) => a.len - b.len);

      const keywordNodes = [];
      for (const el of [...document.querySelectorAll<HTMLElement>('a, button, li, div, span, strong, p')]) {
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!keywords.some((keyword) => text.includes(keyword))) {
          continue;
        }

        const ancestors = [];
        let current: HTMLElement | null = el;
        while (current && ancestors.length < 6) {
          const ancestorText = (current.textContent ?? '').replace(/\s+/g, ' ').trim();
          ancestors.push({
            tag: current.tagName,
            id: current.getAttribute('id') ?? '',
            cls: current.getAttribute('class') ?? '',
            role: current.getAttribute('role') ?? '',
            href: current.getAttribute('href') ?? '',
            text: ancestorText.slice(0, 1_000),
          });
          current = current.parentElement;
        }

        const nearbyButtons = [];
        const root = el.closest('li, div, section, article') ?? el;
        for (const button of [...root.querySelectorAll('button, a')].slice(0, 20)) {
          const buttonText = (button.textContent ?? '').replace(/\s+/g, ' ').trim();
          nearbyButtons.push({
            tag: button.tagName,
            id: button.getAttribute('id') ?? '',
            cls: button.getAttribute('class') ?? '',
            role: button.getAttribute('role') ?? '',
            href: button.getAttribute('href') ?? '',
            text: buttonText.slice(0, 1_000),
          });
        }

        keywordNodes.push({
          node: {
            tag: el.tagName,
            id: el.getAttribute('id') ?? '',
            cls: el.getAttribute('class') ?? '',
            role: el.getAttribute('role') ?? '',
            href: el.getAttribute('href') ?? '',
            text: text.slice(0, 1_000),
          },
          ancestors,
          nearbyButtons,
        });

        if (keywordNodes.length >= 30) {
          break;
        }
      }

      const clickable = [];
      const buttons = [...document.querySelectorAll<HTMLElement>('button, a')];
      for (let index = 0; index < buttons.length; index += 1) {
        const el = buttons[index];
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        const cls = el.getAttribute('class') ?? '';
        if (
          text.includes('예약') ||
          text.includes('삭제') ||
          text.includes('취소') ||
          text.includes('확인') ||
          text.includes('닫기') ||
          cls.includes('delete') ||
          cls.includes('remove') ||
          cls.includes('cancel') ||
          keywords.some((keyword) => text.includes(keyword))
        ) {
          clickable.push({
            index,
            tag: el.tagName,
            id: el.getAttribute('id') ?? '',
            cls,
            role: el.getAttribute('role') ?? '',
            href: el.getAttribute('href') ?? '',
            text: text.slice(0, 1_000),
          });
        }
        if (clickable.length >= 80) {
          break;
        }
      }

      return {
        bodyExcerpt: (document.body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 2_500),
        popupRoots: popupRoots.slice(0, 8),
        keywordNodes,
        clickable,
      };
    }, KEYWORDS);

    console.log(JSON.stringify({
      account: ACCOUNT_NAME,
      accountId: doc.accountId,
      blogId,
      fromCache: auth.fromCache,
      reserveText,
      url: page.url(),
      ...result,
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
