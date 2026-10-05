import { describe, expect, it } from 'vitest';
import { parseCredentials } from '../src/app.ts';
import { createBetaAuthProvider } from '../src/auth/beta-provider.ts';
import { ConfigError, loadAuthConfig } from '../src/auth/config.ts';
import { FailedLoginLimiter } from '../src/auth/rate-limit.ts';
import { createSessionToken, verifySessionToken } from '../src/auth/session.ts';
import { MESSAGES } from '../src/messages.ts';
import { PASSWORD, SECRET, testEnv, USERNAME } from './helpers.ts';

describe('loadAuthConfig', () => {
  it('refuses to start without configuration and never invents defaults', () => {
    expect(() => loadAuthConfig({})).toThrow(ConfigError);
    expect(() => loadAuthConfig({})).toThrow(
      /RENVARA_BETA_USERNAME, RENVARA_BETA_PASSWORD, RENVARA_SESSION_SECRET/,
    );
  });

  it.each(['RENVARA_BETA_USERNAME', 'RENVARA_BETA_PASSWORD', 'RENVARA_SESSION_SECRET'])(
    'names the missing variable %s',
    (key) => {
      expect(() => loadAuthConfig(testEnv({ [key]: undefined }))).toThrow(new RegExp(key));
    },
  );

  it('rejects a weak session secret', () => {
    expect(() => loadAuthConfig(testEnv({ RENVARA_SESSION_SECRET: 'short' }))).toThrow(/32/);
  });

  it('enables Secure cookies in production and allows an explicit override', () => {
    expect(loadAuthConfig(testEnv()).secureCookies).toBe(false);
    expect(loadAuthConfig(testEnv({ NODE_ENV: 'production' })).secureCookies).toBe(true);
    expect(loadAuthConfig(testEnv({ RENVARA_COOKIE_SECURE: 'true' })).secureCookies).toBe(true);
  });
});

describe('BETA provider (the single credential check)', () => {
  const provider = createBetaAuthProvider(loadAuthConfig(testEnv()));

  it('accepts only the exact configured pair', () => {
    expect(provider.authenticate(USERNAME, PASSWORD)).toEqual({
      id: 'beta-fgregov',
      username: 'fgregov',
      displayName: 'Frane Gregov',
      role: 'beta_admin',
    });
  });

  it.each([
    [USERNAME, 'wrong'],
    ['wrong', PASSWORD],
    ['FGREGOV', PASSWORD],
    [USERNAME, PASSWORD.toUpperCase()],
    [`${USERNAME}1`, PASSWORD],
    [USERNAME, `${PASSWORD} `],
    ['admin', 'admin'],
    ['', ''],
  ])('rejects %j / %j', (username, password) => {
    expect(provider.authenticate(username, password)).toBeNull();
  });
});

describe('parseCredentials', () => {
  it('trims the username but never the password', () => {
    expect(parseCredentials({ username: `  ${USERNAME} `, password: ` ${PASSWORD} ` })).toEqual({
      ok: true,
      username: USERNAME,
      password: ` ${PASSWORD} `,
    });
  });

  it('rejects empty and malformed input', () => {
    expect(parseCredentials({ username: '   ', password: 'x' })).toEqual({
      ok: false,
      message: MESSAGES.missingCredentials,
    });
    expect(parseCredentials({ username: 'x', password: '' })).toEqual({
      ok: false,
      message: MESSAGES.missingCredentials,
    });
    expect(parseCredentials({ username: 1, password: 'x' }).ok).toBe(false);
    expect(parseCredentials(['x']).ok).toBe(false);
    expect(parseCredentials(null).ok).toBe(false);
    expect(parseCredentials({ username: 'x'.repeat(129), password: 'x' }).ok).toBe(false);
  });
});

describe('session tokens', () => {
  const user = {
    id: 'beta-fgregov',
    username: USERNAME,
    displayName: 'Frane Gregov',
    role: 'beta_admin',
  } as const;
  const now = 1_790_000_000;

  it('round-trips and carries no password', () => {
    const { token } = createSessionToken(user, SECRET, 3600, now);
    const check = verifySessionToken(token, SECRET, now + 10);
    expect(check.status).toBe('valid');
    const payload = Buffer.from(token.split('.')[0] as string, 'base64url').toString('utf8');
    expect(payload).not.toContain(PASSWORD);
    expect(JSON.parse(payload)).toMatchObject({
      sub: 'beta-fgregov',
      role: 'beta_admin',
      iat: now,
      exp: now + 3600,
    });
  });

  it('reports expiry separately from tampering', () => {
    const { token } = createSessionToken(user, SECRET, 3600, now);
    expect(verifySessionToken(token, SECRET, now + 3600).status).toBe('expired');
  });

  it('rejects tampered payloads, signatures, other secrets and garbage', () => {
    const { token } = createSessionToken(user, SECRET, 3600, now);
    const [body, signature] = token.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, 'base64url').toString()),
        exp: now + 999_999,
      }),
    ).toString('base64url');
    expect(verifySessionToken(`${forged}.${signature}`, SECRET, now).status).toBe('invalid');
    expect(verifySessionToken(`${body}.${signature.slice(0, -2)}AA`, SECRET, now).status).toBe(
      'invalid',
    );
    expect(verifySessionToken(token, `${SECRET}x`, now).status).toBe('invalid');
    expect(verifySessionToken('not-a-token', SECRET, now).status).toBe('invalid');
    expect(verifySessionToken(undefined, SECRET, now).status).toBe('invalid');
  });
});

describe('FailedLoginLimiter', () => {
  it('blocks after the limit and frees the key after the window', () => {
    const limiter = new FailedLoginLimiter(3, 60_000);
    for (let i = 0; i < 3; i += 1) limiter.recordFailure('ip', 1_000);
    expect(limiter.retryAfterSeconds('ip', 1_000)).toBe(60);
    expect(limiter.retryAfterSeconds('ip', 61_000)).toBe(0);
    expect(limiter.retryAfterSeconds('other-ip', 1_000)).toBe(0);
  });
});
