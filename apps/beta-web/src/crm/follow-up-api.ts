// Transport-neutral Follow-up Engine API (ADR-0008): asynchronous (files,
// crypto) and with binary bodies, so it sits next to the JSON route table of
// dispatch.ts. The Node server (follow-up-routes.ts) adds sessions, CSRF, body
// limits and rate limits; the demo build calls it from the browser.
//
//   internal (session)  /api/follow-up/...
//   public (bearer)     /o/{token}/info · /o/{token}/document · POST /o/{token}/events
//                       (the viewer page /o/{token} itself is served by the transport)
import { MESSAGES } from '../messages.ts';
import { CrmConflictError, CrmNotFoundError, CrmValidationError } from './errors.ts';
import type { CrmServices } from './index.ts';
import type { Body } from './scope.ts';
import type { CrmContext } from './types.ts';

/** What a public request may reveal: the same for unknown, revoked and expired links. */
export const LINK_UNAVAILABLE = 'Ova poveznica više nije dostupna.';

export interface FollowUpRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  /** Internal routes: the signed-in user's context (null → 401). */
  readonly ctx: CrmContext | null;
  readonly json: Body | null;
  readonly bytes: Uint8Array | null;
  readonly headers: {
    readonly contentType: string | null;
    /** X-File-Name, URI-encoded by the client. */
    readonly fileName: string | null;
    readonly userAgent: string | null;
    readonly purpose: string | null;
  };
  /** A public request from a signed-in Renvara user: never customer engagement. */
  readonly internal: boolean;
  /** Origin for share URLs (RENVARA_PUBLIC_ORIGIN, else this server's address). */
  readonly origin: string;
  readonly now: Date;
}

export type FollowUpResponse =
  | { readonly status: number; readonly json: Record<string, unknown> }
  | { readonly status: number; readonly bytes: Uint8Array; readonly fileName: string };

type Scope = 'internal' | 'public';
type BodyKind = 'none' | 'json' | 'pdf';

interface Route {
  readonly method: 'GET' | 'POST';
  readonly pattern: RegExp;
  readonly scope: Scope;
  readonly body: BodyKind;
  readonly handler: (req: FollowUpRequest, params: string[]) => Promise<FollowUpResponse>;
}

export type FollowUpMatch =
  | { readonly kind: 'none' }
  | { readonly kind: 'method_not_allowed'; readonly allow: string }
  | { readonly kind: 'ok'; readonly route: Route; readonly params: string[] };

const ID = '([A-Za-z0-9_-]{1,64})';
const TOKEN = '([A-Za-z0-9_-]{43})';
export const VIEWER_PAGE = /^\/o\/([A-Za-z0-9_-]{1,128})\/?$/;

const ok = (body: Record<string, unknown>, status = 200): FollowUpResponse => ({
  status,
  json: { success: true, ...body },
});
const unavailable = (): FollowUpResponse => ({
  status: 404,
  json: { success: false, message: LINK_UNAVAILABLE },
});

function decodeFileName(raw: string | null): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

