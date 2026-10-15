// Renvara for one computer (localhost): the real BETA server as a folder that
// runs with only Node.js, no install and no network:
//   node localhost/build.ts → dist/renvara-localhost/ and dist/renvara-localhost.zip
//
//   renvara-localhost/
//     Pokreni-Renvaru-Windows.bat · Pokreni-Renvaru-Mac.command · pokreni-renvaru-linux.sh
//     PROCITAJ-ME.txt
//     program/
//       start.mjs                              first-run setup, start, browser (localhost/start.mjs)
//       apps/beta-web/server/renvara.mjs       the server (src/server.ts) in one file
//       apps/beta-web/public/                  pages and assets (clean edition: no demo data)
//       apps/beta-web/node_modules/pdfjs-dist  PDF checks and the viewer (only the files used)
//       prototypes/home/                       Početna
//     podaci/                                  created on first start (never in the ZIP)
//
// The server finds its files from its own location (src/app-dir.ts), so the
// layout below program/ mirrors the repository.
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(APP, '../..');
const SOURCE = join(APP, 'localhost');
const OUT = join(APP, 'dist/renvara-localhost');
const PROGRAM = join(OUT, 'program');
const WEB = join(PROGRAM, 'apps/beta-web');
const EDITION = join(APP, 'public/app/js/core/edition.js');
const CLEAN_EDITION =
  '// Renvara on one computer (localhost/build.ts): a clean start, only what you enter.\n' +
  'export const DEMO_CONTENT = false;\n';

rmSync(OUT, { recursive: true, force: true });
rmSync(`${OUT}.zip`, { force: true });
mkdirSync(join(WEB, 'server'), { recursive: true });

// ---------------------------------------------------------- the server ---
// One ES module with the CRM, Korisnici and @renvara/domain inside; Node's own
// modules and pdf.js (loaded on demand, from node_modules below) stay outside.
let cleanEdition = false;
const bundle = await rolldown({
  input: join(APP, 'src/server.ts'),
  platform: 'node',
  external: [/^node:/, /^pdfjs-dist\//],
  logLevel: 'warn',
  plugins: [
    {
      name: 'clean-edition',
      load(id) {
        if (resolve(id) !== EDITION) return null;
        cleanEdition = true;
        return CLEAN_EDITION;
      },
    },
  ],
});
await bundle.write({
  file: join(WEB, 'server/renvara.mjs'),
  format: 'esm',
  codeSplitting: false,
  banner: '// Renvara server (apps/beta-web/src/server.ts), bundled by localhost/build.ts.',
});
await bundle.close();

// ------------------------------------------------- pages and assets ---
cpSync(join(APP, 'public'), join(WEB, 'public'), { recursive: true });
writeFileSync(join(WEB, 'public/app/js/core/edition.js'), CLEAN_EDITION);
cpSync(join(ROOT, 'prototypes/home'), join(PROGRAM, 'prototypes/home'), { recursive: true });

// pdf.js: the legacy build (server check and browsers), fonts, cmaps, wasm.
const PDFJS = join(APP, 'node_modules/pdfjs-dist');
const PDFJS_OUT = join(WEB, 'node_modules/pdfjs-dist');
for (const file of [
  'package.json',
  'LICENSE',
  'legacy/build/pdf.mjs',
  'legacy/build/pdf.worker.mjs',
  'legacy/build/pdf.min.mjs',
  'legacy/build/pdf.worker.min.mjs',
]) {
  mkdirSync(dirname(join(PDFJS_OUT, file)), { recursive: true });
  cpSync(join(PDFJS, file), join(PDFJS_OUT, file));
}
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(join(PDFJS, dir), join(PDFJS_OUT, dir), { recursive: true });
}

// ------------------------------------------------ launcher and readme ---
cpSync(join(SOURCE, 'start.mjs'), join(PROGRAM, 'start.mjs'));
// Windows: CRLF line ends for the batch file and the readme (Notepad).
const crlf = (text: string) => text.replace(/\r?\n/g, '\r\n');
writeFileSync(
  join(OUT, 'Pokreni-Renvaru-Windows.bat'),
  crlf(readFileSync(join(SOURCE, 'Pokreni-Renvaru-Windows.bat'), 'utf8')),
);
writeFileSync(
  join(OUT, 'PROCITAJ-ME.txt'),
  `﻿${crlf(readFileSync(join(SOURCE, 'PROCITAJ-ME.txt'), 'utf8'))}`,
);
for (const file of ['Pokreni-Renvaru-Mac.command', 'pokreni-renvaru-linux.sh']) {
  cpSync(join(SOURCE, file), join(OUT, file));
  chmodSync(join(OUT, file), 0o755);
}

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
} catch {
  /* not a git checkout */
}
writeFileSync(
  join(PROGRAM, 'VERSION.txt'),
  `Renvara localhost · ${new Date().toISOString().slice(0, 10)} · ${commit}\n`,
);

// --------------------------------------------------------------- check ---
for (const file of [
  'program/apps/beta-web/server/renvara.mjs',
  'program/apps/beta-web/public/login/index.html',
  'program/apps/beta-web/public/app/pages/users.html',
  'program/prototypes/home/index.html',
]) {
  if (!existsSync(join(OUT, file))) throw new Error(`missing ${file}`);
}
if (!cleanEdition) throw new Error('the bundle is not the clean edition');

// ---------------------------------------------------------------- zip ---
// -X: no extra file attributes; executable bits stay for Mac and Linux.
execFileSync('zip', ['-qrX', `${relative(dirname(OUT), OUT)}.zip`, relative(dirname(OUT), OUT)], {
  cwd: dirname(OUT),
});
const mb = (readFileSync(`${OUT}.zip`).length / 1024 / 1024).toFixed(1);
console.log(
  `Localhost app: ${relative(process.cwd(), OUT)} and ${relative(process.cwd(), OUT)}.zip (${mb} MB)`,
);
