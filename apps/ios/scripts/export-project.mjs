// A standalone copy of the iOS project for building on one Mac and installing
// on one iPhone (Xcode → Run): <repo>/demo-app-ios/, with the web content
// already inside, so the Mac needs only Xcode (no Node, pnpm or this repository).
//
//   demo-app-ios/App/App.xcodeproj           the project to open
//   demo-app-ios/App/App/public/index.html   the app's content: clean start
//   demo-app-ios/sadrzaj/<variant>/index.html  clean start / with demo data, to swap in
//
// demo-app-ios/README.md is written by hand (kept on export).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '../../demo-app-ios');
const VARIANTS = [
  { content: 'demo', folder: 'demo-s-primjerima' },
  { content: 'clean', folder: 'prazni-pocetak' }, // last: the one left in public/
];
// Not part of the standalone project: build output, user state, generated
// Cordova bridge (not referenced by the project) and the repo's ignore rules
// (they would hide public/ and capacitor.config.json from git).
const SKIP = new Set(['.gitignore', 'build', 'DerivedData', 'xcuserdata', '.DS_Store', '.build']);
const SKIP_PATHS = new Set(['capacitor-cordova-ios-plugins']);

const run = (args, env = {}) =>
  execFileSync(args[0], args.slice(1), {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, RENVARA_IOS_SERVER_URL: '', ...env },
  });

// Keep the hand-written README; replace everything else.
if (existsSync(OUT)) {
  for (const entry of readdirSync(OUT)) {
    if (entry !== 'README.md') rmSync(join(OUT, entry), { recursive: true, force: true });
  }
}
mkdirSync(OUT, { recursive: true });

for (const variant of VARIANTS) {
  run([process.execPath, 'scripts/prepare-web.mjs'], { RENVARA_IOS_CONTENT: variant.content });
  cpSync(resolve(ROOT, 'www/index.html'), join(OUT, 'sadrzaj', variant.folder, 'index.html'));
}
// The native project with the last variant (clean start) and its config.
run([resolve(ROOT, 'node_modules/.bin/cap'), 'sync', 'ios'], { RENVARA_IOS_CONTENT: 'clean' });

cpSync(resolve(ROOT, 'ios'), OUT, {
  recursive: true,
  filter: (source) => {
    const rel = relative(resolve(ROOT, 'ios'), source);
    const name = rel.split('/').at(-1);
    return !SKIP.has(name) && !SKIP_PATHS.has(rel.split('/')[0]);
  },
});
console.log(`Standalone iOS project: ${relative(process.cwd(), OUT)}`);
