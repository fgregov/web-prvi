// The web app's folder (apps/beta-web): pages, assets and the default data
// location. One place, so the bundled local app (localhost/build.ts), whose
// code all lives in one file one level below this folder, finds them too.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

export const APP_DIR = resolve(import.meta.dirname, '..');

/**
 * The pdfjs-dist package folder (viewer files, fonts), wherever it was
 * installed: next to the app (pnpm, the localhost package) or in the root
 * node_modules (npm workspaces hoist it).
 */
export const PDFJS_DIR = (() => {
  try {
    const requireFromApp = createRequire(resolve(APP_DIR, 'package.json'));
    return dirname(requireFromApp.resolve('pdfjs-dist/package.json'));
  } catch {
    return resolve(APP_DIR, 'node_modules/pdfjs-dist');
  }
})();
