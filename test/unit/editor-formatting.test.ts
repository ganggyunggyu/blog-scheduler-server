import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SELECTORS } from '../../src/constants/selectors.js';
import { forceTextComponentsFontColorWhite, setAlignCenter } from '../../src/lib/naver-editor/editor.js';

const createMockPage = () => {
  const events: string[] = [];

  return {
    keyboard: {
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

const createMockToolbarButton = (events: string[], label: string) => ({
  click: mock.fn(async () => {
    events.push(`click:${label}`);
  }),
  isVisible: mock.fn(async () => true),
  getAttribute: mock.fn(async () => null),
});

const createMockFrame = (events: string[], evaluateResults: unknown[]) => {
  const alignDropdown = createMockToolbarButton(events, 'align-dropdown');
  const alignCenter = createMockToolbarButton(events, 'align-center');

  return {
    $$: mock.fn(async () => []),
    $: mock.fn(async (selector: string) => {
      if (selector === SELECTORS.editor.alignDropdown) {
        return alignDropdown;
      }

      if (selector === SELECTORS.editor.alignCenter) {
        return alignCenter;
      }

      return null;
    }),
    waitForSelector: mock.fn(async (selector: string) => {
      events.push(`waitForSelector:${selector}`);
      return true;
    }),
    evaluate: mock.fn(async () => evaluateResults.shift()),
  };
};

test('setAlignCenter: 첫 정렬이 부분 적용되면 Meta+a fallback으로 재시도함', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents(), [
    undefined,
    true,
    { centered: 1, total: 3 },
    undefined,
    true,
    { centered: 3, total: 3 },
  ]);

  const result = await setAlignCenter(page as never, frame as never);

  assert.equal(result, true);

  const events = page.getEvents();
  assert.equal(events.filter((event) => event === 'click:align-dropdown').length, 2);
  assert.equal(events.filter((event) => event === 'click:align-center').length, 2);
  assert.ok(events.includes('press:Meta+a'));
});

test('setAlignCenter: 선택 준비가 모두 실패하면 false를 반환함', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents(), [
    undefined,
    false,
    undefined,
    false,
  ]);

  const result = await setAlignCenter(page as never, frame as never);

  assert.equal(result, false);
  assert.equal(page.getEvents().includes('click:align-dropdown'), false);
  assert.equal(page.getEvents().includes('click:align-center'), false);
});

test('setAlignCenter: toolbar 정렬이 모두 실패하면 DOM fallback으로 마무리함', async () => {
  const page = createMockPage();
  const frame = createMockFrame(page.getEvents(), [
    undefined,
    true,
    { centered: 0, total: 3 },
    undefined,
    true,
    { centered: 0, total: 3 },
    3,
    { centered: 3, total: 3 },
  ]);

  const result = await setAlignCenter(page as never, frame as never);

  assert.equal(result, true);
  assert.equal(page.getEvents().includes('click:align-dropdown'), true);
  assert.equal(page.getEvents().includes('click:align-center'), true);
});

test('forceTextComponentsFontColorWhite: DOM fallback 적용 개수를 반환함', async () => {
  const events: string[] = [];
  const frame = createMockFrame(events, [4]);

  const result = await forceTextComponentsFontColorWhite(frame as never);

  assert.equal(result, 4);
});
