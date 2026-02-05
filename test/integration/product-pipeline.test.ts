import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { readdir } from 'fs/promises';
import { getProductData, prepareProductImages, prepareJob, getCategory } from '../../src/services/manuscript.service';

const KEYWORD = '뱅갈고양이';

test(`[Integration] ${KEYWORD} 전체 파이프라인`, async () => {
  // ── 1. 카테고리 판별 ──
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 1: 카테고리 판별               ║');
  console.log('╚══════════════════════════════════════╝');

  const keywordCategory = await getCategory(KEYWORD);
  console.log(`  키워드: ${KEYWORD}`);
  console.log(`  카테고리: ${keywordCategory}`);
  assert.ok(typeof keywordCategory === 'string', 'category should be string');

  // ── 2. 상품 이미지 API 응답 검증 ──
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 2: 상품 이미지 API 응답         ║');
  console.log('╚══════════════════════════════════════╝');

  const rawData = await getProductData(KEYWORD);
  console.log(`  body:               ${rawData.bodyImages.length}`);
  console.log(`  individual:         ${rawData.multiImages.individual.length}`);
  console.log(`  slide:              ${rawData.multiImages.slide.length}`);
  console.log(`  collage:            ${rawData.multiImages.collage.length}`);
  console.log(`  excludeLibrary:     ${rawData.excludeLibrary.length}`);
  console.log(`  excludeLibraryLink: ${rawData.excludeLibraryLink.length}`);
  console.log(`  metadata:`, JSON.stringify(rawData.metadata, null, 4));

  assert.ok(Array.isArray(rawData.bodyImages), 'bodyImages should be array');
  assert.ok(rawData.multiImages, 'multiImages should exist');
  assert.ok(rawData.metadata, 'metadata should exist');

  // ── 3. 원고 생성 ──
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 3: 원고 생성 (pet)              ║');
  console.log('╚══════════════════════════════════════╝');

  const prepared = await prepareJob(
    KEYWORD, 'default', '', false, 10, 'product', 'pet'
  );

  console.log(`  jobDir:       ${prepared.jobDir}`);
  console.log(`  manuscriptId: ${prepared.manuscriptId}`);
  console.log(`  title:        ${prepared.title.slice(0, 60)}`);
  console.log(`  content len:  ${prepared.content.length} chars`);
  console.log(`  images:       ${prepared.images.length} (product=0 expected)`);

  assert.ok(prepared.jobDir, 'jobDir should exist');
  assert.ok(prepared.title, 'title should exist');
  assert.ok(prepared.content.length > 0, 'content should not be empty');

  // ── 4. 상품 이미지 다운로드 ──
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 4: 상품 이미지 다운로드          ║');
  console.log('╚══════════════════════════════════════╝');

  const imagesDir = path.join(prepared.jobDir, 'images');
  const productData = await prepareProductImages(KEYWORD, imagesDir);

  console.log(`  bodyImages:         ${productData.bodyImages.length}`);
  console.log(`  excludeLibrary:     ${productData.excludeLibrary.length}`);
  console.log(`  excludeLibraryLink: ${productData.excludeLibraryLink.length}`);
  console.log(`  individual:         ${productData.multiImages.individual?.length ?? 0}`);
  console.log(`  slide:              ${productData.multiImages.slide?.length ?? 0}`);
  console.log(`  collage:            ${productData.multiImages.collage?.length ?? 0}`);
  console.log(`  metadata:`, JSON.stringify(productData.metadata, null, 4));

  // 다운로드 파일 목록 확인
  const files = await readdir(imagesDir);
  console.log(`  downloaded files (${files.length}):`, files);

  assert.ok(productData.bodyImages.length > 0, 'should have body images');
  for (const p of productData.bodyImages) {
    assert.ok(p.startsWith(imagesDir), `body image should be in imagesDir: ${p}`);
  }

  // excludeLibrary 파일명 확인
  for (const p of productData.excludeLibrary) {
    console.log(`  excludeLib file: ${path.basename(p)}`);
    assert.ok(p.includes('라이브러리제외'), `should contain 라이브러리제외: ${p}`);
  }

  // excludeLibraryLink 1:1 매핑 확인
  for (const item of productData.excludeLibraryLink) {
    console.log(`  libLink: ${path.basename(item.imagePath)} → ${item.url || '(no url)'}`);
    assert.ok(item.imagePath, 'should have imagePath');
    assert.ok(typeof item.url === 'string', 'url should be string');
  }

  // ── 5. Publish Job Data 구성 ──
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 5: Publish Job Data 조립        ║');
  console.log('╚══════════════════════════════════════╝');

  const publishJobData = {
    manuscript: {
      title: prepared.title,
      content: prepared.content,
      images: productData.bodyImages,
    },
    multiImages: productData.multiImages,
    excludeLibrary: productData.excludeLibrary,
    excludeLibraryLink: productData.excludeLibraryLink,
    metadata: productData.metadata,
    keywordCategory,
  };

  console.log(`  title:              ${publishJobData.manuscript.title.slice(0, 50)}`);
  console.log(`  content:            ${publishJobData.manuscript.content.length} chars`);
  console.log(`  body images:        ${publishJobData.manuscript.images.length}`);
  console.log(`  individual:         ${publishJobData.multiImages.individual?.length ?? 0}`);
  console.log(`  slide:              ${publishJobData.multiImages.slide?.length ?? 0}`);
  console.log(`  collage:            ${publishJobData.multiImages.collage?.length ?? 0}`);
  console.log(`  excludeLibrary:     ${publishJobData.excludeLibrary.length}`);
  console.log(`  excludeLibraryLink: ${publishJobData.excludeLibraryLink.length}`);
  console.log(`  metadata:`, JSON.stringify(publishJobData.metadata));
  console.log(`  keywordCategory:    ${publishJobData.keywordCategory}`);

  assert.ok(publishJobData.manuscript.images.length > 0, 'should have body images');
  assert.ok(publishJobData.manuscript.content.length > 0, 'should have content');

  console.log('\n══════════════════════════════════════');
  console.log('  전체 파이프라인 완료');
  console.log('══════════════════════════════════════\n');
});
