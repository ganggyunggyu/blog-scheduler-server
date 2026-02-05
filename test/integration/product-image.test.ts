import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { readdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import { getProductData, prepareProductImages } from '../../src/services/product-image.service';
import { PRODUCT_IMAGE_KEYWORDS, KEYWORDS } from '../fixtures/test-data';

test('[ProductImage] 애견 키워드 (product-images)', async () => {
  const data = await getProductData(PRODUCT_IMAGE_KEYWORDS.pet);

  console.log(`  body:               ${data.bodyImages.length}`);
  console.log(`  excludeLibrary:     ${data.excludeLibrary.length}`);
  console.log(`  excludeLibraryLink: ${data.excludeLibraryLink.length}`);
  console.log(`  individual:         ${data.multiImages.individual.length}`);
  console.log(`  slide:              ${data.multiImages.slide.length}`);
  console.log(`  collage:            ${data.multiImages.collage.length}`);
  console.log(`  metadata:           ${JSON.stringify(data.metadata)}`);

  assert.ok(Array.isArray(data.bodyImages), 'bodyImages should be array');
  assert.ok(data.metadata, 'metadata should exist');
});

test('[ProductImage] 안과 키워드 (product-images)', async () => {
  const data = await getProductData(PRODUCT_IMAGE_KEYWORDS.eye);

  console.log(`  body:               ${data.bodyImages.length}`);
  console.log(`  slide:              ${data.multiImages.slide.length}`);
  console.log(`  excludeLibrary:     ${data.excludeLibrary.length}`);
  console.log(`  excludeLibraryLink: ${data.excludeLibraryLink.length}`);
  console.log(`  metadata:           ${JSON.stringify(data.metadata)}`);

  assert.ok(data.bodyImages.length > 0, 'should have body images');
});

test('[ProductImage] 한려담원 (category-random)', async () => {
  const data = await getProductData(KEYWORDS.한려담원.keyword, undefined, KEYWORDS.한려담원.category);

  console.log(`  body:               ${data.bodyImages.length}`);
  console.log(`  metadata:           ${JSON.stringify(data.metadata)}`);

  assert.ok(data.bodyImages.length > 0, 'should have body images from category-random');
  assert.ok(data.metadata.url, 'should have smartstore url');
});

test('[ProductImage] 존재하지 않는 키워드 → 빈 응답', async () => {
  const data = await getProductData(PRODUCT_IMAGE_KEYWORDS.unknown);

  console.log(`  body:     ${data.bodyImages.length}`);
  console.log(`  total:    0 expected`);

  assert.equal(data.bodyImages.length, 0, 'should return empty body');
});

test('[ProductImage] prepareProductImages 다운로드 검증', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'test-images-'));

  try {
    const result = await prepareProductImages(PRODUCT_IMAGE_KEYWORDS.pet, tmpDir);

    console.log(`  bodyImages:         ${result.bodyImages.length}`);
    console.log(`  excludeLibrary:     ${result.excludeLibrary.length}`);
    console.log(`  excludeLibraryLink: ${result.excludeLibraryLink.length}`);

    const files = await readdir(tmpDir);
    console.log(`  downloaded files:   ${files.length} → ${files.join(', ')}`);

    for (const p of result.bodyImages) {
      assert.ok(p.startsWith(tmpDir), `body image path should be in tmpDir: ${p}`);
    }
    for (const p of result.excludeLibrary) {
      assert.ok(path.basename(p).includes('라이브러리제외'), `filename should contain 라이브러리제외: ${p}`);
    }
    for (const item of result.excludeLibraryLink) {
      console.log(`  libLink: ${path.basename(item.imagePath)} → ${item.url || '(empty)'}`);
      assert.ok(item.imagePath, 'imagePath should exist');
      assert.equal(typeof item.url, 'string', 'url should be string');
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
