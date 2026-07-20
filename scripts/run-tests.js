// Bundles every src/**/*.test.ts with esbuild into .tmp/tests and runs them
// under node's built-in test runner. Keeps the repo free of a test-framework
// dependency while giving the pure domain code real unit coverage.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, '.tmp', 'tests');

function findFilesEndingWith(dir, suffix) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFilesEndingWith(fullPath, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) found.push(fullPath);
  }
  return found;
}

const entryPoints = findFilesEndingWith(path.join(root, 'src'), '.test.ts');
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

const bundled = findFilesEndingWith(outDir, '.test.js');
const result = spawnSync(process.execPath, ['--test', ...bundled], { stdio: 'inherit' });
process.exit(result.status ?? 1);
