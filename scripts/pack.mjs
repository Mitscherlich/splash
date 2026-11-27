import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function parseOutArg(argv) {
  const outIdx = argv.indexOf('--out');
  if (outIdx === -1) return null;
  const value = argv[outIdx + 1];
  if (!value) {
    throw new Error('Missing value for --out');
  }
  return path.resolve(rootDir, value);
}

const pkg = readJson(path.join(rootDir, 'package.json'));
const sourceManifest = readJson(path.join(rootDir, 'public', 'manifest.json'));

if (pkg.version !== sourceManifest.version) {
  throw new Error(
    `Version mismatch: package.json (${pkg.version}) !== public/manifest.json (${sourceManifest.version})`,
  );
}

const distManifestPath = path.join(distDir, 'manifest.json');
if (!existsSync(distManifestPath)) {
  throw new Error(
    'Missing dist/manifest.json. Run "bun run build" before packaging.',
  );
}

const distManifest = readJson(distManifestPath);
if (distManifest.version !== pkg.version) {
  throw new Error(
    `Built dist/manifest.json version (${distManifest.version}) !== package.json (${pkg.version}). Re-run "bun run build".`,
  );
}

const outPath =
  parseOutArg(process.argv.slice(2)) ??
  path.join(rootDir, `splash-${pkg.version}.zip`);

if (existsSync(outPath)) {
  rmSync(outPath);
}

execFileSync(
  'zip',
  ['-r', '-q', outPath, '.', '-x', '*.DS_Store', '-x', '__MACOSX/*'],
  { cwd: distDir, stdio: 'inherit' },
);

const entries = execFileSync('unzip', ['-Z1', outPath], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

if (!entries.includes('manifest.json')) {
  throw new Error(
    `Invalid archive: manifest.json must be at the root of ${outPath}`,
  );
}

const sizeKb = (statSync(outPath).size / 1024).toFixed(1);
console.log(
  `Packed ${path.relative(rootDir, outPath)} (${entries.length} files, ${sizeKb} KB)`,
);
