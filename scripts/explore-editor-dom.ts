import { getValidCookies } from '../src/services/naver-auth.service.js';
import { createSession, closeSession } from '../src/lib/naver-editor/browser.js';
import { getMainFrame, dismissPopups } from '../src/lib/naver-editor/index.js';

const BLOG_ID = 'eqsdxv2863';
const LOG_NO = '224135354066';
const PASSWORD = '1ll2$8rl';

const explore = async () => {
  const auth = await getValidCookies(BLOG_ID, PASSWORD);
  console.log('로그인 성공');

  const session = await createSession(auth.cookies);
  const { page } = session;

  try {
    const url = `https://blog.naver.com/${BLOG_ID}?Redirect=Update&logNo=${LOG_NO}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const frame = await getMainFrame(page);
    try { await dismissPopups(frame); } catch { /* ignore */ }
    await page.waitForTimeout(2000);

    // 이미지 개수 확인
    const beforeCount = await frame.$$eval('.se-component.se-image', (els) => els.length);
    console.log(`삭제 전 이미지: ${beforeCount}개`);

    // 첫 번째 이미지 클릭 → Backspace 삭제 테스트
    const firstImage = await frame.$('.se-component.se-image');
    if (firstImage) {
      console.log('첫 번째 이미지 클릭...');
      await firstImage.click();
      await page.waitForTimeout(500);

      // 선택 확인
      const selectedClass = await firstImage.getAttribute('class');
      console.log('클래스:', selectedClass);

      console.log('Backspace 누르기...');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(1000);

      const afterCount = await frame.$$eval('.se-component.se-image', (els) => els.length);
      console.log(`삭제 후 이미지: ${afterCount}개`);
      console.log(`삭제 성공: ${afterCount === beforeCount - 1}`);

      // 현재 컴포넌트 순서 확인
      const order = await frame.$$eval('.se-component', (els) =>
        els.map((el, i) => {
          const isTitle = el.closest('.se-documentTitle') !== null;
          let type = 'unknown';
          if (el.classList.contains('se-text')) type = 'TEXT';
          if (el.classList.contains('se-image')) type = 'IMAGE';
          if (el.classList.contains('se-oglink')) type = 'OGLINK';
          const text = type === 'TEXT' ? (el.textContent?.trim().slice(0, 50) || '') : '';
          return `[${i}] ${isTitle ? 'TITLE' : type}${text ? ' → ' + text : ''}`;
        })
      );
      console.log('\n삭제 후 구조:');
      console.log(order.join('\n'));
    }

    // 발행 안 하고 그냥 나가기 (변경사항 저장 안 함)

  } finally {
    await closeSession(session);
    console.log('\n세션 종료 (저장 안 함)');
    process.exit(0);
  }
};

explore().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
