// The PDF resources of the Node server: Liberation Sans from pdf.js (the same
// package the app already ships; SIL Open Font License, LICENSE_LIBERATION
// next to it), the Renvara logo, and node:zlib. Loaded once, on first use.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { APP_DIR } from '../app-dir.ts';
import { parseTrueType } from './pdf/truetype.ts';
import type { PdfResources } from './report-pdf.ts';

const FONTS_DIR = resolve(APP_DIR, 'node_modules/pdfjs-dist/standard_fonts');
const LOGO = resolve(APP_DIR, '../../prototypes/home/assets/renvara-logo.png');

let loaded: Promise<PdfResources> | null = null;

export function nodePdfResources(): Promise<PdfResources> {
  loaded ??= (async () => {
    const [regular, bold, logo] = await Promise.all([
      readFile(resolve(FONTS_DIR, 'LiberationSans-Regular.ttf')),
      readFile(resolve(FONTS_DIR, 'LiberationSans-Bold.ttf')),
      readFile(LOGO).catch(() => null),
    ]);
    return {
      fonts: {
        regular: parseTrueType(new Uint8Array(regular)),
        bold: parseTrueType(new Uint8Array(bold)),
      },
      logo: logo ? new Uint8Array(logo) : null,
      zlib: {
        deflate: (bytes) => new Uint8Array(deflateSync(bytes, { level: 6 })),
        inflate: (bytes) => new Uint8Array(inflateSync(bytes)),
      },
    };
  })();
  loaded.catch(() => {
    loaded = null; // a missing file is retried on the next request
  });
  return loaded;
}
