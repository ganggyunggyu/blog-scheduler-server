import 'dotenv/config';
import mongoose from 'mongoose';
import {
  closeSession,
  createSession,
  dismissPopups,
  getMainFrame,
  openPublishDialog,
} from '../src/lib/naver-editor/index.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';

const TARGET = {
  accountId: 'mad1651',
  blogId: 'mad1651',
  logNo: '224318488621',
};

interface AccountDoc {
  accountId: string;
  password: string;
}

const main = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const account = await cafeDb.collection<AccountDoc>('accounts').findOne(
    { accountId: TARGET.accountId },
    { projection: { accountId: 1, password: 1 } },
  );
  await mongoose.disconnect();
  if (!account?.password) throw new Error('계정 비밀번호 없음');

  const auth = await getValidCookies(account.accountId, account.password);
  const session = await createSession(auth.cookies, account.accountId);
  const { page } = session;

  try {
    await page.goto(`https://blog.naver.com/${TARGET.blogId}?Redirect=Update&logNo=${TARGET.logNo}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5_000);
    const frame = await getMainFrame(page);
    await dismissPopups(frame);
    await openPublishDialog(page, frame);
    await page.waitForTimeout(2_000);

    const buttons = await frame.evaluate(() => Array.from(document.querySelectorAll('button, a'))
      .map((element) => {
        const el = element as HTMLElement;
        return {
          tag: el.tagName,
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
          className: el.getAttribute('class') ?? '',
          id: el.id,
          dataTestId: el.getAttribute('data-testid') ?? '',
          type: element.getAttribute('type') ?? '',
          visible: Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        };
      })
      .filter((button) => button.visible && button.text));

    console.log(JSON.stringify({ url: page.url(), buttons }, null, 2));
  } finally {
    await closeSession(session);
  }
};

main().catch(async (error) => {
  await mongoose.disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
