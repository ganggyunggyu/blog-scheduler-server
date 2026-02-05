import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { mkdir } from 'fs/promises';
import { prepareProductImages } from '../../src/services/manuscript.service';
import { getValidCookies } from '../../src/services/naver-auth.service';
import {
  createSession,
  closeSession,
  getMainFrame,
  dismissPopups,
  focusEditor,
  clickContentArea,
  insertExcludeLibraryLinks,
} from '../../src/lib/naver-editor';

import 'dotenv/config';

const KEYWORD = '뱅갈고양이';
const ACCOUNT_ID = process.env.TEST_ID!;
const ACCOUNT_PW = process.env.TEST_PW!;

test(`[E2E] excludeLibraryLink 삽입 테스트`, async () => {
  // ── 1. excludeLibraryLink 이미지 다운로드 ──
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 1: excludeLibraryLink 준비      ║');
  console.log('╚══════════════════════════════════════╝');

  const imagesDir = path.resolve(process.cwd(), 'data', 'test_exclude_link');
  await mkdir(imagesDir, { recursive: true });

  const productData = await prepareProductImages(KEYWORD, imagesDir);
  const { excludeLibraryLink } = productData;

  console.log(`  excludeLibraryLink: ${excludeLibraryLink.length}건`);
  for (const item of excludeLibraryLink) {
    console.log(`    - ${path.basename(item.imagePath)} → ${item.url}`);
  }
  assert.ok(excludeLibraryLink.length > 0, 'excludeLibraryLink가 1건 이상 있어야 함');

  // ── 2. 로그인 ──
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 2: 네이버 로그인                ║');
  console.log('╚══════════════════════════════════════╝');

  const auth = await getValidCookies(ACCOUNT_ID, ACCOUNT_PW);
  console.log(`  로그인 성공 (fromCache: ${auth.fromCache})`);
  assert.ok(auth.cookies, 'cookies should exist');

  // ── 3. 에디터 열기 ──
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 3: 블로그 에디터 열기            ║');
  console.log('╚══════════════════════════════════════╝');

  const session = await createSession(auth.cookies);
  const { page } = session;

  try {
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(3000);
    console.log(`  페이지 로드 완료: ${page.url()}`);

    assert.ok(!page.url().includes('nidlogin'), '로그인 페이지로 리다이렉트되면 안됨');

    const frame = await getMainFrame(page);
    await page.waitForTimeout(2000);
    console.log(`  mainFrame 획득 완료`);

    // ── 4. 에디터 준비 ──
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  STEP 4: 에디터 준비                  ║');
    console.log('╚══════════════════════════════════════╝');

    await dismissPopups(frame);
    await focusEditor(page, frame);
    await clickContentArea(page, frame);
    await page.waitForTimeout(500);
    console.log(`  에디터 준비 완료`);

    // ── 5. excludeLibraryLink 삽입 ──
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  STEP 5: excludeLibraryLink 삽입      ║');
    console.log('╚══════════════════════════════════════╝');

    const result = await insertExcludeLibraryLinks(page, frame, excludeLibraryLink);
    console.log(`  결과: total=${result.total}, success=${result.success}, failed=${result.failed}`);
    console.log(`  (addSpacing 포함 - 5초간 Enter)`);

    console.log('\n══════════════════════════════════════');
    console.log(`  excludeLibraryLink + spacing 완료`);
    console.log('══════════════════════════════════════\n');

    await page.waitForTimeout(3000);
  } finally {
    await closeSession(session);
    console.log('  세션 종료');
  }
});
