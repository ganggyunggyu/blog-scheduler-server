import type { Frame, Page } from 'playwright';
import { env } from '../../config/env.js';
import { SELECTORS } from '../../constants/selectors.js';
import { logger } from '../logging/logger.js';

const log = logger.child({ scope: 'Schedule' });
const ACTION_TIMEOUT_MS = env.PLAYWRIGHT_ACTION_TIMEOUT_MS;

const SCHEDULE_RADIO_SELECTORS = [
  'label[for="radio_time2"]',
  'label.radio_label__mB6ia',
  SELECTORS.publish.scheduleRadio,
];

const HOUR_SELECTORS = [
  'select.hour_option__J_heO',
  'select[class*="hour"]',
  '.time_setting__v6YRU select:first-of-type',
  'div[class*="time_setting"] select:first-of-type',
];

const clickScheduleRadio = async (page: Page, frame: Frame): Promise<boolean> => {
  for (const selector of SCHEDULE_RADIO_SELECTORS) {
    try {
      const el = await frame.$(selector);
      if (el && (await el.isVisible())) {
        await el.click({ timeout: ACTION_TIMEOUT_MS });
        await page.waitForTimeout(1000);
        log.info('radio.clicked', { selector, ctx: 'frame' });
        return true;
      }
    } catch {
      continue;
    }
  }

  for (const selector of SCHEDULE_RADIO_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el && (await el.isVisible())) {
        await el.click({ timeout: ACTION_TIMEOUT_MS });
        await page.waitForTimeout(1000);
        log.info('radio.clicked', { selector, ctx: 'page' });
        return true;
      }
    } catch {
      continue;
    }
  }

  try {
    await frame.getByText('예약', { exact: true }).click({
      timeout: ACTION_TIMEOUT_MS,
    });
    await page.waitForTimeout(1000);
    log.info('radio.clicked', { method: 'getByText', ctx: 'frame' });
    return true;
  } catch {
    try {
      await page.getByText('예약', { exact: true }).click({
        timeout: ACTION_TIMEOUT_MS,
      });
      await page.waitForTimeout(1000);
      log.info('radio.clicked', { method: 'getByText', ctx: 'page' });
      return true;
    } catch {
      log.warn('radio.getByText.failed');
    }
  }

  return false;
};

const waitForTimeSetting = async (page: Page, frame: Frame): Promise<boolean> => {
  try {
    await frame.waitForSelector(SELECTORS.publish.timeSetting, { timeout: 5000 });
    log.info('timeSetting.visible', { ctx: 'frame' });
    return true;
  } catch {
    try {
      await page.waitForSelector(SELECTORS.publish.timeSetting, { timeout: 5000 });
      log.info('timeSetting.visible', { ctx: 'page' });
      return true;
    } catch {
      log.warn('timeSetting.notFound');
      return false;
    }
  }
};

const findHourSelectContext = async (
  page: Page,
  frame: Frame
): Promise<{ found: boolean; ctx: typeof frame | typeof page }> => {
  for (const selector of HOUR_SELECTORS) {
    try {
      const el = await frame.waitForSelector(selector, { timeout: 3000 });
      if (el) {
        log.info('hourSelect.found', { selector, ctx: 'frame' });
        return { found: true, ctx: frame };
      }
    } catch {
      continue;
    }
  }

  for (const selector of HOUR_SELECTORS) {
    try {
      const el = await page.waitForSelector(selector, { timeout: 3000 });
      if (el) {
        log.info('hourSelect.found', { selector, ctx: 'page' });
        return { found: true, ctx: page };
      }
    } catch {
      continue;
    }
  }

  const frameSelects = await frame.$$('select');
  const pageSelects = await page.$$('select');
  log.error('hourSelect.missing', {
    frameSelectCount: frameSelects.length,
    pageSelectCount: pageSelects.length,
  });

  return { found: false, ctx: frame };
};

const selectDate = async (
  page: Page,
  ctx: Frame | Page,
  scheduleDate: Date
): Promise<void> => {
  const today = new Date();
  const isToday =
    scheduleDate.getFullYear() === today.getFullYear() &&
    scheduleDate.getMonth() === today.getMonth() &&
    scheduleDate.getDate() === today.getDate();

  if (isToday) return;

  await ctx.click(SELECTORS.publish.dateInput, { timeout: 3000 });
  await page.waitForTimeout(500);

  await ctx.waitForSelector(SELECTORS.publish.datepickerHeader, { timeout: 3000 });
  log.info('datepicker.opened');

  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const targetMonth = scheduleDate.getMonth();
  const targetYear = scheduleDate.getFullYear();
  const monthDiff = (targetYear - currentYear) * 12 + (targetMonth - currentMonth);

  for (let i = 0; i < monthDiff; i += 1) {
    await ctx.click(SELECTORS.publish.datepickerNextMonth, { timeout: 3000 });
    await page.waitForTimeout(300);
  }

  const daySelector = 'td:not(.ui-state-disabled) button.ui-state-default';
  const dayButtons = await ctx.$$(daySelector);
  const targetDay = scheduleDate.getDate().toString();

  for (const btn of dayButtons) {
    const text = await btn.textContent();
    if (text && text.trim() === targetDay) {
      await btn.click();
      await page.waitForTimeout(500);
      log.info('date.selected', { day: targetDay });
      return;
    }
  }

  throw new Error(`날짜 선택 실패: ${targetDay}일`);
};

const selectTime = async (
  page: Page,
  ctx: Frame | Page,
  scheduleDate: Date
): Promise<void> => {
  const hourStr = scheduleDate.getHours().toString().padStart(2, '0');
  const minuteStr = (Math.floor(scheduleDate.getMinutes() / 10) * 10).toString().padStart(2, '0');

  await ctx.selectOption(SELECTORS.publish.hourSelect, hourStr);
  await page.waitForTimeout(300);
  await ctx.selectOption(SELECTORS.publish.minuteSelect, minuteStr);
  await page.waitForTimeout(300);

  log.info('time.set', { hour: hourStr, minute: minuteStr });
};

export const setScheduleTime = async (
  page: Page,
  frame: Frame,
  scheduleDate: Date
): Promise<void> => {
  log.info('schedule.start', { scheduleDate: scheduleDate.toISOString() });

  const radioClicked = await clickScheduleRadio(page, frame);
  if (!radioClicked) {
    throw new Error('예약 라디오 버튼을 찾을 수 없음');
  }

  let timeSettingVisible = await waitForTimeSetting(page, frame);
  if (!timeSettingVisible) {
    log.warn('timeSetting.retry');
    try {
      await frame.getByText('예약', { exact: true }).click({
        force: true,
        timeout: ACTION_TIMEOUT_MS,
      });
    } catch {
      await page.getByText('예약', { exact: true }).click({
        force: true,
        timeout: ACTION_TIMEOUT_MS,
      });
    }
    await page.waitForTimeout(1000);
  }

  const { found, ctx } = await findHourSelectContext(page, frame);
  if (!found) {
    throw new Error('시간 선택기를 찾을 수 없음');
  }

  await selectDate(page, ctx, scheduleDate);
  await selectTime(page, ctx, scheduleDate);
};
