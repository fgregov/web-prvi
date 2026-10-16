/**
 * Server-side auth configuration, read once at startup.
 *
 * There are deliberately NO fallback credentials: if a required variable is
 * missing the server refuses to start and says which one.
 */

export interface AuthConfig {
  readonly username: string;
  /** RENVARA_BETA_PASSWORD; null when only its scrypt hash is configured. */
  readonly password: string | null;
  /** RENVARA_BETA_PASSWORD_HASH (`scrypt$N$r$p$salt$hash`): the password is never kept in plain text. */
  readonly passwordHash: string | null;
  readonly displayName: string;
  readonly sessionSecret: string;
  readonly sessionTtlSeconds: number;
  readonly secureCookies: boolean;
  /** The https address users open, when it differs from the Host the server sees (tunnel, proxy). */
  readonly publicOrigin: string | null;
  /** RENVARA_TRUST_PROXY: one reverse proxy in front (cloud), so the client is in X-Forwarded-For. */
  readonly trustProxy: boolean;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export const REQUIRED_ENV = [
  'RENVARA_BETA_USERNAME',
  'RENVARA_BETA_PASSWORD',
  'RENVARA_SESSION_SECRET',
] as const;

/** scrypt$N$r$p$salt$key (base64url), as written by identity/local-accounts.ts hashPassword. */
const PASSWORD_HASH = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{32,}$/;

export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export const MIN_SECRET_LENGTH = 32;

type Env = Readonly<Record<string, string | undefined>>;

export function loadAuthConfig(env: Env): AuthConfig {
  // The owner's password may be given as its scrypt hash instead (the local app does).
  const missing = REQUIRED_ENV.filter(
    (key) => !env[key] && !(key === 'RENVARA_BETA_PASSWORD' && env.RENVARA_BETA_PASSWORD_HASH),
  );
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required server configuration: ${missing.join(', ')}. ` +
        'Copy apps/beta-web/.env.example to apps/beta-web/.env and fill it in.',
    );
  }

  const username = env.RENVARA_BETA_USERNAME as string;
  const password = env.RENVARA_BETA_PASSWORD || null;
  const passwordHash = env.RENVARA_BETA_PASSWORD_HASH?.trim() || null;
  const sessionSecret = env.RENVARA_SESSION_SECRET as string;

  if (password && passwordHash) {
    throw new ConfigError('Set RENVARA_BETA_PASSWORD or RENVARA_BETA_PASSWORD_HASH, not both.');
  }
  if (passwordHash) {
    const match = PASSWORD_HASH.exec(passwordHash);
    const [n, r, p] = match ? match.slice(1).map(Number) : [];
    const sound =
      n !== undefined &&
      r !== undefined &&
      p !== undefined &&
      n >= 2 ** 14 &&
      n <= 2 ** 20 &&
      (n & (n - 1)) === 0 &&
      r >= 8 &&
      r <= 16 &&
      p >= 1 &&
      p <= 4;
    if (!sound) {
      throw new ConfigError(
        'RENVARA_BETA_PASSWORD_HASH must be a scrypt hash (scrypt$N$r$p$salt$key, N at least 2^14).',
      );
    }
  }

  if (username !== username.trim()) {
    throw new ConfigError('RENVARA_BETA_USERNAME must not have leading or trailing whitespace.');
  }
  if (sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      `RENVARA_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`,
    );
  }

  const secureOverride = env.RENVARA_COOKIE_SECURE;
  if (secureOverride !== undefined && secureOverride !== 'true' && secureOverride !== 'false') {
    throw new ConfigError('RENVARA_COOKIE_SECURE must be "true" or "false" when set.');
  }
  const secureCookies =
    secureOverride !== undefined ? secureOverride === 'true' : env.NODE_ENV === 'production';
  const trustProxy = env.RENVARA_TRUST_PROXY;
  if (trustProxy !== undefined && trustProxy !== 'true' && trustProxy !== 'false') {
    throw new ConfigError('RENVARA_TRUST_PROXY must be "true" or "false" when set.');
  }

  return {
    username,
    password,
    passwordHash,
    displayName: env.RENVARA_BETA_DISPLAY_NAME?.trim() || username,
    sessionSecret,
    sessionTtlSeconds: SESSION_TTL_SECONDS,
    secureCookies,
    publicOrigin: parsePublicOrigin(env.RENVARA_PUBLIC_ORIGIN),
    trustProxy: trustProxy === 'true',
  };
}

/** "https://host[:port]" only (http just for localhost): no path, query or credentials. */
function parsePublicOrigin(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError(
      'RENVARA_PUBLIC_ORIGIN must be an address like https://renvara.example.com.',
    );
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (
    !(url.protocol === 'https:' || (url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new ConfigError(
      'RENVARA_PUBLIC_ORIGIN must be only https:// and the host (no path), e.g. https://renvara.example.com.',
    );
  }
  return url.origin;
}
