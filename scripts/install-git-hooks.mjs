import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const hooksDir = path.join(repoRoot, '.githooks');

const run = (command) =>
  execSync(command, {
    cwd: repoRoot,
    stdio: 'pipe',
  }).toString().trim();

const installHooks = () => {
  if (!existsSync(hooksDir)) {
    console.log('[hooks:install] .githooks directory not found, skipping.');
    return;
  }

  try {
    run('git rev-parse --git-dir');
  } catch {
    console.log('[hooks:install] git repository not detected, skipping.');
    return;
  }

  run('git config --local core.hooksPath .githooks');
  console.log('[hooks:install] core.hooksPath set to .githooks');
};

installHooks();
