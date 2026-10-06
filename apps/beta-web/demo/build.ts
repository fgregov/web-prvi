// Builds a static, clickable demo of the BETA app that runs entirely in the
// browser, e.g. as a claude.ai artifact, as ONE self-contained page:
//
//   - the real pages, styles and page modules (public/app, prototypes/home, login)
//   - the real CRM services and API routes (src/crm + @renvara/domain), with
//     types stripped, answering fetch('/api/…') in the page (demo/runtime.js)
//   - an in-page router instead of server routes and real page loads
//   - inside an artifact, records are kept in the artifact's `db` store
//
// The app's sources stay untouched: location/history access is redirected to
// the demo router at build time, and the build fails if any is left over.
//
//   node demo/build.ts   → dist/demo/index.html (single file; sources staged in dist/demo-src)
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { rolldown } from 'rolldown';

const APP = resolve(import.meta.dirname, '..');
const ROOT = resolve(APP, '../..');
const OUT = resolve(APP, 'dist/demo-src'); // staged modules, bundled below
const FINAL = resolve(APP, 'dist/demo');
const HOME = resolve(ROOT, 'prototypes/home');

rmSync(OUT, { recursive: true, force: true });
rmSync(FINAL, { recursive: true, force: true });

const dataUri = (file: string, type: string) =>
  `data:${type};base64,${readFileSync(file).toString('base64')}`;
const LOGO = dataUri(join(HOME, 'assets/renvara-logo.png'), 'image/png');
const AVATAR = dataUri(join(HOME, 'assets/avatar-placeholder.svg'), 'image/svg+xml');

const write = (path: string, text: string) => {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), text);
};
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );

// ------------------------------------------------------------- browser code
const ASSETS: Array<[RegExp, string]> = [[/\/brand\/renvara-logo\.png/g, LOGO]];

/** Sends location/history/referrer to the demo router (globalThis.__rv). */
function redirectNavigation(code: string, file: string): string {
  let out = code
    .replace(/\bwindow\.location\b/g, '__rv.location')
    .replace(/\bwindow\.history\b/g, '__rv.history')
    .replace(/\bdocument\.referrer\b/g, '__rv.referrer');
  for (const [pattern, target] of ASSETS) out = out.replace(pattern, target);
  const leftover =
    /\b(?:location\.(?:href|assign|replace|reload|pathname|search|hash|origin)|history\.(?:back|forward|go|length|pushState|replaceState))\b/g;
  for (const match of out.matchAll(leftover)) {
    const before = out.slice(Math.max(0, (match.index ?? 0) - 5), match.index);
    if (!before.endsWith('__rv.')) throw new Error(`${file}: unhandled navigation "${match[0]}"`);
  }
  return out;
}

/** A page module re-runs on every visit: its top-level code becomes `export default async function`. */
function toRunnablePage(code: string, file: string): string {
  const imports = [...code.matchAll(/^import\s[\s\S]*?from\s*'[^']*';\n/gm)];
  const end = imports.length ? (imports.at(-1)!.index ?? 0) + imports.at(-1)![0].length : 0;
  const body = code.slice(end);
  if (/^(?:import|export)\s/m.test(body))
    throw new Error(`${file}: imports/exports after the body`);
  return `${code.slice(0, end)}\nexport default async function run() {\n${body}\n}\n`;
}

/** Classic IIFE scripts (dashboard app.js, login.js) become runnable modules. */
function toRunnableScript(code: string, file: string): string {
  const start = code.indexOf('(() => {');
  const end = code.lastIndexOf('})();');
  if (start < 0 || end < 0) throw new Error(`${file}: expected an IIFE`);
  return `${code.slice(0, start)}export default function run() {${code.slice(start + 8, end)}}\n`;
}

const APP_SRC = resolve(APP, 'public/app');
for (const file of walk(APP_SRC)) {
  const rel = relative(APP_SRC, file);
  if (rel.startsWith('pages')) continue; // HTML shells become router templates
  if (file.endsWith('.js')) {
    let code = redirectNavigation(readFileSync(file, 'utf8'), rel);
    if (rel.startsWith('js/pages/')) code = toRunnablePage(code, rel);
    write(`app/${rel}`, code);
  } else {
    cpSync(file, join(OUT, 'app', rel));
  }
}

cpSync(join(HOME, 'styles.css'), join(OUT, 'home/styles.css'));
write(
  'home/app.js',
  toRunnableScript(
    redirectNavigation(readFileSync(join(HOME, 'app.js'), 'utf8'), 'app.js'),
    'app.js',
  ),
);
cpSync(resolve(APP, 'public/login/login.css'), join(OUT, 'login/login.css'));
write(
  'login/login.js',
  toRunnableScript(
    redirectNavigation(readFileSync(resolve(APP, 'public/login/login.js'), 'utf8'), 'login.js'),
    'login.js',
  ),
);

// --------------------------------------------------------- server in browser
function stripModule(
  source: string,
  file: string,
  imports: Array<[string | RegExp, string]>,
): string {
  let code = stripTypeScriptTypes(readFileSync(source, 'utf8'), { mode: 'strip' });
  code = code.replace(/from '(\.{1,2}\/[^']+)\.ts'/g, "from '$1.js'");
  for (const [from, to] of imports) code = code.replaceAll(from, to);
  if (/from 'node:|import\('node:/.test(code))
    throw new Error(`${file}: Node import in browser code`);
  return code;
}

