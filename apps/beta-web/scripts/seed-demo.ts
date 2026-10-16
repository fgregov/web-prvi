// OPTIONAL demo records for trying out the app and its reports, in files of
// their own — never in the organization's data:
//
//   npm run seed:demo            writes .data/demo/crm.json once (kept if it exists)
//   npm run seed:demo -- --force writes it again (only the demo file)
//   npm run dev:demo             the server on these demo files (scripts/dev.mjs --demo)
//
// The records are dated relative to today (customers, leads, opportunities
// won and lost in this and earlier quarters, tasks, offers), owned by the
// owner from .env (RENVARA_BETA_USERNAME), as the presentation demo.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDemoData } from '../src/crm/seed.ts';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_FILE = resolve(APP, '.data/demo/crm.json');

export function seedDemoFile(
  env: Record<string, string | undefined>,
  { force = false }: { force?: boolean } = {},
): { file: string; written: boolean } {
  const file = resolve(APP, env.RENVARA_DATA_FILE || DEMO_FILE);
  const production = resolve(APP, '.data/crm.json');
  if (file === production) {
    throw new Error('Demo podaci se ne zapisuju u podatke organizacije (.data/crm.json).');
  }
  if (existsSync(file) && !force) return { file, written: false };
  const username = env.RENVARA_BETA_USERNAME;
  if (!username)
    throw new Error('RENVARA_BETA_USERNAME nije postavljen (pokrenite npm run dev jednom).');
  const data = seedDemoData({
    organizationId: env.RENVARA_BETA_ORG_ID || 'org-beta',
    timeZone: env.RENVARA_ORG_TIMEZONE || 'Europe/Zagreb',
    user: { id: `beta-${username}`, displayName: env.RENVARA_BETA_DISPLAY_NAME || username },
    now: new Date(),
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  return { file, written: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { file, written } = seedDemoFile(
      { ...process.env, RENVARA_DATA_FILE: DEMO_FILE },
      { force: process.argv.includes('--force') },
    );
    console.log(
      written
        ? `Demo podaci zapisani u ${file}. Pokrenite: npm run dev:demo`
        : `Demo podaci već postoje (${file}); --force ih zapisuje ponovno.`,
    );
  } catch (error) {
    console.error(`✖ ${(error as Error).message}`);
    process.exit(1);
  }
}
