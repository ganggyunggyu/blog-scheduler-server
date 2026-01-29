import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const createMockPage = () => {
  const typedKeys: string[] = [];
  const pressedKeys: string[] = [];

  return {
    keyboard: {
      type: mock.fn(async (text: string) => {
        typedKeys.push(text);
      }),
      press: mock.fn(async (key: string) => {
        pressedKeys.push(key);
      }),
    },
    waitForTimeout: mock.fn(async () => {}),
    getTypedKeys: () => typedKeys,
    getPressedKeys: () => pressedKeys,
  };
};

const typeLineAvoidingAutoList = async (
  page: ReturnType<typeof createMockPage>,
  line: string
): Promise<void> => {
  const numberedMatch = line.match(/^(\d+)\.(\s?)([가-힣a-zA-Z].*)$/);
  if (numberedMatch) {
    const [, number, , text] = numberedMatch;
    await page.keyboard.type(`${number}.`);
    await page.waitForTimeout();
    await page.keyboard.type('ㅁ');
    await page.waitForTimeout();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout();
    await page.keyboard.type(' ');
    await page.waitForTimeout();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout();
    await page.keyboard.press('Backspace');
    await page.waitForTimeout();
    await page.keyboard.type(text);
    return;
  }

  const listMatch = line.match(/^-\s+(.*)$/);
  if (listMatch) {
    const [, text] = listMatch;
    await page.keyboard.type('-');
    await page.waitForTimeout();
    await page.keyboard.type('ㅁ');
    await page.waitForTimeout();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout();
    await page.keyboard.type(' ');
    await page.waitForTimeout();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout();
    await page.keyboard.press('Backspace');
    await page.waitForTimeout();
    await page.keyboard.type(text);
    return;
  }

  await page.keyboard.type(line);
};

test('typeLineAvoidingAutoList: 일반 텍스트', async () => {
  const page = createMockPage();
  await typeLineAvoidingAutoList(page, '일반 텍스트입니다');

  assert.deepEqual(page.getTypedKeys(), ['일반 텍스트입니다']);
  assert.deepEqual(page.getPressedKeys(), []);
});

test('typeLineAvoidingAutoList: 숫자 리스트 (1. 텍스트)', async () => {
  const page = createMockPage();
  await typeLineAvoidingAutoList(page, '1. 첫번째 항목');

  assert.deepEqual(page.getTypedKeys(), ['1.', 'ㅁ', ' ', '첫번째 항목']);
  assert.deepEqual(page.getPressedKeys(), ['ArrowLeft', 'ArrowRight', 'Backspace']);
});

test('typeLineAvoidingAutoList: 대시 리스트 (- 텍스트)', async () => {
  const page = createMockPage();
  await typeLineAvoidingAutoList(page, '- 리스트 아이템');

  assert.deepEqual(page.getTypedKeys(), ['-', 'ㅁ', ' ', '리스트 아이템']);
  assert.deepEqual(page.getPressedKeys(), ['ArrowLeft', 'ArrowRight', 'Backspace']);
});

test('typeLineAvoidingAutoList: 숫자로 시작하지만 리스트 아님', async () => {
  const page = createMockPage();
  await typeLineAvoidingAutoList(page, '100원짜리 과자');

  assert.deepEqual(page.getTypedKeys(), ['100원짜리 과자']);
  assert.deepEqual(page.getPressedKeys(), []);
});

test('typeLineAvoidingAutoList: 대시로 시작하지만 공백 없음', async () => {
  const page = createMockPage();
  await typeLineAvoidingAutoList(page, '-하이픈으로시작');

  assert.deepEqual(page.getTypedKeys(), ['-하이픈으로시작']);
  assert.deepEqual(page.getPressedKeys(), []);
});
