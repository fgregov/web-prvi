// Korisnici over Node HTTP: /api/users/… (signed in) and the public
// POST /api/auth/set-password (invitation and reset links). Writes accept JSON
// from this origin only; password operations have their own rate limits.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BodyError,
  clientAddress,
  isJsonRequest,
  isSameOrigin,
  readJsonBody,
  sendJson,
} from '../http/respond.ts';
import { RequestLimiter } from '../http/request-limiter.ts';
import { MESSAGES } from '../messages.ts';
import type { Body } from '../crm/scope.ts';
import { answer, createUsersApi, type UsersResponse } from './users-api.ts';
import type { ServiceActor, UserService } from './user-service.ts';

const MAX_BODY_BYTES = 16 * 1024;

export interface UserRoutesOptions {
  readonly users: UserService;
  readonly organizationId: string;
  readonly publicOrigin: string | null;
  readonly trustProxy: boolean;
  /** Password changes and links per member; set-password per client address. */
  readonly limits?: { sensitive: RequestLimiter; setPassword: RequestLimiter };
}

export function createUserRoutes(options: UserRoutesOptions) {
  const api = createUsersApi(options.users);
  const limits = options.limits ?? {
    sensitive: new RequestLimiter(10, 10 * 60_000),
    setPassword: new RequestLimiter(10, 10 * 60_000),
  };

  /** Links point at RENVARA_PUBLIC_ORIGIN, else at this server as requested. */
  function originOf(req: IncomingMessage): string {
    if (options.publicOrigin) return options.publicOrigin;
    const host = req.headers.host ?? '';
    const safe = /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host) ? host : 'localhost';
    const secure = (req.socket as { encrypted?: boolean }).encrypted === true;
    return `${secure ? 'https' : 'http'}://${safe}`;
  }

  async function body(req: IncomingMessage, res: ServerResponse): Promise<Body | null> {
    if (!isSameOrigin(req, options.publicOrigin)) {
      sendJson(res, 403, api.badRequest);
      return null;
    }
    if (!isJsonRequest(req)) {
      sendJson(res, 415, api.badRequest);
      return null;
    }
    try {
      const parsed = await readJsonBody(req, MAX_BODY_BYTES);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        sendJson(res, 400, api.badRequest);
        return null;
      }
      return parsed as Body;
    } catch (error) {
      if (!(error instanceof BodyError)) throw error;
      sendJson(res, 400, api.badRequest);
      return null;
    }
  }

  const tooMany = (res: ServerResponse, limiter: RequestLimiter, key: string) => {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds(key, Date.now())));
    sendJson(res, 429, { success: false, message: MESSAGES.tooManyRequests });
  };

  /**
   * Handles /api/users/… and /api/auth/set-password; false for other paths.
   * `actor()`: the signed-in member (null without a session). `renew()`: a new
   * session cookie after one's own password change.
   */
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    actor: () => Promise<ServiceActor | null>,
    renew: (res: ServerResponse) => Promise<void>,
  ): Promise<boolean> {
    const path = url.pathname;
    const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');

    if (path === '/api/auth/set-password') {
      if (method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, api.badRequest);
        return true;
      }
      const ip = clientAddress(req, options.trustProxy);
      if (!limits.setPassword.allow(ip, Date.now())) {
        tooMany(res, limits.setPassword, ip);
        return true;
      }
      const input = await body(req, res);
      if (!input) return true;
      const token = typeof input.token === 'string' ? input.token : '';
      const result = await answer(async () => ({
        status: 200,
        body: {
          success: true,
          ...(await options.users.completeLink(options.organizationId, token, input)),
          redirectTo: '/login?reason=password-set',
        },
      }));
      sendJson(res, result.status, result.body);
      return true;
    }

    if (path !== '/api/users' && !path.startsWith('/api/users/')) return false;
    const hit = api.match(method, path);
    if (hit.kind === 'none') {
      sendJson(res, 404, api.badRequest);
      return true;
    }
    if (hit.kind === 'method_not_allowed') {
      res.setHeader('Allow', hit.allow);
      sendJson(res, 405, api.badRequest);
      return true;
    }
    const member = await actor();
    if (!member) {
      sendJson(res, 401, { success: false, message: MESSAGES.sessionRequired });
      return true;
    }
    if (hit.route.sensitive && !limits.sensitive.allow(member.id, Date.now())) {
      tooMany(res, limits.sensitive, member.id);
      return true;
    }
    let input: Body = {};
    if (method !== 'GET') {
      const parsed = await body(req, res);
      if (!parsed) return true;
      input = parsed;
    }
    const result: UsersResponse = await api.run(hit, {
      actor: member,
      query: url.searchParams,
      body: input,
      origin: originOf(req),
    });
    if (result.renewSession) await renew(res);
    sendJson(res, result.status, result.body);
    return true;
  }

  return { handle };
}
