import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { prepareProductImages, prepareJob, getCategory } from '../../src/services/manuscript.service';
import { generateAndDownloadAIImages } from '../../src/services/manuscript.service';
import { getValidCookies } from '../../src/services/naver-auth.service';
import { writePost } from '../../src/services/naver-blog.service';
import { TEST_ACCOUNT, PIPELINE_CASES, type PipelineConfig } from '../fixtures/test-data';

const runPipelineTest = async ({ keyword, manuscriptType, blogId, keywordCategoryOverride }: PipelineConfig) => {
  const keywordCategory = keywordCategoryOverride ?? await getCategory(keyword);
  console.log(`  카테고리: ${keywordCategory}`);

  const prepared = await prepareJob(keyword, 'default', '', false, 10, 'product', manuscriptType);
  console.log(`  원고: ${prepared.title.slice(0, 50)} (${prepared.content.length} chars)`);

  const imagesDir = path.join(prepared.jobDir, 'images');
  const productData = await prepareProductImages(keyword, imagesDir, blogId, keywordCategoryOverride);
  console.log(`  body=${productData.bodyImages.length} excludeLib=${productData.excludeLibrary.length} excludeLibLink=${productData.excludeLibraryLink.length}`);
  console.log(`  multi: individual=${productData.multiImages.individual?.length ?? 0} slide=${productData.multiImages.slide?.length ?? 0} collage=${productData.multiImages.collage?.length ?? 0}`);

  if (productData.bodyImages.length === 0) {
    productData.bodyImages = await generateAndDownloadAIImages(keyword, 5, imagesDir);
    console.log(`  body fallback AI: ${productData.bodyImages.length}`);
  }

  const auth = await getValidCookies(TEST_ACCOUNT.id, TEST_ACCOUNT.pw);
  console.log(`  로그인: ${auth.fromCache ? 'cache' : 'fresh'}`);

  const result = await writePost({
    cookies: auth.cookies,
    title: prepared.title,
    content: prepared.content,
    images: productData.bodyImages,
    multiImages: productData.multiImages,
    excludeLibrary: productData.excludeLibrary,
    excludeLibraryLink: productData.excludeLibraryLink,
    metadata: productData.metadata,
    keywordCategory,
  });

  console.log(`  결과: ${result.success ? 'SUCCESS' : 'FAIL'} | ${result.postUrl ?? result.message}`);
  return result;
};

test('[E2E] 스마일라식 (안과)', async () => {
  const result = await runPipelineTest(PIPELINE_CASES.안과);
  assert.ok(result.success, `발행 실패: ${result.message}`);
  assert.ok(result.postUrl, 'postUrl should exist');
});

test('[E2E] 뱅갈고양이 (애견)', async () => {
  const result = await runPipelineTest(PIPELINE_CASES.애견);
  assert.ok(result.success, `발행 실패: ${result.message}`);
  assert.ok(result.postUrl, 'postUrl should exist');
});

test('[E2E] 한려담원', async () => {
  const result = await runPipelineTest(PIPELINE_CASES.한려담원);
  assert.ok(result.success, `발행 실패: ${result.message}`);
  assert.ok(result.postUrl, 'postUrl should exist');
});
