// The Renvara demo as a folder of pages that open from disk (double-click, no
// server, no install): node demo/folder.ts → <repo>/demo-app/
//
//   renvara-demo.html             the presentation demo, with demo data
//   renvara-prazni-pocetak.html   clean start: only what the user enters
//   renvara-mobilni-prikaz.html   the presentation demo in a phone frame (computer screens)
//
// Each page is one of the demo builds (demo/build.ts) as a complete document;
// demo-app/README.md is written by hand.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FOLDER = resolve(APP, '../../demo-app');

const PAGES = [
  { file: 'renvara-demo.html', args: [], built: 'dist/demo/index.html' },
  { file: 'renvara-prazni-pocetak.html', args: ['--empty'], built: 'dist/demo/index.html' },
  { file: 'renvara-mobilni-prikaz.html', args: ['--mobile'], built: 'dist/demo-mobile/index.html' },
];

// The builds are a page body: the artifact host adds the document around them.
const document = (body: string) =>
  [
    '<!doctype html>',
    '<html lang="hr">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    '<meta name="color-scheme" content="light" />',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n');

mkdirSync(FOLDER, { recursive: true });
for (const page of PAGES) {
  execFileSync(process.execPath, ['demo/build.ts', ...page.args], { cwd: APP, stdio: 'inherit' });
  writeFileSync(join(FOLDER, page.file), document(readFileSync(join(APP, page.built), 'utf8')));
}
console.log(
  `Demo folder: ${relative(process.cwd(), FOLDER)} (${PAGES.map((p) => p.file).join(', ')})`,
);
