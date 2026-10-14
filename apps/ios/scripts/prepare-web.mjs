// Builds apps/ios/www, the web content of the iOS app (Capacitor webDir).
//
//   default                        the Renvara web app inside the app: the clean
//                                  start of the in-browser build (apps/beta-web/demo),
//                                  offline, records kept on the phone only
//   RENVARA_IOS_CONTENT=demo       the same with the presentation demo data
//   RENVARA_IOS_SERVER_URL=https:… the app opens that BETA server instead; www
//                                  then holds only the offline page
//
// Nothing from .env goes into www: the bundled build has no server, no account
// and no keys (its login accepts any name and password, as in the web demo).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = resolve(ROOT, '../beta-web');
const WWW = resolve(ROOT, 'www');

const serverUrl = process.env.RENVARA_IOS_SERVER_URL?.trim() || null;
const content = process.env.RENVARA_IOS_CONTENT?.trim() || 'clean';
if (!['clean', 'demo'].includes(content)) {
  throw new Error('RENVARA_IOS_CONTENT must be "clean" or "demo"');
}

const HEAD = [
  '<!doctype html>',
  '<html lang="hr">',
  '<head>',
  '<meta charset="utf-8" />',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
  '<meta name="format-detection" content="telephone=no" />',
  '<meta name="color-scheme" content="light" />',
].join('\n');

/** Shown by the app when a page cannot be loaded (server.errorPath). */
const offlinePage = (retry) => `${HEAD}
<title>Renvara</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fff;
    color: #111; font: 16px/1.45 -apple-system, BlinkMacSystemFont, sans-serif; }
  main { max-width: 320px; padding: 24px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0 0 20px; color: #5b616b; }
  a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 20px; border-radius: 12px;
    background: #c81e1e; color: #fff; font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
<main>
  <h1>Renvara nije dostupna</h1>
  <p>Provjerite internetsku vezu i pokušajte ponovno.</p>
  <a href="${retry}">Pokušaj ponovno</a>
</main>
</body>
</html>
`;

rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW, { recursive: true });
writeFileSync(resolve(WWW, 'offline.html'), offlinePage(serverUrl ?? 'index.html'));

if (serverUrl) {
  // Capacitor needs an index.html; the app opens serverUrl instead.
  writeFileSync(resolve(WWW, 'index.html'), offlinePage(serverUrl));
  console.log(`www: server build → ${serverUrl}`);
} else {
  const args = ['demo/build.ts', ...(content === 'clean' ? ['--empty'] : [])];
  execFileSync(process.execPath, args, { cwd: WEB, stdio: 'inherit' });
  const app = readFileSync(resolve(WEB, 'dist/demo/index.html'), 'utf8');
  // The build is a page body (the artifact host adds the document around it).
  writeFileSync(resolve(WWW, 'index.html'), `${HEAD}\n</head>\n<body>\n${app}\n</body>\n</html>\n`);
  console.log(`www: bundled build (${content}) → ${resolve(WWW, 'index.html')}`);
}
