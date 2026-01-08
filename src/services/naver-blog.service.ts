import type { Frame, Page } from 'playwright';
import { SELECTORS } from '../constants/selectors';
import { getBrowser } from '../lib/playwright';
import { logger } from '../lib/logger';
import { ProgressBar } from '../lib/progress';

const log = logger.child({ scope: 'WritePost' });

interface WritePostParams {
  cookies: unknown[];
  title: string;
  content: string;
  images?: string[];
  scheduleTime?: string; // ISO format: "2026-01-07T14:00:00+09:00"
}

async function waitForFrame(page: Page, name: string, timeout = 10000): Promise<Frame> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frame = page.frame({ name });
    if (frame) return frame;
    await page.waitForTimeout(500);
  }
  throw new Error(`Frame '${name}' not found within ${timeout}ms`);
}

async function dismissPopups(frame: Frame): Promise<void> {
  const popupSelectors = [
    SELECTORS.popup.cancel,
    SELECTORS.popup.helpClose,
    'button.se-popup-button-cancel',
    'button[class*="close"]',
  ];

  for (const selector of popupSelectors) {
    try {
      const el = await frame.$(selector);
      if (el && await el.isVisible()) {
        await el.click();
        await frame.page().waitForTimeout(300);
      }
    } catch {
      continue;
    }
  }
}

function isSubheading(line: string): boolean {
  const patterns = [
    /^\d+\.\s/,
    /^[①②③④⑤⑥⑦⑧⑨⑩]/,
    /^【\d+】/,
    /^\[\d+\]/,
    /^▶\s*\d+/,
  ];
  const trimmed = line.trim();
  return patterns.some((pattern) => pattern.test(trimmed));
}

// "1. 텍스트" 패턴을 타이핑 (네이버 에디터 자동 리스트 변환 방지)
// 흐름: 1. → 1.ㅁ → 1.|ㅁ → 1. |ㅁ → 1. ㅁ| → 1. | → 1. 텍스트
async function typeLineAvoidingAutoList(page: Page, line: string): Promise<void> {
  const match = line.match(/^(\d+)\.\s(.+)$/);
  if (match) {
    const [, number, text] = match;
    // 1. 숫자와 점 입력: "1."
    await page.keyboard.type(`${number}.`, { delay: 50 });
    await page.waitForTimeout(50);
    // 2. 임시 문자 입력: "1.ㅁ"
    await page.keyboard.type('ㅁ', { delay: 50 });
    await page.waitForTimeout(50);
    // 3. 커서를 임시 문자 앞으로: "1.|ㅁ"
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(30);
    // 4. 공백 입력: "1. |ㅁ"
    await page.keyboard.type(' ', { delay: 50 });
    await page.waitForTimeout(50);
    // 5. 커서를 임시 문자 뒤로: "1. ㅁ|"
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(30);
    // 6. 임시 문자 삭제: "1. |"
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);
    // 7. 나머지 텍스트 입력
    await page.keyboard.type(text, { delay: 10 });
  } else {
    await page.keyboard.type(line, { delay: 10 });
  }
}

function matchImagesToSubheadings(paragraphs: string[], images: string[]): Map<number, string> {
  const result = new Map<number, string>();
  const subheadingIndices = paragraphs
    .map((paragraph, index) => (isSubheading(paragraph) ? index : -1))
    .filter((index) => index >= 0);

  subheadingIndices.forEach((index, i) => {
    if (i < images.length) {
      result.set(index, images[i]);
    }
  });

  return result;
}

async function uploadImage(page: Page, frame: Frame, imagePath: string): Promise<boolean> {
  const fileName = imagePath.split('/').pop();
  log.info('image.upload.start', { fileName, path: imagePath });

  // 파일 존재 확인
  const fs = await import('fs/promises');
  try {
    await fs.access(imagePath);
  } catch {
    log.warn('image.missing', { path: imagePath });
    return false;
  }

  try {
    // 이미지 버튼 찾기 (여러 셀렉터 시도)
    const selectors = [
      'button[data-name="image"]',
      'button.se-toolbar-button-image',
      'button[data-name=image]',
      '.se-toolbar button[data-name="image"]',
    ];

    let imageBtn = null;
    for (const selector of selectors) {
      imageBtn = await frame.$(selector);
      if (imageBtn) {
        log.info('image.button.found', { selector });
        break;
      }
    }

    if (!imageBtn) {
      log.warn('image.button.missing');
      // 현재 프레임의 버튼들 로깅
      const buttons = await frame.$$('button');
      log.info('image.button.scan', { count: buttons.length });
      return false;
    }

    // 버튼이 보이는지 확인
    const isVisible = await imageBtn.isVisible();
    log.info('image.button.visible', { visible: isVisible });

    if (!isVisible) {
      // 스크롤해서 보이게
      await imageBtn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }

    // file_chooser 이벤트 대기하면서 버튼 클릭
    log.info('image.click');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      imageBtn.click({ force: true }),
    ]);

    log.info('image.filechooser');
    await fileChooser.setFiles(imagePath);
    await page.waitForTimeout(3000);

    log.info('image.uploaded', { fileName });
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('image.upload.failed', { fileName, message: msg });
    return false;
  }
}

