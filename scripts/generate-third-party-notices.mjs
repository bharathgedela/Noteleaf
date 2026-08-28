import { readFile, readdir, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
const appPackage = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const packageEntries = Object.entries(lock.packages)
  .filter(([path, metadata]) => path && metadata.dev !== true)
  .map(([path, metadata]) => ({
    path,
    name: metadata.name || path.replace(/^node_modules\//, ''),
    version: metadata.version || 'unknown',
    license: String(metadata.license || 'UNKNOWN'),
  }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const packages = packageEntries.map(({ name, version, license }) => ({ name, version, license }));

const escapeCell = (value) => value.replaceAll('|', '\\|');
const rows = packages.map((item) => `| ${escapeCell(item.name)} | ${escapeCell(item.version)} | ${escapeCell(item.license)} |`).join('\n');
const notice = `# Third-party notices

Noteleaf ${appPackage.version} includes open-source software from the projects listed below. This inventory is generated from the production dependency graph in \`package-lock.json\`.

Where a package offers multiple licenses, Noteleaf elects the Apache-2.0-compatible option: Apache-2.0 for \`rc\` and MIT for \`expand-template\`. Copyright and license files supplied by these packages remain in their source packages. The Electron application bundle also includes Electron's \`LICENSE\` and Chromium's \`LICENSES.chromium.html\` notices.

| Package | Version | Declared license |
| --- | --- | --- |
${rows}
`;

await writeFile(new URL('THIRD_PARTY_NOTICES.md', root), notice, 'utf8');

const licenseSections = [];
for (const item of packageEntries) {
  const directory = new URL(`${item.path}/`, root);
  let names = [];
  try { names = await readdir(directory); } catch { continue; }
  const licenseFiles = names.filter((name) => /^(licen[cs]e|copying|notice)(?:\..*)?$/i.test(name)).sort();
  for (const filename of licenseFiles) {
    let contents;
    try { contents = await readFile(new URL(filename, directory), 'utf8'); } catch { continue; }
    const normalizedContents = contents.replaceAll('\r\n', '\n').split('\n').map((line) => line.trimEnd()).join('\n').trim();
    licenseSections.push(`================================================================================\n${item.name}@${item.version} — ${filename}\n================================================================================\n\n${normalizedContents}\n`);
  }
}
await writeFile(new URL('THIRD_PARTY_LICENSES.txt', root), `Noteleaf third-party license texts\n\nGenerated from the installed production dependency graph for Noteleaf ${appPackage.version}.\nThe Electron runtime also distributes LICENSE and LICENSES.chromium.html in its application bundle.\n\n${licenseSections.join('\n')}`, 'utf8');
console.log(`Wrote THIRD_PARTY_NOTICES.md with ${packages.length} production packages and THIRD_PARTY_LICENSES.txt with ${licenseSections.length} supplied license/notice files.`);
