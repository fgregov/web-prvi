export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && !cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

/** HttpOnly + SameSite=Lax + Path=/ always; Secure when configured. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.maxAgeSeconds <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
