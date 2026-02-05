import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { prepareProductImages, prepareJob, getCategory } from '../../src/services/manuscript.service';
import { getValidCookies } from '../../src/services/naver-auth.service';
import {
  createSession,
  closeSession,
  getMainFrame,
  dismissPopups,
  focusEditor,
  setAlignCenter,
  typeContentWithImages,
  clickTitleArea,
  clickContentArea,
  findExcludedImages,
  filterNormalImages,
  uploadExcludedImage,
  insertMaps,
  insertLink,
  insertExcludeLibraryLinks,
  insertPhone,
  uploadFromMultiImageData,
  openPublishDialog,
  setPublicVisibility,
  confirmPublish,
} from '../../src/lib/naver-editor';
import type { ProductMetadata, ExcludeLibraryLinkItem } from '../../src/types/metadata';
import type { MultiImageData } from '../../src/lib/naver-editor/image';

import 'dotenv/config';

const KEYWORD = '뱅갈고양이';
const ACCOUNT_ID = process.env.TEST_ID!;
const ACCOUNT_PW = process.env.TEST_PW!;

test(`[E2E] ${KEYWORD} 에디터 작성 테스트`, async () => {
  // ── 1. 데이터 준비 ──
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 1: 데이터 준비                  ║');
  console.log('╚══════════════════════════════════════╝');

  const keywordCategory = await getCategory(KEYWORD);
  console.log(`  카테고리: ${keywordCategory}`);

  const prepared = await prepareJob(
    KEYWORD, 'default', '', false, 10, 'product', 'pet'
  );
  console.log(`  원고: ${prepared.title.slice(0, 50)}`);
  console.log(`  content: ${prepared.content.length} chars`);

  const imagesDir = path.join(prepared.jobDir, 'images');
  const productData = await prepareProductImages(KEYWORD, imagesDir);
  console.log(`  body: ${productData.bodyImages.length}`);
  console.log(`  excludeLib: ${productData.excludeLibrary.length}`);
  console.log(`  excludeLibLink: ${productData.excludeLibraryLink.length}`);
  console.log(`  individual: ${productData.multiImages.individual?.length ?? 0}`);
  console.log(`  slide: ${productData.multiImages.slide?.length ?? 0}`);
  console.log(`  collage: ${productData.multiImages.collage?.length ?? 0}`);
  console.log(`  metadata:`, JSON.stringify(productData.metadata));

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
    const editorUrl = 'https://blog.naver.com/GoBlogWrite.naver';
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    console.log(`  페이지 로드 완료: ${page.url()}`);

    const currentUrl = page.url();
    assert.ok(!currentUrl.includes('nidlogin'), '로그인 페이지로 리다이렉트되면 안됨');

    const frame = await getMainFrame(page);
    await page.waitForTimeout(2000);
    console.log(`  mainFrame 획득 완료`);

    // ── 4. 에디터 준비 ──
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  STEP 4: 에디터 준비                  ║');
    console.log('╚══════════════════════════════════════╝');

    await dismissPopups(frame);
    await focusEditor(page, frame);
    await setAlignCenter(page, frame);
    console.log(`  에디터 준비 완료`);

    // 이미지 분류
    const { bodyImages, excludeLibrary, excludeLibraryLink, multiImages, metadata } = productData;
    const normalImages = bodyImages;
    const excluded1 = excludeLibrary[0];
    const excluded2 = excludeLibrary[1];
    const excluded3 = excludeLibrary[2];
    console.log(`  normalImages: ${normalImages.length}`);
    console.log(`  excluded1: ${excluded1 ? path.basename(excluded1) : 'none'}`);
    console.log(`  excluded2: ${excluded2 ? path.basename(excluded2) : 'none'}`);
    console.log(`  excluded3: ${excluded3 ? path.basename(excluded3) : 'none'}`);

    // ── 5. 제목 입력 ──
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  STEP 5: 제목 입력                    ║');
    console.log('╚══════════════════════════════════════╝');

    await clickTitleArea(frame);
    await page.waitForTimeout(500);
    await page.keyboard.type(prepared.title, { delay: 30 });
    await page.waitForTimeout(500);
    console.log(`  제목: ${prepared.title}`);

    // ── 6. 본문 영역 이동 ──
    await clickContentArea(page, frame);
    await page.waitForTimeout(500);

    // ── 7. 파이프라인 실행 ──
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  STEP 6: 콘텐츠 파이프라인 실행       ║');
    console.log('╚══════════════════════════════════════╝');

    // excluded1
    console.log('\n  [1/9] excluded1');
    if (excluded1) {
      await uploadExcludedImage(page, excluded1);
      await page.waitForTimeout(500);
      console.log(`    ✓ ${path.basename(excluded1)} 업로드`);
    } else {
      console.log('    - skip');
    }

    // maps
    console.log('  [2/9] maps');
    if (metadata?.mapQueries?.length) {
      const mapResult = await insertMaps(page, frame, metadata.mapQueries);
      console.log(`    ✓ maps inserted (success: ${mapResult.success}, failed: ${mapResult.failed})`);
    } else {
      console.log('    - skip (no mapQueries)');
    }

    // phone
    console.log('  [3/9] phone');
    if (metadata?.phone) {
      const phoneResult = await insertPhone(page, frame, metadata.phone);
      console.log(`    ✓ phone inserted: ${metadata.phone} (${phoneResult})`);
    } else {
      console.log('    - skip (no phone)');
    }

    // excluded2
    console.log('  [4/9] excluded2');
    if (excluded2) {
      await uploadExcludedImage(page, excluded2);
      await page.waitForTimeout(500);
      console.log(`    ✓ ${path.basename(excluded2)} 업로드`);
    } else {
      console.log('    - skip');
    }

    // content + body images
    console.log('  [5/9] content + body images');
    await typeContentWithImages(page, frame, prepared.content, normalImages);
    console.log(`    ✓ content entered (${prepared.content.length} chars, ${normalImages.length} images)`);

    // excluded3
    console.log('  [6/9] excluded3');
    if (excluded3) {
      await uploadExcludedImage(page, excluded3);
      await page.waitForTimeout(500);
      console.log(`    ✓ ${path.basename(excluded3)} 업로드`);
    } else {
      console.log('    - skip');
    }

    // excludeLibraryLinks
    console.log('  [7/9] excludeLibraryLinks');
    if (excludeLibraryLink?.length) {
      const elResult = await insertExcludeLibraryLinks(page, frame, excludeLibraryLink);
      console.log(`    ✓ excludeLibraryLinks 완료 (total: ${elResult.total}, success: ${elResult.success}, failed: ${elResult.failed})`);
    } else {
      console.log('    - skip (no excludeLibraryLink)');
    }

    // link
    console.log('  [8/9] link');
    if (metadata?.url) {
      const linkResult = await insertLink(page, frame, metadata.url);
      console.log(`    ✓ link inserted: ${metadata.url} (${linkResult})`);
    } else {
      console.log('    - skip (no url)');
    }

    // multiImages
    console.log('  [9/9] multiImages');
    if (multiImages && (multiImages.individual?.length || multiImages.slide?.length || multiImages.collage?.length)) {
      const multiResult = await uploadFromMultiImageData(page, frame, multiImages);
      console.log(`    ✓ multiImages uploaded (total: ${multiResult.total}, success: ${multiResult.success}, failed: ${multiResult.failed})`);
    } else {
      console.log('    - skip (no multiImages)');
    }

    // 가운데 정렬
    await setAlignCenter(page, frame);
    await page.waitForTimeout(500);

    // ── 발행 ──
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║  STEP 7: 발행                        ║');
    console.log('╚══════════════════════════════════════╝');

    await openPublishDialog(page, frame);
    console.log('  발행 다이얼로그 열림');

    await setPublicVisibility(page, frame);
    console.log('  공개 설정 완료');

    const postUrl = await confirmPublish(page, frame);
    console.log(`  발행 완료: ${postUrl}`);

    assert.ok(postUrl, 'postUrl should exist');

    console.log('\n══════════════════════════════════════');
    console.log(`  전체 파이프라인 + 발행 완료`);
    console.log(`  postUrl: ${postUrl}`);
    console.log('══════════════════════════════════════\n');
  } finally {
    await closeSession(session);
    console.log('  세션 종료');
  }
});
