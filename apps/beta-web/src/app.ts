import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { AuthService } from './auth/service.ts';
import type { AuthSession } from './auth/types.ts';
import { parseCookies, serializeCookie } from './http/cookies.ts';
import {
  applySecurityHeaders,
  BodyError,
  isJsonRequest,
  isSameOrigin,
  noStore,
  readJsonBody,
  redirect,
  sendJson,
  sendText,
} from './http/respond.ts';
import { resolveStaticFile, sendFile } from './http/static.ts';
import { MESSAGES } from './messages.ts';

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

/** Protected CRM pages → HTML shell in public/app/pages. */
const CRM_PAGES: Record<string, string> = {
  '/customers': 'customers.html',
  '/customers/new': 'customer-new.html', // must win over the /customers/{id} pattern
  '/opportunities': 'opportunities.html',
  '/calendar': 'calendar.html',
};
const CUSTOMER_PAGE = /^\/customers\/[A-Za-z0-9_-]{1,64}$/;

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
  options: { paths?: AppPaths; logger?: Logger } = {},
): RequestListener {
  const paths = options.paths ?? defaultPaths;
  const logger = options.logger ?? consoleLogger;
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

  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isSameOrigin(req))
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

    const ip = req.socket.remoteAddress ?? 'unknown';
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
    if (!isSameOrigin(req))
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

    // ---- API -------------------------------------------------------------
    if (path.startsWith('/api/')) {
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

    if (path === DASHBOARD_PATH || path.startsWith(`${DASHBOARD_PATH}/`)) {
      return serveDashboard(req, res, path);
    }

    // ---- Demo CRM (protected) -------------------------------------------
    const crmPage = CRM_PAGES[path] ?? (CUSTOMER_PAGE.test(path) ? 'customer.html' : null);
    if (crmPage) {
      if (!requireAuth(req, res)) return;
      noStore(res);
      return sendFile(res, resolve(paths.appDir, 'pages', crmPage));
    }
    if (path.startsWith('/app/')) {
      if (!requireAuth(req, res)) return;
      noStore(res);
      const file = await resolveStaticFile(paths.appDir, path.slice('/app/'.length));
      return file ? sendFile(res, file) : sendText(res, 404, 'Not found');
    }

    return sendText(res, 404, 'Not found');
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
