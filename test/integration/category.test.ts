import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCategory } from '../../src/services/manuscript.service';
import { CATEGORY_CASES } from '../fixtures/test-data';

for (const { keyword, expected } of CATEGORY_CASES) {
  test(`[Category] ${keyword} → ${expected}`, async () => {
    const category = await getCategory(keyword);
    console.log(`  ${keyword} → ${category}`);
    assert.equal(typeof category, 'string', 'category should be string');
    assert.equal(category, expected, `expected "${expected}" but got "${category}"`);
  });
}

test('[Category] 알 수 없는 키워드 → fallback', async () => {
  const category = await getCategory('asdfqwer12345');
  console.log(`  unknown → ${category}`);
  assert.equal(typeof category, 'string', 'should return string fallback');
});
