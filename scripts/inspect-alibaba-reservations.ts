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

const TARGETS = [
  {
    name: 'weed3122',
    keywords: ['글로벌소싱순위', '중국구매대행추천', '중국수입절차', '도매거래절차', '도매거래하는법', '도매구매대행'],
  },
  {
    name: 'mad1651',
    keywords: ['글로벌소싱업체', '글로벌소싱추천', '글로벌소싱후기', '도매거래방법', '알리바바닷컴도매방법', '중국직구사이트'],
  },
  {
    name: 'chemical12568',
    keywords: ['중국수입후기', '통관하는법', '해외ODM', '중국배송비', '중국수입', '해외ODM소싱'],
  },
  {
    name: 'copy11525',
    keywords: ['1688배대지수수료', '관세비용', '해외구매대행', '1688결제방법', '1688직구방법', '알리바바닷컴사입하는법'],
  },
  {
    name: 'individual14144',
    keywords: ['물류플랫폼', '수출플랫폼', '중국구매대행사이트', '수출컨설팅', '알리바바닷컴판매', '해외진출컨설팅'],
  },
] as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const compact = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

const main = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URI ?? '');
  const accounts = mongoose.connection.useDb('cafe-bot').collection<AccountDoc>('accounts');

  for (const target of TARGETS) {
    const doc = await accounts.findOne({
      $or: [
        { nickname: target.name },
        { accountId: target.name },
        { blogId: target.name },
      ],
    });

    if (!doc?.accountId || !doc.password) {
      console.log(JSON.stringify({ account: target.name, error: 'account_not_found' }));
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
      await sleep(2_000);

      const before = await frame.evaluate(() => {
        const buttons = [...document.querySelectorAll('button, a')]
          .map((el) => ({
            tag: el.tagName,
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
            cls: el.getAttribute('class') ?? '',
            id: el.getAttribute('id') ?? '',
          }))
          .filter((item) => item.text.includes('예약'))
          .slice(0, 20);
        return {
          body: (document.body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 2_000),
          buttons,
        };
      });

      const clicked = await frame.evaluate(() => {
        const candidates = [...document.querySelectorAll<HTMLElement>('button, a')];
        const targetButton = candidates.find((el) => (el.textContent ?? '').includes('예약 발행'));
        targetButton?.click();
        return Boolean(targetButton);
      });

      await sleep(3_000);

      const after = await frame.evaluate((keywords) => {
        const body = (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
        const interestingElements = [...document.querySelectorAll<HTMLElement>('button, a, li, div, span, strong, p')]
          .map((el) => ({
            tag: el.tagName,
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
            cls: el.getAttribute('class') ?? '',
            id: el.getAttribute('id') ?? '',
            role: el.getAttribute('role') ?? '',
            href: el.getAttribute('href') ?? '',
          }))
          .filter((item) =>
            item.text.includes('예약') ||
            item.text.includes('총') ||
            item.text.includes('2026') ||
            item.text.includes('04') ||
            item.text.includes('삭제') ||
            item.text.includes('취소') ||
            keywords.some((keyword) => item.text.includes(keyword))
          )
          .slice(0, 140);

        const buttons = [...document.querySelectorAll<HTMLElement>('button, a')]
          .map((el, index) => ({
            index,
            tag: el.tagName,
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
            cls: el.getAttribute('class') ?? '',
            id: el.getAttribute('id') ?? '',
            role: el.getAttribute('role') ?? '',
            href: el.getAttribute('href') ?? '',
          }))
          .filter((item) => item.text || item.cls.includes('delete') || item.cls.includes('remove') || item.cls.includes('close'))
          .slice(0, 180);

        return {
          body: body.slice(0, 8_000),
          interestingElements,
          buttons,
        };
      }, [...target.keywords]);

      console.log(JSON.stringify({
        account: target.name,
        accountId: doc.accountId,
        blogId,
        fromCache: auth.fromCache,
        url: page.url(),
        clicked,
        before,
        after,
      }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({
        account: target.name,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      await closeSession(session).catch(() => undefined);
      await sleep(1_000);
    }
  }

  await mongoose.disconnect();
  await closeBrowser().catch(() => undefined);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