const CRM_SRC = resolve(APP, 'src/crm');
for (const name of readdirSync(CRM_SRC)) {
  if (['routes.ts', 'file-repository.ts', 'config.ts'].includes(name)) continue; // Node only
  write(
    `server/crm/${name.replace(/\.ts$/, '.js')}`,
    stripModule(join(CRM_SRC, name), name, [
      ["from '@renvara/domain'", "from '../domain/index.js'"],
      ["from '../../public/app/js/core/", "from '../../app/js/core/"],
      [
        "import { randomUUID } from 'node:crypto';",
        'const randomUUID = () => globalThis.crypto.randomUUID?.() ?? fallbackUuid();\n' +
          'function fallbackUuid() {\n' +
          '  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));\n' +
          '  b[6] = (b[6] & 0x0f) | 0x40;\n' +
          '  b[8] = (b[8] & 0x3f) | 0x80;\n' +
          "  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');\n" +
          '  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;\n' +
          '}',
      ],
    ]),
  );
}
write('server/messages.js', stripModule(resolve(APP, 'src/messages.ts'), 'messages.ts', []));
const DOMAIN_SRC = resolve(ROOT, 'packages/domain/src');
for (const file of walk(DOMAIN_SRC)) {
  if (file.endsWith('.test.ts')) continue;
  const rel = relative(DOMAIN_SRC, file);
  write(`server/domain/${rel.replace(/\.ts$/, '.js')}`, stripModule(file, rel, []));
}

// ------------------------------------------------------- pages → templates
type Script = { kind: 'module' | 'classic'; src: string };
const pages: Record<string, { title: string; styles: string[]; html: string; scripts: Script[] }> =
  {};

function mapUrl(url: string, base: 'home' | 'app' | 'login'): string {
  if (url.startsWith('/app/')) return url.slice(1);
  if (url.startsWith('/login/')) return url.slice(1);
  if (url === '/brand/renvara-logo.png' || url === 'assets/renvara-logo.png') return LOGO;
  if (url === 'assets/avatar-placeholder.svg') return AVATAR;
  if (url.startsWith('https://')) return url;
  if (base === 'home' && !url.startsWith('/')) return `home/${url}`;
  throw new Error(`Unmapped URL ${url}`);
}

function addPage(
  name: string,
  file: string,
  base: 'home' | 'app' | 'login',
  edit = (h: string) => h,
) {
  const html = readFileSync(file, 'utf8');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  let body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  const scripts: Script[] = [];
  body = body.replace(/\s*<script\b([^>]*)><\/script>/g, (_all, attrs: string) => {
    const src = /src="([^"]+)"/.exec(attrs)![1]!;
    scripts.push({
      kind: attrs.includes('type="module"') ? 'module' : 'classic',
      src: mapUrl(src, base),
    });
    return '';
  });
  for (const [, attrs] of head.matchAll(/<script\b([^>]*)><\/script>/g)) {
    const src = /src="([^"]+)"/.exec(attrs!)![1]!;
    scripts.push({
      kind: attrs!.includes('type="module"') ? 'module' : 'classic',
      src: mapUrl(src, base),
    });
  }
  body = body.replace(/(src|href)="([^"#][^"]*)"/g, (all, attr: string, url: string) =>
    url.startsWith('/') && !url.startsWith('/brand/') ? all : `${attr}="${mapUrl(url, base)}"`,
  );
  pages[name] = {
    title: /<title>([^<]*)<\/title>/.exec(head)![1]!,
    styles: [...head.matchAll(/<link rel="stylesheet"\s+href="([^"]+)"/g)].map((m) =>
      mapUrl(m[1]!, base),
    ),
    html: edit(body.trim()),
    scripts,
  };
}

