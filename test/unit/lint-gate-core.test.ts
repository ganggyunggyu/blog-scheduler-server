import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintFileText } from '../../scripts/lint-gate-core.mjs';

test('lintFileText: core rules are detected in source files', () => {
  const violations = lintFileText(
    'src/example.ts',
    `
function legacyFunction() {
  var value: any = 'x';
  console.log(value);
}
`
  );

  assert.deepEqual(
    violations.map((violation) => violation.rule),
    ['function-declaration', 'var', 'explicit-any', 'no-console']
  );
});

test('lintFileText: ts directives are forbidden', () => {
  const violations = lintFileText(
    'src/directive.ts',
    `
// @ts-expect-error legacy code
const value = 1;
`
  );

  assert.deepEqual(violations.map((violation) => violation.rule), ['ts-expect-error']);
});

test('lintFileText: logger allowlist keeps console output legal', () => {
  const violations = lintFileText(
    'src/lib/logging/logger.ts',
    `
const emit = () => {
  console.log('allowed');
};
`
  );

  assert.deepEqual(violations.map((violation) => violation.rule), []);
});
