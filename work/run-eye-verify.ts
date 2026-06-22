import fs from 'node:fs/promises';
import path from 'node:path';

const [targetDate] = process.argv.slice(2);

if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/u.test(targetDate)) {
  throw new Error('usage: pnpm exec tsx work/run-eye-verify.ts YYYY-MM-DD');
}

const sourcePath = path.resolve('work/verify-eye-schedule-20260621.ts');
const tempPath = path.resolve(
  'work',
  `.verify-eye-schedule-${targetDate.replaceAll('-', '')}-${Date.now()}.ts`,
);

const source = await fs.readFile(sourcePath, 'utf8');
const patched = source
  .replace("const TARGET_DATE = '2026-06-21';", `const TARGET_DATE = '${targetDate}';`)
  .replace(
    "const OUTPUT_DIR = path.resolve(process.cwd(), 'outputs', `eye-schedule-verify-${TARGET_DATE}`);",
    "const OUTPUT_DIR = path.resolve(process.cwd(), 'outputs', `eye-schedule-verify-${TARGET_DATE}`);",
  );

await fs.writeFile(tempPath, patched, 'utf8');

try {
  await import(tempPath);
} finally {
  await fs.unlink(tempPath).catch(() => undefined);
}