addPage('login', resolve(APP, 'public/login/index.html'), 'login', (html) =>
  html
    .replace('name="username"', 'name="username"\n              value="demo"')
    .replace(/(id="login-password"[\s\S]*?)(\/>)/, '$1value="demo" $2')
    .replace(
      '<p>Prijavite se i pogledajte što slijedi.</p>',
      '<p>Prijavite se i pogledajte što slijedi.</p>\n<p class="demo-note">Demo: prijava prihvaća bilo koje korisničko ime i lozinku. Podaci se spremaju samo u ovom pregledniku.</p>',
    ),
);
// The login link stylesheet is written over several lines.
pages.login!.styles = [
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  'login/login.css',
];
addPage('dashboard', join(HOME, 'index.html'), 'home');
for (const file of readdirSync(resolve(APP, 'public/app/pages'))) {
  addPage(file.replace('.html', ''), resolve(APP, 'public/app/pages', file), 'app');
}
// Stylesheets in the cascade order of the real pages; inlined into the bundle.
const STYLE_FILES = [
  'login/login.css',
  'home/styles.css',
  'app/css/components.css',
  'app/css/pages.css',
  'app/css/screen.css',
];
const styles = Object.fromEntries(
  STYLE_FILES.map((file) => [file, readFileSync(join(OUT, file), 'utf8')]),
);
const scriptFiles = [...new Set(Object.values(pages).flatMap((p) => p.scripts.map((s) => s.src)))];
for (const page of Object.values(pages)) {
  for (const url of page.styles) {
    if (!url.startsWith('https://') && !(url in styles)) throw new Error(`Missing style ${url}`);
  }
}
write(
  'demo/pages.js',
  [
    '// Generated by demo/build.ts.',
    `export const PAGES = ${JSON.stringify(pages, null, 2)};`,
    `export const STYLES = ${JSON.stringify(styles)};`,
    'export const LOADERS = {',
    ...scriptFiles.map((src) => `  ${JSON.stringify(src)}: () => import('../${src}'),`),
    '};',
    '',
  ].join('\n'),
);
cpSync(resolve(APP, 'demo/runtime.js'), join(OUT, 'demo/runtime.js'));

// ------------------------------------------------------------------ verify
for (const file of walk(OUT).filter((f) => f.endsWith('.js'))) {
  const code = readFileSync(file, 'utf8');
  for (const [, spec] of code.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) {
    const target = resolve(dirname(file), spec!);
    if (!existsSync(target)) throw new Error(`${relative(OUT, file)}: missing import ${spec}`);
  }
}

// ------------------------------------------------------- one page, inlined
const bundle = await rolldown({ input: join(OUT, 'demo/runtime.js'), logLevel: 'warn' });
const { output } = await bundle.generate({ format: 'iife', codeSplitting: false, minify: true });
await bundle.close();
if (output.length !== 1 || output[0].type !== 'chunk') throw new Error('Expected one bundle');
const script = output[0].code.replaceAll('</script', '<\\/script');
const shell = readFileSync(resolve(APP, 'demo/index.html'), 'utf8');
const tag = '<script type="module" src="demo/runtime.js"></script>';
if (!shell.includes(tag)) throw new Error('demo/index.html: runtime script tag not found');
mkdirSync(FINAL, { recursive: true });
writeFileSync(
  join(FINAL, 'index.html'),
  shell.replace(tag, () => `<script>\n${script}</script>`),
);
const kb = Math.round(readFileSync(join(FINAL, 'index.html')).length / 1024);
console.log(
  `Demo built: ${relative(process.cwd(), join(FINAL, 'index.html'))} (${kb} KB, one file)`,
);
