// RENVARA_CRM_REPORTS_v1.0.zip: the whole project, ready for
//
//   npm install
//   npm run dev        → http://localhost:3000
//
// The repository uses pnpm; the ZIP is the same project prepared for npm:
//   - npm workspaces instead of pnpm-workspace.yaml ("workspace:*" → "*"),
//     a package-lock.json made by npm (pnpm-lock.yaml is left out)
//   - the Supabase CLI as an optional dependency (its download never breaks npm install)
//   - the clean edition (core/edition.js → DEMO_CONTENT = false): a new
//     installation starts empty; demo records only with npm run dev:demo,
//     in files of their own
// Only files tracked by git go in: no node_modules, no .env, no data, no keys.
//
//   node scripts/release-zip.mjs [--no-lock]   → dist/release/RENVARA_CRM_REPORTS_v1.0.zip
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'RENVARA_CRM_REPORTS_v1.0';
const OUT_DIR = join(ROOT, 'dist/release');
const STAGE = join(OUT_DIR, NAME);
const ZIP = join(OUT_DIR, `${NAME}.zip`);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

// ------------------------------------------------------------- the files ---
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT })
  .toString()
  .split('\0')
  .filter(Boolean);
const SKIP = [/^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /(^|\/)\.env(\.|$)(?!example)/];
let count = 0;
for (const file of tracked) {
  if (SKIP.some((pattern) => pattern.test(file))) continue;
  if (!existsSync(join(ROOT, file))) continue; // deleted, not committed yet
  mkdirSync(dirname(join(STAGE, file)), { recursive: true });
  cpSync(join(ROOT, file), join(STAGE, file));
  count += 1;
}

// ------------------------------------------------------ npm workspaces ---
const json = (file) => JSON.parse(readFileSync(join(STAGE, file), 'utf8'));
const save = (file, value) =>
  writeFileSync(join(STAGE, file), `${JSON.stringify(value, null, 2)}\n`);

const root = json('package.json');
delete root.packageManager;
root.workspaces = ['packages/*', 'apps/*'];
root.engines = { node: '>=22.18' };
const supabase = root.devDependencies.supabase;
delete root.devDependencies.supabase;
root.optionalDependencies = { supabase };
root.scripts = {
  dev: 'npm run dev -w @renvara/beta-web',
  'dev:demo': 'npm run dev:demo -w @renvara/beta-web',
  'seed:demo': 'npm run seed:demo -w @renvara/beta-web',
  start: 'npm run start -w @renvara/beta-web',
  test: 'npm run test --workspaces --if-present',
  typecheck: 'npm run typecheck --workspaces --if-present',
  check: 'npm run format:check && npm run typecheck && npm test',
  format: 'prettier --write .',
  'format:check': 'prettier --check .',
  'localhost:build': 'npm run localhost:build -w @renvara/beta-web',
  'db:start': 'supabase start',
  'db:stop': 'supabase stop',
  'db:reset': 'supabase db reset',
  'db:test': 'supabase test db',
};
save('package.json', root);

for (const file of [
  'apps/beta-web/package.json',
  'packages/database/package.json',
  'packages/domain/package.json',
]) {
  const pkg = json(file);
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(pkg[field] ?? {})) {
      if (String(version).startsWith('workspace:')) pkg[field][name] = '*';
    }
  }
  save(file, pkg);
}

// The clean edition: an installation starts with no records.
writeFileSync(
  join(STAGE, 'apps/beta-web/public/app/js/core/edition.js'),
  '// RENVARA_CRM_REPORTS_v1.0 (scripts/release-zip.mjs): a clean start, only what you enter.\n' +
    '// Demo records: npm run dev:demo (separate files in apps/beta-web/.data/demo/).\n' +
    'export const DEMO_CONTENT = false;\n',
);

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
} catch {
  /* not a git checkout */
}
writeFileSync(
  join(STAGE, 'VERSION.txt'),
  `RENVARA CRM · IZVJEŠTAJI v1.0 · ${new Date().toISOString().slice(0, 10)} · ${commit}\n`,
);

// ---------------------------------------------------------- the lockfile ---
if (!process.argv.includes('--no-lock')) {
  execFileSync(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: STAGE,
      stdio: 'inherit',
    },
  );
  if (!existsSync(join(STAGE, 'package-lock.json')))
    throw new Error('package-lock.json was not made');
}

// --------------------------------------------------------------- checks ---
for (const forbidden of ['.env', 'apps/beta-web/.env', 'node_modules', 'apps/beta-web/.data']) {
  if (existsSync(join(STAGE, forbidden))) throw new Error(`${forbidden} must not be in the ZIP`);
}
for (const needed of [
  'package.json',
  'README.md',
  'POKRETANJE-LOKALNO.md',
  'apps/beta-web/.env.example',
  'apps/beta-web/scripts/dev.mjs',
  'apps/beta-web/src/reports/report-engine.ts',
  'supabase/migrations/20261018120000_reports.sql',
  'docs/adr/0015-reports.md',
]) {
  if (!existsSync(join(STAGE, needed))) throw new Error(`missing ${needed}`);
}

execFileSync('zip', ['-qrX', ZIP, NAME], { cwd: OUT_DIR });
const mb = (readFileSync(ZIP).length / 1024 / 1024).toFixed(1);
console.log(`${NAME}.zip: ${count} project files, ${mb} MB → ${ZIP}`);
