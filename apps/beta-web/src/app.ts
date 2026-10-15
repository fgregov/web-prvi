import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { AuthService } from './auth/service.ts';
import type { AuthSession } from './auth/types.ts';
import { parseCookies, serializeCookie } from './http/cookies.ts';
import {
  applySecurityHeaders,
  BodyError,
  clientAddress,
  isJsonRequest,
  isSameOrigin,
  noStore,
  readJsonBody,
  redirect,
  sendJson,
  sendText,
} from './http/respond.ts';
import { RequestLimiter } from './http/request-limiter.ts';
import { resolveStaticFile, sendFile } from './http/static.ts';
import { createCrmServices, type CrmServices } from './crm/index.ts';
import { createMemoryRepository } from './crm/repository.ts';
import type { PushConfig } from './crm/dispatch.ts';
import { applyViewerCsp, createFollowUpRoutes } from './crm/follow-up-routes.ts';
import { createCrmRoutes, type CrmRouteOptions } from './crm/routes.ts';
import { seedDemoData } from './crm/seed.ts';
import type { CrmContext } from './crm/types.ts';
import { MESSAGES } from './messages.ts';
import { legacyPath, pageForPath } from '../public/app/js/core/routes.js';

export interface AppPaths {
  /** Folder with the BETA login page (index.html, login.css, login.js). */
  readonly loginDir: string;
  /** Folder with the approved dashboard (served in place, unchanged). */
  readonly dashboardDir: string;
  /** Demo CRM client: pages/, js/, css/ (protected). */
  readonly appDir: string;
}

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const APP_DIR = resolve(import.meta.dirname, '..');

export const defaultPaths: AppPaths = {
  loginDir: resolve(APP_DIR, 'public/login'),
  dashboardDir: resolve(APP_DIR, '../../prototypes/home'),
  appDir: resolve(APP_DIR, 'public/app'),
};

const BRAND_ICONS = new Set([
  '/brand/icon-192.png',
  '/brand/icon-512.png',
  '/brand/apple-touch-icon.png',
]);

export interface CrmOptions {
  readonly services: CrmServices;
  /** Push reminders: whether this server can deliver them (VAPID keys set). */
  readonly push?: PushConfig;
  /** "Pošalji probnu obavijest" (the reminder scheduler of this server). */
  readonly pushTest?: CrmRouteOptions['pushTest'];
  /** BETA: the single organization of the BETA account. */
  readonly organizationId: string;
  readonly timeZone: string;
  readonly now?: () => Date;
}

/** Structured logs. Never pass request bodies, passwords, tokens or cookies here. */
export const consoleLogger: Logger = {
  info: (event, fields) =>
    console.log(JSON.stringify({ level: 'info', event, at: new Date().toISOString(), ...fields })),
  warn: (event, fields) =>
    console.warn(JSON.stringify({ level: 'warn', event, at: new Date().toISOString(), ...fields })),
  error: (event, fields) =>
    console.error(
      JSON.stringify({ level: 'error', event, at: new Date().toISOString(), ...fields }),
    ),
};

/**
 * API request budgets, by what an endpoint does (fixed windows, per process).
 * Signed-in calls count per user, others per client address. Uploads, the
 * customer's offer link and failed sign-ins have their own, stricter limits
 * (follow-up-routes.ts, auth). A budget a person reaches by hand would be a bug:
 * these stop scripts and runaway loops.
 */
export interface ApiLimits {
  /** GET: lists, records, dashboard numbers. */
  readonly read: RequestLimiter;
  /** POST/PATCH/PUT: creating and changing records. */
  readonly write: RequestLimiter;
  /** "Pošalji probnu obavijest": each one reaches the user's devices. */
  readonly pushTest: RequestLimiter;
  /** Any /api/ call without a session (sign-in included), per client address. */
  readonly anonymous: RequestLimiter;
}

export const defaultApiLimits = (): ApiLimits => ({
  read: new RequestLimiter(1200, 60_000),
  write: new RequestLimiter(240, 60_000),
  pushTest: new RequestLimiter(5, 10 * 60_000),
  anonymous: new RequestLimiter(60, 60_000),
});

const LOGIN_PATH = '/login';
const DASHBOARD_PATH = '/dashboard';
const MAX_BODY_BYTES = 4 * 1024;
const MAX_USERNAME_LENGTH = 128;
const MAX_PASSWORD_LENGTH = 512;

