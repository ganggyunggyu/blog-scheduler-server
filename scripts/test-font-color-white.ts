import 'dotenv/config';
import { naverLogin } from '../src/services/naver-auth.service.js';
import {
  createSession,
  closeSession,
  waitForFrame,
  setFontColorWhite,
} from '../src/lib/naver-editor/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  console.log('=== setFontColorWhite 통합 테스트 v2 ===');

  const loginResult = await naverLogin('qwzx16', '12Qwaszx!@');
  if (!loginResult.success) {
    console.log('로그인 실패:', loginResult.message);
    return;
  }
  console.log('로그인 성공');

  const session = await createSession(loginResult.cookies);
  const { page } = session;

  try {
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', {
      waitUntil: 'load',
      timeout: 60000,
    });
    await sleep(5000);

    const frame = await waitForFrame(page, 'mainFrame', 30000);
    await frame.waitForSelector('.se-content, .se-component', { timeout: 30000 });
    await sleep(2000);
    console.log('에디터 로드됨');

    // 팝업 닫기
    await frame.evaluate(() => {
      document
        .querySelectorAll('.se-help-panel, .se-help-panel-dimmed, .se-popup-dim')
        .forEach((el) => el.remove());
    });
    await sleep(500);

    // 본문 직접 클릭 (focusEditor 대신)
    await frame.evaluate(() => {
      const components = document.querySelectorAll(
        '.se-component.se-text:not(.se-documentTitle)'
      );
      for (const comp of components) {
        const p = comp.querySelector('p.se-text-paragraph') as HTMLElement;
        if (p) {
          p.scrollIntoView({ behavior: 'instant', block: 'center' });
          p.click();
          return;
        }
      }
    });
    await sleep(500);

    // 텍스트 입력
    await page.keyboard.type('글씨색 흰색 변경 테스트', { delay: 30 });
    await sleep(500);
    console.log('텍스트 입력 완료');

    // setFontColorWhite 호출 (전체선택 + 흰색 적용)
    const result = await setFontColorWhite(page, frame);
    console.log('setFontColorWhite 결과:', result);

    await sleep(500);

    // 검증
    const verify = await frame.evaluate(() => {
      const spans = document.querySelectorAll('.se-content p.se-text-paragraph span');
      const white: string[] = [];
      spans.forEach((s) => {
        const el = s as HTMLElement;
        if (el.style.color === 'rgb(255, 255, 255)') {
          white.push(el.textContent ?? '');
        }
      });
      return { totalSpans: spans.length, whiteTexts: white };
    });
    console.log('검증:', JSON.stringify(verify));

    await page.screenshot({ path: '/tmp/font-color-white-v2.png' });
    console.log('스크린샷: /tmp/font-color-white-v2.png');
  } finally {
    await closeSession(session);
    console.log('완료');
  }
};

main().catch(console.error);