async function typeContentWithImages(
  page: Page,
  frame: Frame,
  content: string,
  images?: string[]
): Promise<void> {
  const paragraphs = content.split('\n');
  const imageMap = images?.length ? matchImagesToSubheadings(paragraphs, images) : new Map();
  const uploadTotal = imageMap.size;
  const uploadProgress =
    uploadTotal > 0
      ? new ProgressBar({ label: 'upload', total: uploadTotal, width: 14, showStatus: true })
      : null;

  log.info('content.type.start', { paragraphs: paragraphs.length, images: uploadTotal });
  if (uploadProgress) {
    log.info(uploadProgress.start());
  }

  let prevWasList = false;

  for (let i = 0; i < paragraphs.length; i += 1) {
    let line = paragraphs[i].trim();

    if (line.length > 0) {
      const isList = line.startsWith('- ');
      if (isList && prevWasList) {
        line = line.slice(2);
      }
      await typeLineAvoidingAutoList(page, line);
      prevWasList = isList;
    } else {
      prevWasList = false;
    }

    if (i < paragraphs.length - 1) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);

      // 제목(첫 줄) 입력 후 본문 시작할 때 가운데 정렬 다시 설정
      if (i === 0) {
        try {
          const alignBtn = await frame.$(SELECTORS.editor.alignDropdown);
          if (alignBtn && (await alignBtn.isVisible())) {
            await alignBtn.click();
            await page.waitForTimeout(500);
            await frame.waitForSelector(SELECTORS.editor.alignCenter, { timeout: 2000 });
            await frame.click(SELECTORS.editor.alignCenter);
            await page.waitForTimeout(300);
            log.info('align.center.body');
          }
        } catch {
          // 무시
        }
      }
    }

    const imagePath = imageMap.get(i);
    if (imagePath) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      const uploaded = await uploadImage(page, frame, imagePath);
      if (uploadProgress) {
        log.info(uploadProgress.tick(uploaded ? 'ok' : 'fail'));
      }
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    }
  }

  if (uploadProgress) {
    log.info(uploadProgress.done('done'));
  }
}

