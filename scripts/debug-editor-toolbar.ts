import 'dotenv/config';
import { naverLogin } from '../src/services/naver-auth.service.js';
import { createSession, closeSession, waitForFrame } from '../src/lib/naver-editor/index.js';
import { SELECTORS } from '../src/constants/selectors.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  console.log('=== 에디터 가운데정렬 v5 ===');

  const loginResult = await naverLogin('iealpx8p', '2e8f5eg)');
  if (!loginResult.success) { console.log('로그인 실패'); return; }
  console.log('로그인 성공');

  const session = await createSession(loginResult.cookies);
  const { page } = session;

  try {
    const url = 'https://blog.naver.com/iealpx8p?Redirect=Update&logNo=224239590139';
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await sleep(3000);

    const frame = await waitForFrame(page, 'mainFrame', 30000);
    await frame.waitForSelector('.se-content, .se-component', { timeout: 30000 });
    await sleep(3000);
    console.log('에디터 로드됨');

    // 오버레이 제거
    await frame.evaluate(() => {
      document.querySelectorAll('.se-help-panel, .se-help-panel-dimmed, .se-popup-dim').forEach((el) => el.remove());
      document.querySelectorAll('[class*="container__"]').forEach((el) => {
        if (el.querySelector('h1')?.textContent?.includes('도움말')) el.remove();
      });
    });
    await sleep(500);

    // 텍스트 문단을 JS로 찾아서 클릭 (scrollIntoView + focus + click)
    const clickedText = await frame.evaluate(() => {
      // documentTitle이 아닌 텍스트 컴포넌트에서 문단 찾기
      const textComponents = document.querySelectorAll('.se-component.se-text:not(.se-documentTitle)');
      for (const comp of textComponents) {
        const paragraph = comp.querySelector('p.se-text-paragraph') as HTMLElement;
        if (paragraph && paragraph.textContent && paragraph.textContent.trim().length > 0) {
          paragraph.scrollIntoView({ behavior: 'instant', block: 'center' });
          paragraph.click();
          return paragraph.textContent.substring(0, 40);
        }
      }
      // fallback: contenteditable 내 아무 텍스트 노드
      const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
      if (editable) {
        editable.scrollIntoView({ behavior: 'instant', block: 'center' });
        editable.focus();
        editable.click();
        return 'contenteditable-fallback';
      }
      return null;
    });
    console.log(`텍스트 클릭: ${clickedText}`);
    await sleep(1000);

    // Meta+A로 전체 선택
    await page.keyboard.press('Meta+a');
    await sleep(500);

    // 이제 보이는 툴바 버튼 확인
    const visibleBtns = await frame.evaluate(() => {
      const btns = document.querySelectorAll('button[data-name]');
      const visible: string[] = [];
      btns.forEach((btn) => {
        const el = btn as HTMLElement;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight) {
          visible.push(el.getAttribute('data-name') || '');
        }
      });
      return visible;
    });
    console.log(`보이는 툴바: ${visibleBtns.join(', ')}`);

    // 정렬 드롭다운 찾기
    const alignInfo = await frame.evaluate((sel: string) => {
      const btn = document.querySelector(sel) as HTMLElement;
      if (!btn) return { exists: false, visible: false, rect: null };
      const rect = btn.getBoundingClientRect();
      return {
        exists: true,
        visible: rect.width > 0 && rect.height > 0,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      };
    }, SELECTORS.editor.alignDropdown);
    console.log(`정렬 드롭다운:`, JSON.stringify(alignInfo));

    if (alignInfo.exists) {
      // Playwright click with force
      const alignBtn = await frame.$(SELECTORS.editor.alignDropdown);
      if (alignBtn) {
        await alignBtn.click({ force: true });
        console.log('정렬 드롭다운 force click');
        await sleep(1000);

        // 센터 옵션 확인
        const centerExists = await frame.evaluate((sel: string) => {
          const btn = document.querySelector(sel) as HTMLElement;
          if (!btn) return 'not-found';
          const rect = btn.getBoundingClientRect();
          return `found rect=${JSON.stringify({ top: rect.top, left: rect.left, w: rect.width, h: rect.height })}`;
        }, SELECTORS.editor.alignCenter);
        console.log(`센터 옵션: ${centerExists}`);

        if (centerExists.startsWith('found')) {
          const centerBtn = await frame.$(SELECTORS.editor.alignCenter);
          if (centerBtn) {
            await centerBtn.click({ force: true });
            console.log('가운데정렬 적용!');
            await sleep(1000);
          }
        }
      }
    }

    // 스크린샷
    await page.screenshot({ path: '/tmp/editor-v5.png', fullPage: false });

    // 정렬 상태
    const status = await frame.evaluate(() => {
      const texts = document.querySelectorAll('.se-component.se-text:not(.se-documentTitle)');
      let c = 0, t = 0;
      texts.forEach((el) => { t++; if (el.className.includes('align_center')) c++; });
      return { centered: c, total: t };
    });
    console.log(`정렬: ${status.centered}/${status.total}`);

    // 정렬 성공이면 저장
    if (status.centered > 0) {
      console.log('\n저장...');
      const publishBtn = await frame.$(SELECTORS.publish.btn);
      if (publishBtn) {
        await publishBtn.click({ force: true });
        await sleep(3000);

        // 공개 설정
        const publicLabel = await frame.$("label[for='open_public']");
        if (publicLabel) await publicLabel.click({ force: true });
        await sleep(500);

        const confirmBtn = await frame.$(SELECTORS.publish.confirm);
        if (confirmBtn) {
          await confirmBtn.click({ force: true });
          await sleep(5000);
          console.log(`저장 완료 URL: ${page.url()}`);
        }
      }
    }

  } finally {
    await closeSession(session);
  }
};

main().catch(console.error);
