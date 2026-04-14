import { SELECTORS } from '../../constants/selectors.js';
import {
  applyBoldToSelection,
  applyFontSize24ToSelection,
  focusLastParagraphEnd,
  forceResetTypingStyleToDefault,
} from './editor.js';
import { logger } from '../logging/logger.js';

const log = logger.child({ scope: 'Phone' });

interface KeyboardController {
  type: (text: string, options?: { delay?: number }) => Promise<void>;
  press: (key: string) => Promise<void>;
}

interface PageController {
  keyboard: KeyboardController;
  waitForTimeout: (ms: number) => Promise<void>;
}

interface ClickOptions {
  force?: boolean;
}

interface ToolbarControl {
  click?: (options?: ClickOptions) => Promise<void>;
  fill?: (value: string) => Promise<void>;
  isVisible?: () => Promise<boolean>;
}

interface FrameController {
  $: (selector: string) => Promise<ToolbarControl | null>;
  dblclick?: (selector: string) => Promise<void>;
  waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
  evaluate: <T, Arg = undefined>(pageFunction: (arg: Arg) => T | Promise<T>, arg?: Arg) => Promise<T>;
}

const buildPhoneTextSelector = (phone: string): string =>
  `span.__se-node:text-is("${phone.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;

const buildPhoneLinkSelector = (phone: string): string =>
  `span.se-link[data-href="tel:${phone.replace(/-/g, '')}"]`;

const doubleClickPhoneText = async (
  page: PageController,
  frame: FrameController,
  selector: string,
  logKey: string
): Promise<boolean> => {
  if (!frame.dblclick) {
    log.warn(`${logKey}.unsupported`);
    return false;
  }

  try {
    await frame.dblclick(selector);
    await page.waitForTimeout(500);
    log.info(logKey);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`${logKey}.failed`, { selector, message });
    return false;
  }
};

const centerCurrentPhoneParagraph = async (
  page: PageController,
  frame: FrameController
): Promise<boolean> => {
  const alignBtn = await frame.$(SELECTORS.editor.alignDropdown);
  if (!alignBtn?.click || !alignBtn.isVisible) {
    log.warn('phone.align.dropdown.notFound');
    return false;
  }

  if (!(await alignBtn.isVisible())) {
    log.warn('phone.align.dropdown.hidden');
    return false;
  }

  await alignBtn.click();
  await page.waitForTimeout(300);

  const alignCenterBtn = await frame.$(SELECTORS.editor.alignCenter);
  if (!alignCenterBtn?.click || !alignCenterBtn.isVisible) {
    log.warn('phone.align.center.notFound');
    return false;
  }

  if (!(await alignCenterBtn.isVisible())) {
    log.warn('phone.align.center.hidden');
    return false;
  }

  await alignCenterBtn.click();
  await page.waitForTimeout(300);
  log.info('phone.align.centered');
  return true;
};

export const insertPhone = async (
  page: PageController,
  frame: FrameController,
  phone: string
): Promise<boolean> => {
  log.info('phone.insert.start', { phone });

  try {
    // 1. 전화번호 입력
    await page.keyboard.type(phone, { delay: 30 });
    await page.waitForTimeout(500);
    log.info('phone.typed', { phone });

    // 2. 더블클릭으로 전화번호 텍스트 실제 선택
    const textSelected = await doubleClickPhoneText(
      page,
      frame,
      buildPhoneTextSelector(phone),
      'phone.text.dblclicked'
    );
    if (!textSelected) {
      return false;
    }

    // 3. 링크 버튼 클릭
    const linkBtn = await frame.$(SELECTORS.editor.textLinkBtn);
    if (!linkBtn || !linkBtn.isVisible || !linkBtn.click) {
      log.warn('phone.linkBtn.notFound');
      return false;
    }

    if (!(await linkBtn.isVisible())) {
      log.warn('phone.linkBtn.hidden');
      return false;
    }

    await linkBtn.click();
    await page.waitForTimeout(500);
    log.info('phone.linkBtn.clicked');

    // 4. tel: 형식으로 입력
    const linkInput = await frame.$(SELECTORS.editor.linkInput);
    if (!linkInput || !linkInput.fill) {
      log.warn('phone.linkInput.notFound');
      return false;
    }

    const telUrl = `tel:${phone.replace(/-/g, '')}`;
    await linkInput.fill(telUrl);
    await page.waitForTimeout(300);
    log.info('phone.linkInput.filled', { telUrl });

    // 5. 링크 적용 버튼 클릭
    const linkApplyBtn = await frame.$(SELECTORS.editor.linkApplyBtn);
    if (!linkApplyBtn || !linkApplyBtn.click) {
      log.warn('phone.linkApplyBtn.notFound');
      return false;
    }

    await linkApplyBtn.click();
    await page.waitForTimeout(500);
    log.info('phone.linkApplyBtn.clicked');

    // 6. 생성된 링크만 다시 더블클릭해서 포맷 적용
    const linkSelected = await doubleClickPhoneText(
      page,
      frame,
      buildPhoneLinkSelector(phone),
      'phone.link.dblclicked'
    );
    if (!linkSelected) {
      return false;
    }

    const boldApplied = await applyBoldToSelection(page, frame);
    const fontSizeApplied = await applyFontSize24ToSelection(page, frame);
    const alignCentered = await centerCurrentPhoneParagraph(page, frame);
    log.info('phone.format.applied', { boldApplied, fontSizeApplied, alignCentered });

    // 7. 다음 문단으로 이동 후 typing 스타일을 기본값으로 복귀
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(200);

    const focused = await focusLastParagraphEnd(frame);
    if (!focused) {
      log.warn('phone.typingStyle.focus.failed');
      return false;
    }

    await page.waitForTimeout(200);
    await forceResetTypingStyleToDefault(page, frame);
    log.info('phone.typingStyle.reset');

    log.info('phone.insert.done', { phone });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('phone.insert.failed', { phone, message });
    return false;
  }
};
