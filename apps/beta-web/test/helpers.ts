import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type Logger } from '../src/app.ts';
import { createBetaAuthProvider } from '../src/auth/beta-provider.ts';
import { loadAuthConfig } from '../src/auth/config.ts';
import { createAuthService } from '../src/auth/service.ts';

/** Test credentials. The password is random per run, so no real secret lives in the repo. */
export const USERNAME = 'fgregov';
export const PASSWORD = `pw-${randomBytes(12).toString('hex')}`;
export const SECRET = randomBytes(48).toString('base64url');

export function testEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    RENVARA_BETA_USERNAME: USERNAME,
    RENVARA_BETA_PASSWORD: PASSWORD,
    RENVARA_SESSION_SECRET: SECRET,
    RENVARA_BETA_DISPLAY_NAME: 'Frane Gregov',
    ...overrides,
  };
}

export interface TestServer {
  readonly url: string;
  readonly clock: { now: number; nowMs(): number };
  readonly logs: string[];
  close(): Promise<void>;
}

export async function startTestServer(env = testEnv()): Promise<TestServer> {
  const config = loadAuthConfig(env);
  const clock = {
    now: Date.UTC(2026, 9, 5, 9, 0, 0),
    nowMs() {
      return this.now;
    },
  };
  const logs: string[] = [];
  const logger: Logger = {
    info: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
    warn: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
    error: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
  };
  const auth = createAuthService(config, createBetaAuthProvider(config), clock);
  const server: Server = createServer(createApp(auth, { logger }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    clock,
    logs,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function login(
  base: string,
  username: unknown,
  password: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ username, password }),
  });
}

/** "name=value" from a Set-Cookie header. */
export function cookiePair(response: Response): string {
  const header = response.headers.get('set-cookie');
  if (!header) throw new Error('No Set-Cookie header');
  return header.split(';')[0] as string;
}

export function get(base: string, path: string, cookie?: string) {
  return fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
}
