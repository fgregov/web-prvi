// The web app's folder (apps/beta-web): pages, assets and the default data
// location. One place, so the bundled local app (localhost/build.ts), whose
// code all lives in one file one level below this folder, finds them too.
import { resolve } from 'node:path';

export const APP_DIR = resolve(import.meta.dirname, '..');
