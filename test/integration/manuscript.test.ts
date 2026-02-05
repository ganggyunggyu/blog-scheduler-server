import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callManuscriptAPI } from '../../src/services/manuscript.service';
import { MANUSCRIPT_CASES } from '../fixtures/test-data';

for (const { type, keyword, category } of MANUSCRIPT_CASES) {
  test(`[Manuscript] ${type} (${keyword})`, async () => {
    const result = await callManuscriptAPI(type, keyword, 'default', '', category);

    console.log(`  type:    ${type}`);
    console.log(`  id:      ${result.id}`);
    console.log(`  title:   ${result.title.slice(0, 60)}`);
    console.log(`  content: ${result.content.length} chars`);

    assert.ok(result.id, 'id should exist');
    assert.ok(result.title, 'title should not be empty');
    assert.ok(result.content.length > 0, 'content should not be empty');
  });
}
