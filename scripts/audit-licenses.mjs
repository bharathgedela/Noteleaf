import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const permitted = new Set(['Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT']);
const packages = Object.entries(lock.packages)
  .filter(([path, metadata]) => path && metadata.dev !== true)
  .map(([path, metadata]) => ({
    name: metadata.name || path.replace(/^node_modules\//, ''),
    version: metadata.version || 'unknown',
    license: String(metadata.license || '').trim(),
  }));

function hasPermittedChoice(expression) {
  if (permitted.has(expression)) return true;
  if (!/^\(.+\)$/.test(expression) || !expression.includes(' OR ') || expression.includes(' AND ')) return false;
  return expression.slice(1, -1).split(/\s+OR\s+/).some((choice) => permitted.has(choice));
}

const incompatible = packages.filter(({ license }) => !hasPermittedChoice(license));
const counts = new Map();
for (const { license } of packages) counts.set(license, (counts.get(license) || 0) + 1);

console.log(`Audited ${packages.length} production JavaScript packages.`);
for (const [license, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) console.log(`  ${license || '(missing)'}: ${count}`);

if (incompatible.length) {
  console.error('\nUnapproved or missing production dependency licenses:');
  for (const item of incompatible) console.error(`  ${item.name}@${item.version}: ${item.license || '(missing)'}`);
  process.exitCode = 1;
} else {
  console.log('All production dependency license expressions have an Apache-2.0-compatible choice.');
}
