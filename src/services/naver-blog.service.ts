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
  category?: string;
  scheduleTime?: string;
}

const waitForFrame = async (page: Page, name: string, timeout = 10000): Promise<Frame> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frame = page.frame({ name });
    if (frame) return frame;
    await page.waitForTimeout(500);
  }
  throw new Error(`Frame '${name}' not found within ${timeout}ms`);
};

const dismissPopups = async (frame: Frame): Promise<void> => {
  const popupSelectors = [
    SELECTORS.popup.cancel,
    SELECTORS.popup.helpClose,
    'button.se-popup-button-cancel',
    'button[class*="close"]',
  ];

  for (const selector of popupSelectors) {
    try {
      const el = await frame.$(selector);
      if (el && (await el.isVisible())) {
        await el.click();
        await frame.page().waitForTimeout(300);
      }
    } catch {
      continue;
    }
  }
};

const isSubheading = (line: string): boolean => {
  const patterns = [/^\d+\.\s/, /^[①②③④⑤⑥⑦⑧⑨⑩]/, /^【\d+】/, /^\[\d+\]/, /^▶\s*\d+/];
  const trimmed = line.trim();
  return patterns.some((pattern) => pattern.test(trimmed));
};

const typeLineAvoidingAutoList = async (page: Page, line: string): Promise<void> => {
  const match = line.match(/^(\d+)\.\s(.+)$/);
  if (match) {
    const [, number, text] = match;
    await page.keyboard.type(`${number}.`, { delay: 50 });
    await page.waitForTimeout(50);
    await page.keyboard.type('ㅁ', { delay: 50 });
    await page.waitForTimeout(50);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(30);
    await page.keyboard.type(' ', { delay: 50 });
    await page.waitForTimeout(50);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(30);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);
    await page.keyboard.type(text, { delay: 10 });
  } else {
    await page.keyboard.type(line, { delay: 10 });
  }
};

const matchImagesToSubheadings = (paragraphs: string[], images: string[]): Map<number, string> => {
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
};

const uploadImage = async (page: Page, frame: Frame, imagePath: string): Promise<boolean> => {
  const fileName = imagePath.split('/').pop();
  log.info('image.upload.start', { fileName, path: imagePath });

  const fs = await import('fs/promises');
  try {
    await fs.access(imagePath);
  } catch {
    log.warn('image.missing', { path: imagePath });
    return false;
  }

  try {
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
      const buttons = await frame.$$('button');
      log.info('image.button.scan', { count: buttons.length });
      return false;
    }

    const isVisible = await imageBtn.isVisible();
    log.info('image.button.visible', { visible: isVisible });

    if (!isVisible) {
      await imageBtn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }

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
};

const typeContentWithImages = async (
  page: Page,
  frame: Frame,
  content: string,
  images?: string[]
): Promise<void> => {
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
          // ignore
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
};

