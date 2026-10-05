import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Resolves a URL path segment inside `root`, refusing traversal, hidden files
 * and unknown file types. Returns null when the request must 404.
 */
export async function resolveStaticFile(
  root: string,
  relativePath: string,
): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return null;
  if (!(extname(decoded) in CONTENT_TYPES)) return null;

  const absolute = resolve(root, ...segments);
  if (!absolute.startsWith(root + sep)) return null;
  try {
    return (await stat(absolute)).isFile() ? absolute : null;
  } catch {
    return null;
  }
}

export async function sendFile(
  res: ServerResponse,
  absolutePath: string,
  options: { cacheControl?: string; transformHtml?: (html: string) => string } = {},
): Promise<void> {
  const type = CONTENT_TYPES[extname(absolutePath)] ?? 'application/octet-stream';
  let body: Buffer | string = await readFile(absolutePath);
  if (options.transformHtml && type.startsWith('text/html')) {
    body = options.transformHtml(body.toString('utf8'));
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  if (options.cacheControl) res.setHeader('Cache-Control', options.cacheControl);
  res.end(body);
}
