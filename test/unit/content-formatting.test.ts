import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SELECTORS } from '../../src/constants/selectors.js';
import { typeContentWithImages } from '../../src/lib/naver-editor/content.js';

const createMockPage = () => {
  const events: string[] = [];

  return {
    keyboard: {
      type: mock.fn(async (text: string) => {
        events.push(`type:${text}`);
      }),
      press: mock.fn(async (key: string) => {
        events.push(`press:${key}`);
      }),
    },
    waitForTimeout: mock.fn(async () => {
      events.push('wait');
    }),
    getEvents: () => events,
  };
};

const createMockFrame = (events: string[]) => {
  const alignDropdown = {
    click: mock.fn(async () => {
      events.push('click:align-dropdown');
    }),
    isVisible: mock.fn(async () => true),
  };

  const boldButton = {
    click: mock.fn(async () => {
      events.push('click:bold');
    }),
    isVisible: mock.fn(async () => true),
    getAttribute: mock.fn(async (name: string) =>
      name === 'class'
        ? 'se-bold-toolbar-button se-contents-toolbar-toggle-button __se-sentry se-is-activated'
        : null
    ),
  };

  const fontSizeDropdown = {
    click: mock.fn(async () => {
      events.push('click:font-size-dropdown');
    }),
    isVisible: mock.fn(async () => true),
  };

  const fontSize15 = {
    click: mock.fn(async () => {
      events.push('click:font-size-15');
    }),
    isVisible: mock.fn(async () => true),
  };

  const lastParagraph = {
    click: mock.fn(async () => {
      events.push('click:last-paragraph');
    }),
    last: mock.fn(function () {
      return this;
    }),
  };

  return {
    $: mock.fn(async (selector: string) => {
      if (selector === SELECTORS.editor.alignDropdown) return alignDropdown;
      if (selector === SELECTORS.editor.bold) return boldButton;
      if (selector === SELECTORS.editor.fontSizeDropdown) return fontSizeDropdown;
      if (selector === SELECTORS.editor.fontSize15) return fontSize15;
      return null;
    }),
    evaluate: mock.fn(async () => {
      events.push('evaluate:frame');
      return true;
    }),
    waitForSelector: mock.fn(async (selector: string) => {
      events.push(`waitForSelector:${selector}`);
      return true;
    }),
    click: mock.fn(async (selector: string) => {
      events.push(`click:${selector}`);
    }),
    locator: mock.fn(() => lastParagraph),
  };
};

test('typeContentWithImages: 애견은 content 직전 typing style reset을 수행함', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents());

  await typeContentWithImages(page as never, frame as never, '본문 첫줄', [], {
    keywordCategory: '애견',
  });

  const events = page.getEvents();
  assert.ok(events.includes('press:Escape'));
  assert.ok(events.includes('click:bold'));
  assert.ok(events.includes('click:font-size-dropdown'));
  assert.ok(events.includes('click:font-size-15'));

  const escapeIndex = events.indexOf('press:Escape');
  const boldIndex = events.indexOf('click:bold');
  const fontSize15Index = events.indexOf('click:font-size-15');
  const typeIndex = events.indexOf('type:본문 첫줄');

  assert.ok(boldIndex > escapeIndex);
  assert.ok(fontSize15Index > boldIndex);
  assert.ok(typeIndex > fontSize15Index);
});

test('typeContentWithImages: 기본 카테고리는 pet 전용 reset을 수행하지 않음', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents());

  await typeContentWithImages(page as never, frame as never, '본문 첫줄');

  const events = page.getEvents();
  assert.equal(events.includes('press:Escape'), false);
  assert.equal(events.includes('click:font-size-15'), false);
  assert.ok(events.includes('type:본문 첫줄'));
});
