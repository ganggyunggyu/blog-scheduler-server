import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SELECTORS } from '../../src/constants/selectors.js';
import {
  applyFontSize15ToSelection,
  resetTypingStyleToDefault,
  selectCurrentParagraphText,
} from '../../src/lib/naver-editor/editor.js';
import { insertPhone } from '../../src/lib/naver-editor/phone.js';

const createMockPage = () => {
  const events: string[] = [];
  const typedTexts: string[] = [];
  const pressedKeys: string[] = [];

  return {
    keyboard: {
      type: mock.fn(async (text: string) => {
        typedTexts.push(text);
        events.push(`type:${text}`);
      }),
      press: mock.fn(async (key: string) => {
        pressedKeys.push(key);
        events.push(`press:${key}`);
      }),
    },
    waitForTimeout: mock.fn(async () => {
      events.push('wait');
    }),
    getEvents: () => events,
    getTypedTexts: () => typedTexts,
    getPressedKeys: () => pressedKeys,
  };
};

const createMockFrame = (events: string[], isBoldActive = true) => {
  const boldButton = {
    click: mock.fn(async () => {
      events.push('click:bold');
    }),
    isVisible: mock.fn(async () => true),
    getAttribute: mock.fn(async (name: string) =>
      name === 'class'
        ? `se-bold-toolbar-button se-property-toolbar-toggle-button${isBoldActive ? ' se-is-activated' : ''}`
        : null
    ),
  };

  const fontSizeDropdown = {
    click: mock.fn(async () => {
      events.push('click:font-size-dropdown');
    }),
    isVisible: mock.fn(async () => true),
  };

  const fontSize24 = {
    click: mock.fn(async () => {
      events.push('click:font-size-24');
    }),
    isVisible: mock.fn(async () => true),
  };

  const fontSize15 = {
    click: mock.fn(async () => {
      events.push('click:font-size-15');
    }),
    isVisible: mock.fn(async () => true),
  };

  const alignDropdown = {
    click: mock.fn(async () => {
      events.push('click:align-dropdown');
    }),
    isVisible: mock.fn(async () => true),
  };

  const alignCenter = {
    click: mock.fn(async () => {
      events.push('click:align-center');
    }),
    isVisible: mock.fn(async () => true),
  };

  const textLinkButton = {
    click: mock.fn(async () => {
      events.push('click:text-link');
    }),
    isVisible: mock.fn(async () => true),
  };

  const linkInput = {
    fill: mock.fn(async (value: string) => {
      events.push(`fill:${value}`);
    }),
  };

  const linkApplyButton = {
    click: mock.fn(async () => {
      events.push('click:link-apply');
    }),
    isVisible: mock.fn(async () => true),
  };

  return {
    $: mock.fn(async (selector: string) => {
      if (selector === SELECTORS.editor.bold) return boldButton;
      if (selector === SELECTORS.editor.fontSizeDropdown) return fontSizeDropdown;
      if (selector === SELECTORS.editor.fontSize24) return fontSize24;
      if (selector === SELECTORS.editor.fontSize15) return fontSize15;
      if (selector === SELECTORS.editor.alignDropdown) return alignDropdown;
      if (selector === SELECTORS.editor.alignCenter) return alignCenter;
      if (selector === SELECTORS.editor.textLinkBtn) return textLinkButton;
      if (selector === SELECTORS.editor.linkInput) return linkInput;
      if (selector === SELECTORS.editor.linkApplyBtn) return linkApplyButton;
      return null;
    }),
    dblclick: mock.fn(async (selector: string) => {
      events.push(`dblclick:${selector}`);
    }),
    waitForSelector: mock.fn(async (selector: string) => {
      events.push(`waitForSelector:${selector}`);
      return true;
    }),
    evaluate: mock.fn(async () => {
      events.push('evaluate:select-paragraph');
      return true;
    }),
  };
};

test('selectCurrentParagraphText: 현재 문단 텍스트만 DOM Range로 선택함', async () => {
  const frame = createMockFrame([]);

  const result = await selectCurrentParagraphText(frame);

  assert.equal(result, true);
});

test('resetTypingStyleToDefault: bold가 active면 끄고 글꼴 15로 되돌림', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents(), true);

  await resetTypingStyleToDefault(page, frame);

  assert.ok(page.getEvents().includes('click:bold'));
  assert.ok(page.getEvents().includes('click:font-size-15'));
});

test('resetTypingStyleToDefault: bold가 inactive면 켜지지 않고 글꼴만 15로 맞춤', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents(), false);

  await resetTypingStyleToDefault(page, frame);

  assert.equal(page.getEvents().includes('click:bold'), false);
  assert.ok(page.getEvents().includes('click:font-size-15'));
});

test('applyFontSize15ToSelection: 글꼴 15 선택 옵션을 적용함', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents(), false);

  const result = await applyFontSize15ToSelection(page, frame);

  assert.equal(result, true);
  assert.ok(page.getEvents().includes('click:font-size-dropdown'));
  assert.ok(page.getEvents().includes('click:font-size-15'));
});

test('insertPhone: phone 단계에서 굵게 + 글꼴24 + 링크를 순서대로 적용함', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents());

  const result = await insertPhone(page, frame, '010-1234-5678');

  assert.equal(result, true);
  assert.deepEqual(page.getTypedTexts(), ['010-1234-5678']);
  assert.ok(
    page
      .getEvents()
      .includes('dblclick:span.__se-node:text-is("010-1234-5678")')
  );
  assert.ok(page.getEvents().includes('click:font-size-dropdown'));
  assert.ok(page.getEvents().includes('click:font-size-24'));
  assert.ok(page.getEvents().includes('click:text-link'));
  assert.ok(page.getEvents().includes('fill:tel:01012345678'));
  assert.ok(page.getEvents().includes('click:link-apply'));
  assert.ok(page.getEvents().includes('click:align-dropdown'));
  assert.ok(page.getEvents().includes('click:align-center'));
  assert.ok(
    page
      .getEvents()
      .includes('dblclick:span.se-link[data-href="tel:01012345678"]')
  );
  assert.ok(page.getEvents().includes('press:Escape'));
  assert.ok(page.getEvents().includes('click:font-size-15'));

  const firstBoldIndex = page.getEvents().indexOf('click:bold');
  const fontSizeDropdownIndex = page.getEvents().indexOf('click:font-size-dropdown');
  const fontSize24Index = page.getEvents().indexOf('click:font-size-24');
  const linkIndex = page.getEvents().indexOf('click:text-link');
  const linkApplyIndex = page.getEvents().indexOf('click:link-apply');
  const alignDropdownIndex = page.getEvents().indexOf('click:align-dropdown');
  const alignCenterIndex = page.getEvents().indexOf('click:align-center');
  const escapeIndex = page.getEvents().indexOf('press:Escape');
  const secondBoldIndex = page.getEvents().lastIndexOf('click:bold');
  const fontSize15Index = page.getEvents().lastIndexOf('click:font-size-15');

  assert.ok(linkIndex >= 0);
  assert.ok(linkApplyIndex > linkIndex);
  assert.ok(firstBoldIndex > linkApplyIndex);
  assert.ok(fontSizeDropdownIndex > firstBoldIndex);
  assert.ok(fontSize24Index > fontSizeDropdownIndex);
  assert.ok(alignDropdownIndex > fontSize24Index);
  assert.ok(alignCenterIndex > alignDropdownIndex);
  assert.ok(escapeIndex > alignCenterIndex);
  assert.ok(secondBoldIndex > escapeIndex);
  assert.ok(fontSize15Index > secondBoldIndex);
});
