import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SELECTORS } from '../../src/constants/selectors.js';
import {
  buildEyeBrandImageParagraphMap,
  buildImageParagraphMap,
  shouldSkipEyeBrandLine,
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

const createMockFrame = (
  events: string[],
  options: { linkButtonAvailable?: boolean } = {},
) => {
  const { linkButtonAvailable = true } = options;
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

  const linkButton = {
    click: mock.fn(async () => {
      events.push('click:link-button');
    }),
    isVisible: mock.fn(async () => true),
  };

  const linkInput = {
    fill: mock.fn(async (url: string) => {
      events.push(`fill:link:${url}`);
    }),
  };

  const linkSearchButton = {
    click: mock.fn(async () => {
      events.push('click:link-search');
    }),
  };

  const linkConfirmButton = {
    click: mock.fn(async () => {
      events.push('click:link-confirm');
    }),
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
      if (selector === 'button[data-name="oglink"]') return linkButtonAvailable ? linkButton : null;
      if (selector === 'input.se-popup-oglink-input') return linkInput;
      if (selector === 'button.se-popup-oglink-button') return linkSearchButton;
      if (selector === 'button.se-popup-button-confirm') return linkConfirmButton;
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

test('typeContentWithImages: 필수 이미지 업로드 실패 시 예외를 던짐', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents());

  await assert.rejects(
    typeContentWithImages(
      page as never,
      frame as never,
      ['첫 문단', '둘째 문단', '셋째 문단'].join('\n'),
      ['/tmp/scheduler-server-missing-image.webp'],
      { requireAllImages: true },
    ),
    /image upload failed: \/tmp\/scheduler-server-missing-image\.webp/,
  );
});

test('typeContentWithImages: 최소 이미지 삽입 수를 만족하지 못하면 예외를 던짐', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents());

  await assert.rejects(
    typeContentWithImages(
      page as never,
      frame as never,
      ['첫 문단', '둘째 문단', '셋째 문단'].join('\n'),
      ['/tmp/scheduler-server-missing-image.webp'],
      { minUploadedImages: 1 },
    ),
    /image upload requirement failed: required=1 uploaded=0/,
  );
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

test('buildEyeBrandImageParagraphMap: 정밀검사 인사말이 있으면 첫 이미지는 해당 줄 직후로 매핑함', () => {
  const imageMap = buildEyeBrandImageParagraphMap(
    [
      '고도근시 라식 가능할까 각막 얇을 때 시력교정 방법',
      '',
      '안녕하세요,',
      '',
      '정밀검사로 한 사람 한 사람 눈을 들여다보는 에스앤비안과입니다.',
      'https://blog.naver.com/adplan3th/224094493829',
      '',
      '오늘은 기준을 정리하겠습니다.',
      '',
      '1. 첫 번째 확인 기준',
      '[IMG] 통유리 수술실과 정밀 진료 환경 전경',
      '첫 번째 본문',
    ],
    ['slide_1.webp', 'slide_2.webp'],
  );

  assert.deepEqual([...imageMap.entries()], [
    [4, 'slide_1.webp'],
    [10, 'slide_2.webp'],
  ]);
});

test('shouldSkipEyeBrandLine: IMG 자리표시자와 단독 URL은 본문 타이핑에서 제외함', () => {
  assert.equal(shouldSkipEyeBrandLine('[IMG] 통유리 수술실과 정밀 진료 환경 전경'), true);
  assert.equal(shouldSkipEyeBrandLine('https://blog.naver.com/adplan3th/224094493829'), true);
  assert.equal(shouldSkipEyeBrandLine('정밀검사로 한 사람 한 사람 눈을 들여다보는 에스앤비안과입니다.'), false);
});

test('typeContentWithImages: 안과브랜드는 IMG 자리표시자는 건너뛰고 단독 URL은 링크 컴포넌트로 넣음', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents());

  await typeContentWithImages(
    page as never,
    frame as never,
    [
      '고도근시 라식 가능할까 각막 얇을 때 시력교정 방법',
      'https://blog.naver.com/adplan3th/224094493829',
      '[IMG] 통유리 수술실과 정밀 진료 환경 전경',
      '본문 첫줄',
    ].join('\n'),
    [],
    { imagePlacement: 'eyeBrand' },
  );

  const events = page.getEvents();
  assert.ok(events.includes('type:고도근시 라식 가능할까 각막 얇을 때 시력교정 방법'));
  assert.ok(events.includes('type:본문 첫줄'));
  assert.ok(events.includes('click:link-button'));
  assert.ok(events.includes('fill:link:https://blog.naver.com/adplan3th/224094493829'));
  assert.ok(events.includes('click:link-confirm'));
  assert.equal(events.some((event) => event.includes('[IMG]')), false);
  assert.equal(events.some((event) => event === 'type:https://blog.naver.com/adplan3th/224094493829'), false);
});

test('typeContentWithImages: 안과브랜드 단독 URL 링크 삽입 실패 시 예외를 던짐', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents(), { linkButtonAvailable: false });

  await assert.rejects(
    typeContentWithImages(
      page as never,
      frame as never,
      [
        '고도근시 라식 가능할까 각막 얇을 때 시력교정 방법',
        'https://blog.naver.com/adplan3th/224094493829',
        '본문 첫줄',
      ].join('\n'),
      [],
      { imagePlacement: 'eyeBrand' },
    ),
    /eye brand link insertion failed: https:\/\/blog\.naver\.com\/adplan3th\/224094493829/,
  );
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
