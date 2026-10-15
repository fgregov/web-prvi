// Transport-neutral Korisnici API (/api/users/…): the Node server
// (identity/routes.ts) adds session, CSRF, rate limits and body parsing around
// it; the in-browser demo calls it directly. Every rule is in the user service.
import { MESSAGES } from '../messages.ts';
import {
  CrmConflictError,
  CrmForbiddenError,
  CrmNotFoundError,
  CrmValidationError,
} from '../crm/errors.ts';
import type { Body } from '../crm/scope.ts';
import type { ServiceActor, UserService } from './user-service.ts';

const ID = '([A-Za-z0-9_-]{1,64})';

export interface UsersRequest {
  readonly actor: ServiceActor;
  readonly params: string[];
  readonly query: URLSearchParams;
  readonly body: Body;
  /** Where links point (the public https address). */
  readonly origin: string;
}

export interface UsersResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
  /** A changed own password: the server gives this session a new cookie. */
  readonly renewSession?: boolean;
}

interface Route {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  readonly pattern: RegExp;
  /** Password operations: their own, stricter rate limit. */
  readonly sensitive?: boolean;
  readonly handler: (req: UsersRequest) => Promise<UsersResponse>;
}

export type UsersMatch =
  | { readonly kind: 'none' }
  | { readonly kind: 'method_not_allowed'; readonly allow: string }
  | { readonly kind: 'ok'; readonly route: Route; readonly params: string[] };

const ok = (body: Record<string, unknown>, status = 200): UsersResponse => ({
  status,
  body: { success: true, ...body },
});

export function createUsersApi(users: UserService) {
  const id = (req: UsersRequest) => req.params[0] as string;
  const routes: Route[] = [
    {
      method: 'GET',
      pattern: /^\/api\/users$/,
      handler: async (req) => ok(await users.list(req.actor, req.query)),
    },
    {
      method: 'POST',
      pattern: /^\/api\/users$/,
      handler: async (req) => {
        const { user, link } = await users.create(req.actor, req.body, req.origin);
        return ok({ user, link }, 201);
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/users/${ID}$`),
      handler: async (req) => ok(await users.get(req.actor, id(req))),
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/api/users/${ID}$`),
      handler: async (req) => ok({ user: await users.update(req.actor, id(req), req.body) }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/users/${ID}/deactivate$`),
      handler: async (req) => ok({ user: await users.setStatus(req.actor, id(req), 'inactive') }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/users/${ID}/activate$`),
      handler: async (req) => ok({ user: await users.setStatus(req.actor, id(req), 'active') }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/users/${ID}/password$`),
      sensitive: true,
      handler: async (req) => {
        const { self } = await users.changePassword(req.actor, id(req), req.body);
        return { ...ok({ self }), renewSession: self };
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/users/${ID}/password-link$`),
      sensitive: true,
      handler: async (req) =>
        ok({ link: await users.passwordLink(req.actor, id(req), req.origin) }),
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/api/users/${ID}/access$`),
      handler: async (req) => ok({ user: await users.setAccess(req.actor, id(req), req.body) }),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/users/${ID}/audit$`),
      handler: async (req) => ok({ entries: await users.audit(req.actor, id(req)) }),
    },
  ];

  function match(method: string, path: string): UsersMatch {
    const candidates = routes
      .map((route) => ({ route, found: route.pattern.exec(path) }))
      .filter((m): m is { route: Route; found: RegExpExecArray } => m.found !== null);
    if (candidates.length === 0) return { kind: 'none' };
    const hit = candidates.find((m) => m.route.method === method);
    if (!hit) {
      return {
        kind: 'method_not_allowed',
        allow: [...new Set(candidates.map((m) => m.route.method))].join(', '),
      };
    }
    return { kind: 'ok', route: hit.route, params: hit.found.slice(1) };
  }

  return {
    match,
    /** Runs a matched route: 422 invalid input, 403 not allowed, 404 unknown, 409 conflict. */
    async run(
      hit: Extract<UsersMatch, { kind: 'ok' }>,
      req: Omit<UsersRequest, 'params'>,
    ): Promise<UsersResponse> {
      return answer(() => hit.route.handler({ ...req, params: hit.params }));
    },
    badRequest: { success: false, message: MESSAGES.badRequest },
  };
}

/** Maps the service's errors to responses (shared with the public set-password call). */
export async function answer(work: () => Promise<UsersResponse>): Promise<UsersResponse> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CrmValidationError) {
      return {
        status: 422,
        body: { success: false, message: error.message, errors: error.errors },
      };
    }
    if (error instanceof CrmForbiddenError) {
      return { status: 403, body: { success: false, message: error.message } };
    }
    if (error instanceof CrmNotFoundError) {
      return { status: 404, body: { success: false, message: error.message } };
    }
    if (error instanceof CrmConflictError) {
      return { status: 409, body: { success: false, message: error.message, ...error.details } };
    }
    throw error;
  }
}

export type UsersApi = ReturnType<typeof createUsersApi>;
