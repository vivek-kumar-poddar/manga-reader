import { readFile, readdir, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const label = process.argv[2];
if (!['before-format', 'after-format'].includes(label)) {
  throw new Error('Usage: node scripts/capture-baseline.mjs before-format|after-format');
}
const report = JSON.parse(await readFile('test-results/results.json', 'utf8'));
if (report.stats.unexpected || report.stats.skipped || report.stats.expected !== 6) {
  throw new Error('Capture requires all six baseline tests passing.');
}
const target = path.join('docs/baseline', label);
await mkdir(target, { recursive: true });
const metrics = {};
function visit(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        for (const result of test.results) {
          for (const attachment of result.attachments ?? []) {
            if (attachment.name.endsWith('-metrics') && attachment.body) {
              metrics[attachment.name] = JSON.parse(
                Buffer.from(attachment.body, 'base64').toString(),
              );
            }
          }
        }
      }
    }
    visit(suite.suites ?? []);
  }
}
visit(report.suites);
const assets = {};
for (const name of await readdir('dist/assets')) {
  if (!/\.(js|css)$/.test(name)) continue;
  const bytes = await readFile(path.join('dist/assets', name));
  assets[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await copyFile(
  'test-results/baseline-import-read-bookmark-export-reload-re-link-resume-baseline/before-recode-backup.json',
  path.join(target, 'backup.json'),
);
await writeFile(
  path.join(target, 'measurements.json'),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      node: process.version,
      tests: report.stats,
      metrics,
      assets,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Retained baseline: ${target}`);
