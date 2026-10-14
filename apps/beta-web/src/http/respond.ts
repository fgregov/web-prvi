import type { IncomingMessage, ServerResponse } from 'node:http';

/** Applied to every response. Same-origin only: no CORS headers are ever sent. */
export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "style-src-attr 'unsafe-inline'",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

/** Protected or session-dependent responses must never be cached or restored from cache. */
export function noStore(res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Cookie');
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  noStore(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function redirect(res: ServerResponse, location: string): void {
  noStore(res);
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

export function sendText(res: ServerResponse, status: number, text: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

export class BodyError extends Error {
  override name = 'BodyError';
}

/** Reads a small JSON request body. Rejects oversized or malformed input. */
export async function readJsonBody(req: IncomingMessage, limitBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limitBytes) throw new BodyError('Request body too large');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BodyError('Malformed JSON');
  }
}

export function isJsonRequest(req: IncomingMessage): boolean {
  const type = req.headers['content-type'] ?? '';
  return type.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

/**
 * CSRF guard for state-changing requests. Browsers send Origin (and
 * Sec-Fetch-Site) on POST; anything that is not this same host is refused.
 * Combined with SameSite=Lax cookies and JSON-only bodies (which cross-site
 * forms cannot produce without a CORS preflight we never grant).
 *
 * `publicOrigin` (RENVARA_PUBLIC_ORIGIN) is the address users open when the
 * server runs behind an HTTPS tunnel or proxy that changes the Host header:
 * that one exact origin is accepted too.
 */
export function isSameOrigin(req: IncomingMessage, publicOrigin: string | null = null): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.host === req.headers.host || (publicOrigin !== null && url.origin === publicOrigin);
  } catch {
    return false;
  }
}

/**
 * The client's address for the failed-login limiter. Behind one reverse proxy
 * (RENVARA_TRUST_PROXY=true: Caddy, Fly.io, …) every connection comes from the
 * proxy, so the address the proxy itself appended to X-Forwarded-For (the last
 * one) is used; earlier entries come from the client and are not trusted.
 */
export function clientAddress(req: IncomingMessage, trustProxy = false): string {
  const socket = req.socket.remoteAddress ?? 'unknown';
  if (!trustProxy) return socket;
  const header = req.headers['x-forwarded-for'];
  const last = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  return last && last.length <= 64 ? last : socket;
}
