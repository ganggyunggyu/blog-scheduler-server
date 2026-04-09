import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const run = (label, command) => {
  console.log(`[quality-gate] ${label}: ${command}`);
  execSync(command, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
};

run('lint-gate', 'pnpm typecheck');
run('test-gate', 'pnpm test');
