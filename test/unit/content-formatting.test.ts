import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SELECTORS } from '../../src/constants/selectors.js';
import {
  buildEyeBrandImageParagraphMap,
  buildImageParagraphMap,
  typeContentWithImages,
} from '../../src/lib/naver-editor/content.js';

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

test('buildImageParagraphMap: 소제목이 있으면 소제목 위치에 이미지를 매핑함', () => {
  const imageMap = buildImageParagraphMap(
    [
      '도입 문단',
      '1. 첫 번째 기준',
      '설명 문단',
      '2. 두 번째 기준',
      '마무리 문단',
    ],
    ['img-1', 'img-2', 'img-3'],
  );

  assert.deepEqual([...imageMap.entries()], [
    [1, 'img-1'],
    [3, 'img-2'],
  ]);
});

test('buildImageParagraphMap: 소제목이 없으면 일반 문단에 이미지를 분산 매핑함', () => {
  const imageMap = buildImageParagraphMap(
    [
      '첫 문단',
      '둘째 문단',
      '셋째 문단',
      '넷째 문단',
      '다섯째 문단',
    ],
    ['img-1', 'img-2'],
  );

  assert.deepEqual([...imageMap.entries()], [
    [1, 'img-1'],
    [3, 'img-2'],
  ]);
});

test('buildEyeBrandImageParagraphMap: 첫 이미지는 도입부 뒤, 이후 이미지는 소제목 뒤에 매핑함', () => {
  const imageMap = buildEyeBrandImageParagraphMap(
    [
      '본문 제목',
      '',
      '안녕하세요,',
      '에스앤비안과입니다.',
      '',
      '#소제목# 첫 번째 확인 기준',
      '첫 번째 본문',
      '',
      '#소제목# 두 번째 확인 기준',
      '두 번째 본문',
      '',
      '#소제목# 정리하면',
      '마무리 본문',
    ],
    ['slide_1.webp', 'slide_2.webp', 'slide_3.webp', 'slide_4.webp'],
  );

  assert.deepEqual([...imageMap.entries()], [
    [3, 'slide_1.webp'],
    [5, 'slide_2.webp'],
    [8, 'slide_3.webp'],
    [11, 'slide_4.webp'],
  ]);
});

test('buildEyeBrandImageParagraphMap: 소제목보다 이미지가 많으면 남은 문단에 추가 매핑함', () => {
  const imageMap = buildEyeBrandImageParagraphMap(
    [
      '본문 제목',
      '도입 문단',
      '#소제목# 첫 번째 확인 기준',
      '첫 번째 본문',
      '두 번째 본문',
      '마무리 본문',
    ],
    ['slide_1.webp', 'slide_2.webp', 'slide_3.webp'],
  );

  assert.equal(imageMap.size, 3);
  assert.equal(imageMap.get(1), 'slide_1.webp');
  assert.equal(imageMap.get(2), 'slide_2.webp');
  assert.ok([...imageMap.values()].includes('slide_3.webp'));
});
