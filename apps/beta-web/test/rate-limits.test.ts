// API request budgets by endpoint kind (src/app.ts, ApiLimits): reads, writes,
// the test notification and calls without a session each have their own
// budget, counted per user (signed in) or per client address (not signed in).
import { afterEach, describe, expect, it } from 'vitest';
import { defaultApiLimits } from '../src/app.ts';
import { RequestLimiter } from '../src/http/request-limiter.ts';
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

let server: TestServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const small = () => ({
  read: new RequestLimiter(5, 60_000),
  write: new RequestLimiter(3, 60_000),
  pushTest: new RequestLimiter(1, 60_000),
  anonymous: new RequestLimiter(4, 60_000),
});

const post = (url: string, path: string, cookie: string, body: unknown = {}) =>
  fetch(`${url}${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: url },
    body: JSON.stringify(body),
  });

describe('API request budgets', () => {
  it('the defaults differ by what an endpoint does', () => {
    const limits = defaultApiLimits();
    expect(limits.read.max).toBeGreaterThan(limits.write.max);
    expect(limits.write.max).toBeGreaterThan(limits.anonymous.max);
    expect(limits.pushTest.max).toBeLessThan(10);
    expect(limits.pushTest.windowMs).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it('reads: 429 with Retry-After once the budget is used up', async () => {
    server = await startTestServer(testEnv(), { apiLimits: small() });
    const cookie = cookiePair(await login(server.url, USERNAME, PASSWORD));
    for (let i = 0; i < 5; i += 1) {
      expect((await get(server.url, '/api/customers', cookie)).status).toBe(200);
    }
    const limited = await get(server.url, '/api/customers', cookie);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ success: false, message: MESSAGES.tooManyRequests });
  });

  it('writes have their own, smaller budget; reads still work', async () => {
    server = await startTestServer(testEnv(), { apiLimits: small() });
    const cookie = cookiePair(await login(server.url, USERNAME, PASSWORD));
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await post(server.url, '/api/leads', cookie, { name: `Lead ${i}` })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
    expect((await get(server.url, '/api/leads', cookie)).status).toBe(200);
  });

  it('the test notification: its own budget', async () => {
    server = await startTestServer(testEnv(), { apiLimits: small() });
    const cookie = cookiePair(await login(server.url, USERNAME, PASSWORD));
    expect((await post(server.url, '/api/push/test', cookie)).status).toBe(200);
    expect((await post(server.url, '/api/push/test', cookie)).status).toBe(429);
    expect((await post(server.url, '/api/leads', cookie, { name: 'Lead' })).status).toBe(201);
  });

  it('without a session: per client address, sign-in included', async () => {
    server = await startTestServer(testEnv(), { apiLimits: small() });
    for (let i = 0; i < 4; i += 1) {
      expect((await get(server.url, '/api/customers')).status).toBe(401);
    }
    expect((await get(server.url, '/api/customers')).status).toBe(429);
    expect((await login(server.url, USERNAME, PASSWORD)).status).toBe(429);
  });

  it('behind a proxy, each visitor of a customer link counts separately', async () => {
    server = await startTestServer(testEnv({ RENVARA_TRUST_PROXY: 'true' }));
    const visit = (client: string) =>
      fetch(`${server!.url}/o/nepostojeci-token-0000000000000000`, {
        headers: { 'X-Forwarded-For': client },
      });
    for (let i = 0; i < 120; i += 1) await visit('198.51.100.7');
    expect((await visit('198.51.100.7')).status).toBe(429);
    expect((await visit('198.51.100.8')).status).not.toBe(429);
  });
});
