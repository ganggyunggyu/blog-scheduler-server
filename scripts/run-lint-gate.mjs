import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintFileText, LINT_SCOPE_DIRECTORIES, shouldLintFile } from './lint-gate-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const toRelativePath = (targetPath) => path.relative(repoRoot, targetPath).split(path.sep).join('/');

const collectFiles = (directoryPath) => {
  const entries = readdirSync(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
};

const lintFiles = () => {
  const targetFiles = LINT_SCOPE_DIRECTORIES.flatMap((directory) => collectFiles(path.join(repoRoot, directory)))
    .map(toRelativePath)
    .filter(shouldLintFile)
    .sort((left, right) => left.localeCompare(right));

  const violations = targetFiles.flatMap((relativePath) => {
    const filePath = path.join(repoRoot, relativePath);
    const sourceText = readFileSync(filePath, 'utf8');
    return lintFileText(relativePath, sourceText).map((violation) => ({
      relativePath,
      ...violation,
    }));
  });

  if (violations.length === 0) {
    console.log(`[lint-gate] clean (${targetFiles.length} files checked)`);
    return;
  }

  console.error(`[lint-gate] ${violations.length} violation(s) found`);
  for (const violation of violations) {
    console.error(
      ` - ${violation.relativePath}:${violation.line}:${violation.column} [${violation.rule}] ${violation.message}`
    );
  }
  process.exitCode = 1;
};

lintFiles();
