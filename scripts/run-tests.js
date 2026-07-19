// Bundles every src/**/*.test.ts with esbuild into .tmp/tests and runs them
// under node's built-in test runner. Keeps the repo free of a test-framework
// dependency while giving the pure domain code real unit coverage.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, '.tmp', 'tests');

function findTests(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findTests(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) found.push(fullPath);
  }
  return found;
}

const entryPoints = findTests(path.join(root, 'src'));
if (entryPoints.length === 0) {
  console.error('no *.test.ts files found under src/');
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
esbuild.buildSync({
  entryPoints,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode', 'node:test', 'node:assert'],
  outdir: outDir,
  logLevel: 'warning'
});

const bundled = fs
  .readdirSync(outDir)
  .filter((name) => name.endsWith('.test.js'))
  .map((name) => path.join(outDir, name));
const result = spawnSync(process.execPath, ['--test', ...bundled], { stdio: 'inherit' });
process.exit(result.status ?? 1);
