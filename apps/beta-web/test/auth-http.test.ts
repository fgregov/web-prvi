import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MESSAGES } from '../src/messages.ts';
import {
  cookiePair,
  get,
  login,
  PASSWORD,
  startTestServer,
  testEnv,
  USERNAME,
  type TestServer,
} from './helpers.ts';

let server: TestServer;
beforeEach(async () => {
  server = await startTestServer();
});
afterEach(async () => {
  await server.close();
});

async function signIn(): Promise<string> {
  const response = await login(server.url, USERNAME, PASSWORD);
  expect(response.status).toBe(200);
  return cookiePair(response);
}

describe('POST /api/auth/login', () => {
  it('TEST 1 · correct credentials → 200, redirect target and a secure session cookie', async () => {
    const response = await login(server.url, USERNAME, PASSWORD);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, redirectTo: '/dashboard' });
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^renvara_session=[\w-]+\.[\w-]+; /);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=28800');
    expect(cookie).not.toContain('Secure'); // local HTTP development
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it.each([
    ['TEST 2 · wrong password', USERNAME, 'wrong'],
    ['TEST 3 · wrong username', 'wrong', PASSWORD],
    ['TEST 4 · upper-case username', 'FGREGOV', PASSWORD],
    ['TEST 5 · upper-case password', USERNAME, PASSWORD.toUpperCase()],
    ['username with suffix', `${USERNAME}1`, PASSWORD],
    ['password with trailing space', USERNAME, `${PASSWORD} `],
    ['admin/admin', 'admin', 'admin'],
  ])('%s → 401, generic message, no session', async (_name, username, password) => {
    const response = await login(server.url, username, password);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, message: MESSAGES.invalidCredentials });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('TEST 6 · empty username → 400', async () => {
    const response = await login(server.url, '   ', PASSWORD);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, message: MESSAGES.missingCredentials });
  });

  it('TEST 7 · empty password → 400', async () => {
    const response = await login(server.url, USERNAME, '');
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('trims surrounding spaces from the username only', async () => {
    expect((await login(server.url, `  ${USERNAME}  `, PASSWORD)).status).toBe(200);
  });

  it('rejects malformed, non-JSON, cross-site and wrong-method requests', async () => {
    const malformed = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"username":',
    });
    expect(malformed.status).toBe(400);

    const form = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=${USERNAME}&password=${PASSWORD}`,
    });
    expect(form.status).toBe(415);

    const crossSite = await login(server.url, USERNAME, PASSWORD, {
      Origin: 'https://evil.example',
    });
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get('set-cookie')).toBeNull();

    const viaGet = await fetch(`${server.url}/api/auth/login?username=${USERNAME}&password=x`);
    expect(viaGet.status).toBe(405);
  });

  it('rate-limits repeated failures per client, even for the right password', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await login(server.url, USERNAME, `wrong-${i}`)).status).toBe(401);
    }
    const blocked = await login(server.url, USERNAME, PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(await blocked.json()).toEqual({ success: false, message: MESSAGES.tooManyAttempts });

    server.clock.now += 60_000;
    expect((await login(server.url, USERNAME, PASSWORD)).status).toBe(200);
  });

  it('never logs the password and never sends CORS headers', async () => {
    const response = await login(server.url, USERNAME, `${PASSWORD}-typo`);
    await login(server.url, USERNAME, PASSWORD);
    expect(server.logs.join('\n')).not.toContain(PASSWORD);
    expect(server.logs.some((line) => line.includes('"event":"login_failed"'))).toBe(true);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('protected dashboard', () => {
  it('TEST 8 · valid session → approved dashboard, not cacheable', async () => {
    const response = await get(server.url, '/dashboard', await signIn());
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<base href="/dashboard/" />');
    expect(html).toContain('Opportunity Pipeline');
    expect(response.headers.get('cache-control')).toContain('no-store');

    const asset = await get(server.url, '/dashboard/styles.css', await signIn());
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/css');
  });

  it('TEST 9 · no session → redirect to /login (page and assets)', async () => {
    for (const path of ['/dashboard', '/dashboard/', '/dashboard/app.js']) {
      const response = await get(server.url, path);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/login');
    }
  });

  it('TEST 10 · tampered session → redirect to /login and the cookie is cleared', async () => {
    const [name, value] = (await signIn()).split('=') as [string, string];
    const [body, signature] = value.split('.') as [string, string];
    const forgedBody = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, 'base64url').toString()),
        username: 'admin',
      }),
    ).toString('base64url');
    const response = await get(server.url, '/dashboard', `${name}=${forgedBody}.${signature}`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('expired session → redirect to /login?reason=expired', async () => {
    const cookie = await signIn();
    server.clock.now += 8 * 60 * 60 * 1000;
    const response = await get(server.url, '/dashboard', cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login?reason=expired');
  });

  it('refuses path traversal out of the dashboard folder', async () => {
    const cookie = await signIn();
    for (const path of [
      '/dashboard/..%2f..%2fpackage.json',
      '/dashboard/.env',
      '/dashboard/assets/x.txt',
    ]) {
      expect((await get(server.url, path, cookie)).status).toBe(404);
    }
  });
});

describe('logout', () => {
  it('TEST 11 · logout clears the cookie and ends the session', async () => {
    const cookie = await signIn();
    const response = await fetch(`${server.url}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, redirectTo: '/login' });
    expect(response.headers.get('set-cookie')).toMatch(/^renvara_session=; .*Max-Age=0/);

    const session = await get(server.url, '/api/auth/session', cookie);
    expect(await session.json()).toEqual({ authenticated: false });
  });

  it('TEST 12 · the old cookie no longer opens /dashboard after logout', async () => {
    const cookie = await signIn();
    await fetch(`${server.url}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{}',
    });
    const response = await get(server.url, '/dashboard', cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login');
  });
});

describe('entry routes and session endpoint', () => {
  it('routes / and /login by session state', async () => {
    expect((await get(server.url, '/')).headers.get('location')).toBe('/login');
    const cookie = await signIn();
    expect((await get(server.url, '/', cookie)).headers.get('location')).toBe('/dashboard');
    expect((await get(server.url, '/login', cookie)).headers.get('location')).toBe('/dashboard');
    expect((await get(server.url, '/login')).status).toBe(200);
  });

  it('GET /api/auth/session exposes identity only', async () => {
    const response = await get(server.url, '/api/auth/session', await signIn());
    const body = await response.json();
    expect(body).toMatchObject({
      authenticated: true,
      user: { username: USERNAME, displayName: 'Frane Gregov', role: 'beta_admin' },
    });
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
  });

  it('serves no credentials to the browser', async () => {
    for (const path of ['/login', '/login/login.js', '/login/login.css']) {
      const text = await (await get(server.url, path)).text();
      expect(text).not.toContain(PASSWORD);
    }
  });
});

describe('production cookies', () => {
  it('uses Secure and the __Host- prefix when NODE_ENV=production', async () => {
    await server.close();
    server = await startTestServer(testEnv({ NODE_ENV: 'production' }));
    const response = await login(server.url, USERNAME, PASSWORD);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^__Host-renvara_session=/);
    expect(cookie).toContain('Secure');
  });
});