export function createFollowUpApi(crm: CrmServices) {
  const followUp = crm.followUp;
  const ctxOf = (req: FollowUpRequest) => req.ctx as CrmContext;
  const signals = (req: FollowUpRequest) => ({
    method: req.method,
    userAgent: req.headers.userAgent,
    purpose: req.headers.purpose,
  });
  const shareUrl = (req: FollowUpRequest, path: string | null | undefined) =>
    path ? `${req.origin}${path}` : null;

  async function detail(req: FollowUpRequest, id: string, extra: Record<string, unknown> = {}) {
    const offer = await followUp.detail(ctxOf(req), id);
    return { offer: { ...offer, shareUrl: shareUrl(req, offer.link?.path) }, ...extra };
  }

  const routes: Route[] = [
    // ---- internal: the salesperson ----------------------------------------
    {
      method: 'POST',
      pattern: /^\/api\/follow-up\/uploads$/,
      scope: 'internal',
      body: 'pdf',
      handler: async (req) =>
        ok(
          {
            upload: await followUp.stageUpload(ctxOf(req), {
              bytes: req.bytes ?? new Uint8Array(),
              fileName: decodeFileName(req.headers.fileName),
              contentType: req.headers.contentType,
            }),
          },
          201,
        ),
    },
    {
      method: 'GET',
      pattern: /^\/api\/follow-up\/offers$/,
      scope: 'internal',
      body: 'none',
      handler: async (req) =>
        ok(
          followUp.list(ctxOf(req), req.query.get('filter') || 'all', {
            from: req.query.get('from'),
            to: req.query.get('to'),
          }),
        ),
    },
    {
      method: 'POST',
      pattern: /^\/api\/follow-up\/offers$/,
      scope: 'internal',
      body: 'json',
      handler: async (req) => {
        const created = await followUp.createOffer(ctxOf(req), req.json ?? {});
        return ok(await detail(req, created.offerId, {}), 201);
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/follow-up/offers/${ID}$`),
      scope: 'internal',
      body: 'none',
      handler: async (req, [id]) => ok(await detail(req, id!)),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/follow-up/offers/${ID}/sent$`),
      scope: 'internal',
      body: 'json',
      handler: async (req, [id]) => {
        followUp.markSent(ctxOf(req), id!, req.json ?? {});
        return ok(await detail(req, id!));
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/follow-up/offers/${ID}/answered$`),
      scope: 'internal',
      body: 'json',
      handler: async (req, [id]) => {
        followUp.markAnswered(ctxOf(req), id!);
        return ok(await detail(req, id!));
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/follow-up/offers/${ID}/link/revoke$`),
      scope: 'internal',
      body: 'json',
      handler: async (req, [id]) => {
        followUp.revokeLink(ctxOf(req), id!);
        return ok(await detail(req, id!));
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/follow-up/offers/${ID}/link$`),
      scope: 'internal',
      body: 'json',
      handler: async (req, [id]) => {
        await followUp.issueLink(ctxOf(req), id!);
        return ok(await detail(req, id!));
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/follow-up/offers/${ID}/document$`),
      scope: 'internal',
      body: 'none',
      handler: async (req, [id]) => {
        const file = await followUp.readDocument(ctxOf(req), id!);
        return { status: 200, bytes: file.bytes, fileName: file.fileName };
      },
    },

    // ---- public: whoever holds the link ------------------------------------
    {
      method: 'GET',
      pattern: new RegExp(`^/o/${TOKEN}/info$`),
      scope: 'public',
      body: 'none',
      handler: async (req, [token]) => {
        const info = await followUp.publicInfo(token!, req.now);
        return info ? ok({ offer: info }) : unavailable();
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/o/${TOKEN}/document$`),
      scope: 'public',
      body: 'none',
      handler: async (req, [token]) => {
        const file = await followUp.publicDocument(token!, req.now);
        return file ? { status: 200, bytes: file.bytes, fileName: file.fileName } : unavailable();
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/o/${TOKEN}/events$`),
      scope: 'public',
      body: 'json',
      handler: async (req, [token]) => {
        const body = req.json ?? {};
        if (body.type !== 'view') return { status: 400, json: { success: false } };
        const outcome = await followUp.recordView(
          token!,
          { sessionId: body.sessionId, automation: body.automation },
          signals(req),
          req.now,
          req.internal,
        );
        if (outcome === null) return unavailable();
        if (outcome === 'invalid') return { status: 400, json: { success: false } };
        return ok({ recorded: outcome === 'recorded' });
      },
    },
  ];

  function match(method: string, path: string): FollowUpMatch {
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

  /** Runs a matched route: invalid input → 422, unknown or foreign record → 404. */
  async function run(
    hit: Extract<FollowUpMatch, { kind: 'ok' }>,
    req: FollowUpRequest,
  ): Promise<FollowUpResponse> {
    if (hit.route.scope === 'internal' && !req.ctx) {
      return { status: 401, json: { success: false, message: MESSAGES.sessionRequired } };
    }
    try {
      return await hit.route.handler(req, hit.params);
    } catch (error) {
      if (error instanceof CrmValidationError) {
        return {
          status: 422,
          json: { success: false, message: error.message, errors: error.errors },
        };
      }
      if (error instanceof CrmConflictError) {
        return { status: 409, json: { success: false, message: error.message, ...error.details } };
      }
      if (error instanceof CrmNotFoundError) {
        return hit.route.scope === 'public'
          ? unavailable()
          : { status: 404, json: { success: false, message: error.message } };
      }
      throw error;
    }
  }

  /**
   * GET /o/{token}: the viewer page was requested. Records `link_access` for a
   * live link (not for a signed-in Renvara user). Returns whether it is live.
   */
  function pageAccess(
    token: string,
    req: Pick<FollowUpRequest, 'method' | 'headers' | 'now' | 'internal'>,
  ) {
    return followUp.recordAccess(
      token,
      { method: req.method, userAgent: req.headers.userAgent, purpose: req.headers.purpose },
      req.now,
      req.internal,
    );
  }

  return { match, run, pageAccess, badRequest: { success: false, message: MESSAGES.badRequest } };
}

export type FollowUpApi = ReturnType<typeof createFollowUpApi>;
