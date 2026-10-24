/**
 * Ulazna točka. Prije učitavanja ostatka aplikacije (i Playwrighta) učitava .env i postavlja
 * mapu preglednika: ako postoji VendiStock/browsers (instalira je install.ps1), koristi se ona –
 * tako preglednik pronalazi i Windows servis koji radi pod računom LocalSystem.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadDotEnv, PROJECT_ROOT } from './config.js';

loadDotEnv();
const localBrowsers = path.join(PROJECT_ROOT, 'browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(localBrowsers)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
}
await import('./main.js');