export async function writePost(params: WritePostParams): Promise<{
  success: boolean;
  postUrl?: string;
  message: string;
}> {
  const { cookies, title, content, images, scheduleTime } = params;
  const progress = new ProgressBar({ label: 'publish', total: 5, width: 14 });

  // 예약 시간 파싱 (있으면 네이버 예약발행 UI 사용)
  let scheduleDate: Date | null = null;
  if (scheduleTime) {
    scheduleDate = new Date(scheduleTime);
    log.info('schedule.time', { scheduleTime, parsed: scheduleDate.toISOString() });
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  await context.addCookies(cookies as any[]);
  const page = await context.newPage();

  try {
    const url = 'https://blog.naver.com/GoBlogWrite.naver';
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    log.info(progress.step('page.open'), { url });

    const frame = await waitForFrame(page, 'mainFrame');
    await page.waitForTimeout(2000);

    await dismissPopups(frame);

    // 에디터 영역 클릭해서 포커스
    const editorSelector = 'div.se-component-content, div[contenteditable="true"], p.se-text-paragraph';
    try {
      const editor = await frame.waitForSelector(editorSelector, { timeout: 10000 });
      if (editor) {
        await editor.click();
        await page.waitForTimeout(500);
      }
    } catch {
      log.warn('editor.selector.missing');
      await frame.click(SELECTORS.editor.content);
    }

    // 가운데 정렬 설정
    try {
      const alignBtn = await frame.$(SELECTORS.editor.alignDropdown);
      if (alignBtn && (await alignBtn.isVisible())) {
        await alignBtn.click();
        await page.waitForTimeout(500);
        // 드롭다운 메뉴가 열릴 때까지 대기
        await frame.waitForSelector(SELECTORS.editor.alignCenter, { timeout: 3000 });
        await frame.click(SELECTORS.editor.alignCenter);
        await page.waitForTimeout(300);
        log.info('align.center');
      }
    } catch {
      log.warn('align.center.failed');
    }

    log.info(progress.step('editor.ready'));

    // 제목 + 본문을 한번에 입력 (Python 방식)
    const fullText = `${title}\n${content}`;
    await typeContentWithImages(page, frame, fullText, images);
    log.info(progress.step('content.entered'));

    await frame.click(SELECTORS.publish.btn);
    await page.waitForTimeout(2000);
    log.info(progress.step('publish.dialog'));

    // 발행 다이얼로그 컨텍스트 결정 (frame 또는 page)
    // 네이버 블로그는 발행 다이얼로그가 mainFrame 내에 있음
    const dialogCtx = frame;

    // 공개 설정
    try {
      await dialogCtx.click(SELECTORS.publish.publicRadio);
      await page.waitForTimeout(300);
    } catch {
      // page에서 시도
      await page.click(SELECTORS.publish.publicRadio);
      await page.waitForTimeout(300);
    }

    // 예약 발행 처리
    if (scheduleDate) {
      log.info('schedule.mode', { scheduleDate: scheduleDate.toISOString() });

      // 1. 예약 라디오 버튼 클릭 (frame과 page 모두 시도)
      const scheduleRadioSelectors = [
        'label[for="radio_time2"]',
        'label.radio_label__mB6ia',
        SELECTORS.publish.scheduleRadio,
      ];

      let radioClicked = false;

      // frame에서 시도
      for (const selector of scheduleRadioSelectors) {
        try {
          const el = await frame.$(selector);
          if (el && (await el.isVisible())) {
            await el.click();
            await page.waitForTimeout(1000);
            log.info('schedule.radio.clicked', { selector, ctx: 'frame' });
            radioClicked = true;
            break;
          }
        } catch {
          continue;
        }
      }

      // page에서 시도
      if (!radioClicked) {
        for (const selector of scheduleRadioSelectors) {
          try {
            const el = await page.$(selector);
            if (el && (await el.isVisible())) {
              await el.click();
              await page.waitForTimeout(1000);
              log.info('schedule.radio.clicked', { selector, ctx: 'page' });
              radioClicked = true;
              break;
            }
          } catch {
            continue;
          }
        }
      }

      // 텍스트로 찾기 시도
      if (!radioClicked) {
        try {
          await frame.getByText('예약', { exact: true }).click();
          await page.waitForTimeout(1000);
          log.info('schedule.radio.clicked', { method: 'getByText', ctx: 'frame' });
          radioClicked = true;
        } catch {
          try {
            await page.getByText('예약', { exact: true }).click();
            await page.waitForTimeout(1000);
            log.info('schedule.radio.clicked', { method: 'getByText', ctx: 'page' });
            radioClicked = true;
          } catch {
            log.warn('schedule.radio.getByText.failed');
          }
        }
      }

      if (!radioClicked) {
        throw new Error('예약 라디오 버튼을 찾을 수 없음');
      }

      // time_setting 영역이 나타나는지 확인 (frame과 page 모두)
      let timeSettingVisible = false;
      try {
        await frame.waitForSelector(SELECTORS.publish.timeSetting, { timeout: 3000 });
        log.info('schedule.timeSetting.visible', { ctx: 'frame' });
        timeSettingVisible = true;
      } catch {
        try {
          await page.waitForSelector(SELECTORS.publish.timeSetting, { timeout: 3000 });
          log.info('schedule.timeSetting.visible', { ctx: 'page' });
          timeSettingVisible = true;
        } catch {
          log.warn('schedule.timeSetting.notFound');
        }
      }

      if (!timeSettingVisible) {
        // 재클릭 시도
        log.warn('schedule.timeSetting.retry');
        try {
          await frame.getByText('예약', { exact: true }).click({ force: true });
        } catch {
          await page.getByText('예약', { exact: true }).click({ force: true });
        }
        await page.waitForTimeout(1000);
      }

      // 시간 선택기 확인 (frame과 page 모두 시도)
      const hourSelectors = [
        'select.hour_option__J_heO',
        'select[class*="hour"]',
        '.time_setting__v6YRU select:first-of-type',
        'div[class*="time_setting"] select:first-of-type',
      ];

      let hourSelectFound = false;
      let hourSelectCtx: typeof frame | typeof page = frame;

      // frame에서 시도
      for (const selector of hourSelectors) {
        try {
          const el = await frame.waitForSelector(selector, { timeout: 1500 });
          if (el) {
            log.info('schedule.hourSelect.found', { selector, ctx: 'frame' });
            hourSelectFound = true;
            hourSelectCtx = frame;
            break;
          }
        } catch {
          continue;
        }
      }

      // page에서 시도
      if (!hourSelectFound) {
        for (const selector of hourSelectors) {
          try {
            const el = await page.waitForSelector(selector, { timeout: 1500 });
            if (el) {
              log.info('schedule.hourSelect.found', { selector, ctx: 'page' });
              hourSelectFound = true;
              hourSelectCtx = page;
              break;
            }
          } catch {
            continue;
          }
        }
      }

      if (!hourSelectFound) {
        // 디버그: 모든 select 요소 개수
        const frameSelects = await frame.$$('select');
        const pageSelects = await page.$$('select');
        log.error('schedule.hourSelect.missing', {
          frameSelectCount: frameSelects.length,
          pageSelectCount: pageSelects.length,
        });
        throw new Error('시간 선택기를 찾을 수 없음');
      }

      // 2. 날짜 설정 (오늘이 아닌 경우에만)
      const today = new Date();
      const isToday =
        scheduleDate.getFullYear() === today.getFullYear() &&
        scheduleDate.getMonth() === today.getMonth() &&
        scheduleDate.getDate() === today.getDate();

      if (!isToday) {
        // 날짜 입력 필드 클릭해서 캘린더 열기
        await hourSelectCtx.click(SELECTORS.publish.dateInput, { timeout: 3000 });
        await page.waitForTimeout(500);

        // 캘린더가 열렸는지 확인
        await hourSelectCtx.waitForSelector(SELECTORS.publish.datepickerHeader, { timeout: 3000 });
        log.info('schedule.datepicker.opened');

        // 월 이동 계산
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        const targetMonth = scheduleDate.getMonth();
        const targetYear = scheduleDate.getFullYear();
        const monthDiff = (targetYear - currentYear) * 12 + (targetMonth - currentMonth);

        for (let i = 0; i < monthDiff; i += 1) {
          await hourSelectCtx.click(SELECTORS.publish.datepickerNextMonth, { timeout: 3000 });
          await page.waitForTimeout(300);
        }

        // 날짜 버튼 클릭
        const daySelector = 'td:not(.ui-state-disabled) button.ui-state-default';
        const dayButtons = await hourSelectCtx.$$(daySelector);
        const targetDay = scheduleDate.getDate().toString();
        let daySelected = false;

        for (const btn of dayButtons) {
          const text = await btn.textContent();
          if (text && text.trim() === targetDay) {
            await btn.click();
            await page.waitForTimeout(500);
            log.info('schedule.date.selected', { day: targetDay });
            daySelected = true;
            break;
          }
        }

        if (!daySelected) {
          throw new Error(`날짜 선택 실패: ${targetDay}일`);
        }
      }

      // 3. 시간 설정
      const hourStr = scheduleDate.getHours().toString().padStart(2, '0');
      const minuteStr = (Math.floor(scheduleDate.getMinutes() / 10) * 10).toString().padStart(2, '0');

      await hourSelectCtx.selectOption(SELECTORS.publish.hourSelect, hourStr);
      await page.waitForTimeout(300);
      await hourSelectCtx.selectOption(SELECTORS.publish.minuteSelect, minuteStr);
      await page.waitForTimeout(300);

      log.info('schedule.time.set', { hour: hourStr, minute: minuteStr });
    }

    // 최종 발행 버튼 클릭
    await frame.click(SELECTORS.publish.confirm);
    log.info(progress.step('publish.confirm'));

    await page.waitForTimeout(3000);

    const postUrl = page.url();
    log.info(progress.done('publish.done'), { postUrl });

    return { success: true, postUrl, message: 'Publish success' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publish failed';
    log.error('publish.failed', { message });
    return { success: false, message };
  } finally {
    await context.close();
  }
}