type Credentials =
  { ok: true; username: string; password: string } | { ok: false; message: string };

/**
 * Validates the login body. Username is trimmed; the password is used exactly
 * as typed (no trimming or case folding).
 */
export function parseCredentials(body: unknown): Credentials {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: MESSAGES.badRequest };
  }
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return { ok: false, message: MESSAGES.badRequest };
  }
  const trimmed = username.trim();
  if (trimmed === '' || password === '') return { ok: false, message: MESSAGES.missingCredentials };
  if (trimmed.length > MAX_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, message: MESSAGES.badRequest };
  }
  return { ok: true, username: trimmed, password };
}

export function createApp(
  auth: AuthService,
  options: {
    paths?: AppPaths;
    logger?: Logger;
    crm?: CrmOptions;
    /** RENVARA_PUBLIC_ORIGIN: the https address users open behind a tunnel or proxy. */
    publicOrigin?: string | null;
    /** RENVARA_TRUST_PROXY: the client address comes from the proxy's X-Forwarded-For. */
    trustProxy?: boolean;
    /** API request budgets (tests use small ones). */
    apiLimits?: ApiLimits;
  } = {},
): RequestListener {
  const paths = options.paths ?? defaultPaths;
  const logger = options.logger ?? consoleLogger;
  const crm = options.crm ?? inMemoryCrm();
  const publicOrigin = options.publicOrigin ?? null;
  const trustProxy = options.trustProxy ?? false;
  const crmRoutes = createCrmRoutes(crm.services, {
    ...(crm.push ? { push: crm.push } : {}),
    ...(crm.pushTest ? { pushTest: crm.pushTest } : {}),
    publicOrigin,
  });
  const now = crm.now ?? (() => new Date());
  const followUpRoutes = createFollowUpRoutes(crm.services, { publicOrigin, now, trustProxy });
  const apiLimits = options.apiLimits ?? defaultApiLimits();

  /** Seconds to wait when this API call is over its budget, else 0. */
  function apiBudget(req: IncomingMessage, method: string, path: string): number {
    const at = Date.now();
    const session = currentSession(req);
    const [limiter, key] = !session
      ? [apiLimits.anonymous, clientAddress(req, trustProxy)]
      : path === '/api/push/test'
        ? [apiLimits.pushTest, session.user.id]
        : method === 'GET'
          ? [apiLimits.read, session.user.id]
          : [apiLimits.write, session.user.id];
    return limiter.allow(key, at) ? 0 : limiter.retryAfterSeconds(key, at);
  }
  const logoFile = resolve(paths.dashboardDir, 'assets/renvara-logo.png');

  const sessionToken = (req: IncomingMessage) =>
    parseCookies(req.headers.cookie).get(auth.cookieName);
  const clearSessionCookie = (res: ServerResponse) =>
    res.setHeader(
      'Set-Cookie',
      serializeCookie(auth.cookieName, '', { maxAgeSeconds: 0, secure: auth.cookieOptions.secure }),
    );

  /** requireAuth: the valid session, or null after redirecting to the login page. */
  function requireAuth(req: IncomingMessage, res: ServerResponse): AuthSession | null {
    const token = sessionToken(req);
    const check = auth.checkSession(token);
    if (check.status === 'valid') return check.session;
    if (token !== undefined) clearSessionCookie(res);
    redirect(res, check.status === 'expired' ? `${LOGIN_PATH}?reason=expired` : LOGIN_PATH);
    return null;
  }

  function currentSession(req: IncomingMessage): AuthSession | null {
    const check = auth.checkSession(sessionToken(req));
    return check.status === 'valid' ? check.session : null;
  }

  /** Server-side CRM context: who, in which organization, at what time. Null without a session. */
  function crmContext(req: IncomingMessage): CrmContext | null {
    const session = currentSession(req);
    if (!session) return null;
    return {
      organizationId: crm.organizationId,
      user: { id: session.user.id, displayName: session.user.displayName },
      timeZone: crm.timeZone,
      now: now(),
    };
  }

  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isSameOrigin(req, publicOrigin))
      return sendJson(res, 403, { success: false, message: MESSAGES.badRequest });
    if (!isJsonRequest(req))
      return sendJson(res, 415, { success: false, message: MESSAGES.badRequest });

    let body: unknown;
    try {
      body = await readJsonBody(req, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyError) {
        return sendJson(res, 400, { success: false, message: MESSAGES.badRequest });
      }
      throw error;
    }

    const credentials = parseCredentials(body);
    if (!credentials.ok)
      return sendJson(res, 400, { success: false, message: credentials.message });

    const ip = clientAddress(req, trustProxy);
    const outcome = auth.login(credentials.username, credentials.password, ip);

    if (outcome.kind === 'rate_limited') {
      logger.warn('login_rate_limited', { ip });
      res.setHeader('Retry-After', String(outcome.retryAfterSeconds));
      return sendJson(res, 429, { success: false, message: MESSAGES.tooManyAttempts });
    }
    if (outcome.kind === 'invalid_credentials') {
      logger.warn('login_failed', { ip });
      return sendJson(res, 401, { success: false, message: MESSAGES.invalidCredentials });
    }

    logger.info('login_succeeded', { ip, user: outcome.session.user.id });
    res.setHeader(
      'Set-Cookie',
      serializeCookie(auth.cookieName, outcome.token, {
        maxAgeSeconds: outcome.session.expiresAt - outcome.session.issuedAt,
        secure: auth.cookieOptions.secure,
      }),
    );
    return sendJson(res, 200, { success: true, redirectTo: DASHBOARD_PATH });
  }

  function handleLogout(req: IncomingMessage, res: ServerResponse): void {
    if (!isSameOrigin(req, publicOrigin))
      return sendJson(res, 403, { success: false, message: MESSAGES.badRequest });
    if (!isJsonRequest(req))
      return sendJson(res, 415, { success: false, message: MESSAGES.badRequest });
    const session = currentSession(req);
    auth.logout(sessionToken(req));
    if (session) logger.info('logout', { user: session.user.id });
    clearSessionCookie(res);
    return sendJson(res, 200, { success: true, redirectTo: LOGIN_PATH });
  }

  function handleSession(req: IncomingMessage, res: ServerResponse): void {
    const session = currentSession(req);
    if (!session) return sendJson(res, 200, { authenticated: false });
    const { id, username, displayName, role } = session.user;
    return sendJson(res, 200, {
      authenticated: true,
      user: { id, username, displayName, role },
      expiresAt: new Date(session.expiresAt * 1000).toISOString(),
    });
  }

  async function serveDashboard(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<void> {
    if (!requireAuth(req, res)) return;
    noStore(res);

    const relative =
      path === DASHBOARD_PATH || path === `${DASHBOARD_PATH}/`
        ? 'index.html'
        : path.slice(DASHBOARD_PATH.length + 1);
    const file = await resolveStaticFile(paths.dashboardDir, relative);
    if (!file) return sendText(res, 404, 'Not found');

    await sendFile(res, file, {
      // The dashboard uses relative asset paths; anchor them under /dashboard/.
      transformHtml: (html) => {
        if (!html.includes('<head>')) throw new Error('Dashboard HTML has no <head>');
        return html.replace('<head>', '<head>\n    <base href="/dashboard/" />');
      },
    });
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');

    // ---- API budgets (the customer's offer link /o/… has its own) --------
    if (path.startsWith('/api/')) {
      const wait = apiBudget(req, method, path);
      if (wait > 0) {
        logger.warn('api_rate_limited', { path, method });
        res.setHeader('Retry-After', String(wait));
        return sendJson(res, 429, { success: false, message: MESSAGES.tooManyRequests });
      }
    }

    // ---- Follow-up Engine: its API, the customer's offer viewer (/o/…) ----
    if (await followUpRoutes.handle(req, res, url, () => crmContext(req))) return;

    // ---- API -------------------------------------------------------------
    if (path.startsWith('/api/')) {
      if (await crmRoutes.handle(req, res, path, url.searchParams, () => crmContext(req))) return;
      const routes: Record<string, { method: string; handler: () => void | Promise<void> }> = {
        '/api/auth/login': { method: 'POST', handler: () => handleLogin(req, res) },
        '/api/auth/logout': { method: 'POST', handler: () => handleLogout(req, res) },
        '/api/auth/session': { method: 'GET', handler: () => handleSession(req, res) },
      };
      const match = routes[path];
      if (!match) return sendJson(res, 404, { success: false, message: MESSAGES.badRequest });
      if (method !== match.method) {
        res.setHeader('Allow', match.method);
        return sendJson(res, 405, { success: false, message: MESSAGES.badRequest });
      }
      return match.handler();
    }

    if (method !== 'GET') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendText(res, 405, 'Method not allowed');
    }

    // ---- Pages -----------------------------------------------------------
    if (path === '/') return redirect(res, currentSession(req) ? DASHBOARD_PATH : LOGIN_PATH);

    if (path === LOGIN_PATH || path === `${LOGIN_PATH}/`) {
      if (currentSession(req)) return redirect(res, DASHBOARD_PATH);
      noStore(res);
      return sendFile(res, resolve(paths.loginDir, 'index.html'));
    }
    if (path === '/login/login.css' || path === '/login/login.js') {
      return sendFile(res, resolve(paths.loginDir, path.slice('/login/'.length)), {
        cacheControl: 'no-cache',
      });
    }
    if (path === '/brand/renvara-logo.png') {
      return sendFile(res, logoFile, { cacheControl: 'public, max-age=3600' });
    }
    // Home Screen and notification icons (square, white background).
    if (BRAND_ICONS.has(path)) {
      return sendFile(res, resolve(paths.appDir, '..', path.slice(1)), {
        cacheControl: 'public, max-age=86400',
      });
    }
    // Push reminders: the service worker (root scope) and the web app manifest
    // (iOS delivers web push only to apps added to the Home Screen). No data inside.
    if (path === '/sw.js') {
      res.setHeader('Service-Worker-Allowed', '/');
      return sendFile(res, resolve(paths.appDir, '..', 'sw.js'), { cacheControl: 'no-cache' });
    }
    if (path === '/manifest.webmanifest') {
      return sendFile(res, resolve(paths.appDir, '..', 'manifest.webmanifest'), {
        cacheControl: 'public, max-age=3600',
      });
    }

    if (path === DASHBOARD_PATH || path.startsWith(`${DASHBOARD_PATH}/`)) {
      return serveDashboard(req, res, path);
    }

    // ---- CRM pages (protected): one address per page, core/routes.js ----
    const crmPage = pageForPath(path);
    if (crmPage) {
      if (!requireAuth(req, res)) return;
      noStore(res);
      // The internal offer preview renders the PDF with pdf.js (worker, WebAssembly).
      if (crmPage === 'follow-up-preview') applyViewerCsp(res);
      return sendFile(res, resolve(paths.appDir, 'pages', `${crmPage}.html`));
    }
    if (path.startsWith('/app/')) {
      if (!requireAuth(req, res)) return;
      noStore(res);
      const file = await resolveStaticFile(paths.appDir, path.slice('/app/'.length));
      return file ? sendFile(res, file) : sendText(res, 404, 'Not found');
    }

    // Old addresses and a trailing slash → the page's address (query kept).
    // Always a path on this site: a fixed prefix, or a page address.
    const trimmed = path.replace(/(.)\/+$/, '$1');
    const moved =
      legacyPath(trimmed) ?? (trimmed !== path && pageForPath(trimmed) ? trimmed : null);
    if (moved) return redirect(res, `${moved}${url.search}`, 301);

    noStore(res);
    return sendFile(res, resolve(paths.loginDir, 'not-found.html'), { status: 404 });
  }

  return (req, res) => {
    applySecurityHeaders(res);
    route(req, res).catch((error: unknown) => {
      logger.error('unhandled_error', {
        path: (req.url ?? '').split('?')[0],
        error: error instanceof Error ? error.message : 'unknown',
      });
      if (res.headersSent) return res.end();
      if ((req.url ?? '').startsWith('/api/')) {
        return sendJson(res, 500, { success: false, message: MESSAGES.serverError });
      }
      return sendText(res, 500, MESSAGES.serverError);
    });
  };
}

/** Seeded in-memory CRM (tests, or an app created without persistent storage). */
function inMemoryCrm(): CrmOptions {
  const organizationId = 'org-beta';
  const timeZone = 'Europe/Zagreb';
  const data = seedDemoData({
    organizationId,
    timeZone,
    user: { id: 'beta-user', displayName: 'Demo' },
    now: new Date(),
  });
  return {
    services: createCrmServices(createMemoryRepository(data)),
    organizationId,
    timeZone,
  };
}
