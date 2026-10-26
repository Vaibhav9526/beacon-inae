// Usage: node scripts/set-version.mjs 1.0.1 [--dry-run]
// Updates app.json (expo.version, expo.android.versionCode) and package.json version.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const version = (args.find((a) => !a.startsWith('--')) || '').replace(/^v/, '');

const m = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version);
if (!m) {
  console.error(`Invalid version "${version}". Expected semver like 1.0.1 or 1.0.1-beta.1`);
  process.exit(1);
}
const [major, minor, patch] = [m[1], m[2], m[3]].map(Number);
if (minor > 99 || patch > 99) {
  console.error('minor and patch must be <= 99 (versionCode = major*10000 + minor*100 + patch)');
  process.exit(1);
}
const versionCode = major * 10000 + minor * 100 + patch;
if (versionCode > 2100000000) {
  console.error('versionCode too large');
  process.exit(1);
}

function update(file, mutate) {
  const p = path.join(root, file);
  const raw = fs.readFileSync(p, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const json = JSON.parse(raw);
  const msg = mutate(json);
  if (!dry) fs.writeFileSync(p, JSON.stringify(json, null, 2).replace(/\n/g, eol) + eol);
  console.log(`${dry ? '[dry-run] ' : ''}${file}: ${msg}`);
}

update('app.json', (j) => {
  const prev = `${j.expo.version} / code ${j.expo.android?.versionCode ?? '(unset)'}`;
  j.expo.version = version;
  j.expo.android = { ...j.expo.android, versionCode };
  return `${prev} -> ${version} / code ${versionCode}`;
});
update('package.json', (j) => {
  const prev = j.version;
  j.version = version;
  return `${prev} -> ${version}`;
});