export const writePost = async (
  params: WritePostParams
): Promise<{
  success: boolean;
  postUrl?: string;
  message: string;
}> => {
  const { cookies, title, content, images, category, scheduleTime } = params;
  const progress = new ProgressBar({ label: 'publish', total: 5, width: 14 });

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

    try {
      const alignBtn = await frame.$(SELECTORS.editor.alignDropdown);
      if (alignBtn && (await alignBtn.isVisible())) {
        await alignBtn.click();
        await page.waitForTimeout(500);
        await frame.waitForSelector(SELECTORS.editor.alignCenter, { timeout: 3000 });
        await frame.click(SELECTORS.editor.alignCenter);
        await page.waitForTimeout(300);
        log.info('align.center');
      }
    } catch {
      log.warn('align.center.failed');
    }

    log.info(progress.step('editor.ready'));

    const fullText = `${title}\n${content}`;
    await typeContentWithImages(page, frame, fullText, images);
    log.info(progress.step('content.entered'));

    await frame.click(SELECTORS.publish.btn);
    await page.waitForTimeout(2000);
    log.info(progress.step('publish.dialog'));

    const dialogCtx = frame;

    if (category) {
      try {
        const categoryBtn = await dialogCtx.$(SELECTORS.publish.categoryBtn);
        if (categoryBtn && (await categoryBtn.isVisible())) {
          await categoryBtn.click();
          await page.waitForTimeout(500);

          const categoryItems = await dialogCtx.$$(SELECTORS.publish.categoryItem);
          let categorySelected = false;

          for (const item of categoryItems) {
            const text = await item.textContent();
            if (text && text.includes(category)) {
              await item.click();
              await page.waitForTimeout(300);
              log.info('category.selected', { category });
              categorySelected = true;
              break;
            }
          }

          if (!categorySelected) {
            log.warn('category.not_found', { category });
          }
        }
      } catch (err) {
        log.warn('category.failed', { category, message: err instanceof Error ? err.message : String(err) });
      }
    }

    try {
      await dialogCtx.click(SELECTORS.publish.publicRadio);
      await page.waitForTimeout(300);
    } catch {
      await page.click(SELECTORS.publish.publicRadio);
      await page.waitForTimeout(300);
    }

    if (scheduleDate) {
      log.info('schedule.mode', { scheduleDate: scheduleDate.toISOString() });

      const scheduleRadioSelectors = [
        'label[for="radio_time2"]',
        'label.radio_label__mB6ia',
        SELECTORS.publish.scheduleRadio,
      ];

      let radioClicked = false;

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
        log.warn('schedule.timeSetting.retry');
        try {
          await frame.getByText('예약', { exact: true }).click({ force: true });
        } catch {
          await page.getByText('예약', { exact: true }).click({ force: true });
        }
        await page.waitForTimeout(1000);
      }

      const hourSelectors = [
        'select.hour_option__J_heO',
        'select[class*="hour"]',
        '.time_setting__v6YRU select:first-of-type',
        'div[class*="time_setting"] select:first-of-type',
      ];

      let hourSelectFound = false;
      let hourSelectCtx: typeof frame | typeof page = frame;

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
        const frameSelects = await frame.$$('select');
        const pageSelects = await page.$$('select');
        log.error('schedule.hourSelect.missing', {
          frameSelectCount: frameSelects.length,
          pageSelectCount: pageSelects.length,
        });
        throw new Error('시간 선택기를 찾을 수 없음');
      }

      const today = new Date();
      const isToday =
        scheduleDate.getFullYear() === today.getFullYear() &&
        scheduleDate.getMonth() === today.getMonth() &&
        scheduleDate.getDate() === today.getDate();

      if (!isToday) {
        await hourSelectCtx.click(SELECTORS.publish.dateInput, { timeout: 3000 });
        await page.waitForTimeout(500);

        await hourSelectCtx.waitForSelector(SELECTORS.publish.datepickerHeader, { timeout: 3000 });
        log.info('schedule.datepicker.opened');

        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        const targetMonth = scheduleDate.getMonth();
        const targetYear = scheduleDate.getFullYear();
        const monthDiff = (targetYear - currentYear) * 12 + (targetMonth - currentMonth);

        for (let i = 0; i < monthDiff; i += 1) {
          await hourSelectCtx.click(SELECTORS.publish.datepickerNextMonth, { timeout: 3000 });
          await page.waitForTimeout(300);
        }

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

      const hourStr = scheduleDate.getHours().toString().padStart(2, '0');
      const minuteStr = (Math.floor(scheduleDate.getMinutes() / 10) * 10).toString().padStart(2, '0');

      await hourSelectCtx.selectOption(SELECTORS.publish.hourSelect, hourStr);
      await page.waitForTimeout(300);
      await hourSelectCtx.selectOption(SELECTORS.publish.minuteSelect, minuteStr);
      await page.waitForTimeout(300);

      log.info('schedule.time.set', { hour: hourStr, minute: minuteStr });
    }

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
};
