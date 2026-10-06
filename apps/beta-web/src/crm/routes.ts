// /api/* endpoints of the CRM over Node HTTP. Every route needs a valid
// session; the organization comes from the server-side context, never from the
// request. Writes accept JSON only, from this origin only (same CSRF rule as login).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BodyError, isJsonRequest, isSameOrigin, readJsonBody, sendJson } from '../http/respond.ts';
import { MESSAGES } from '../messages.ts';
import { createCrmApi } from './dispatch.ts';
import type { CrmServices } from './index.ts';
import type { Body } from './scope.ts';
import type { CrmContext } from './types.ts';

const MAX_BODY_BYTES = 32 * 1024;

export function createCrmRoutes(crm: CrmServices) {
  const api = createCrmApi(crm);

  /** Returns false when the path is not a CRM endpoint. */
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    query: URLSearchParams,
    context: () => CrmContext | null,
  ): Promise<boolean> {
    const hit = api.match(req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET'), path);
    if (hit.kind === 'none') return false;
    if (hit.kind === 'method_not_allowed') {
      res.setHeader('Allow', hit.allow);
      sendJson(res, 405, api.badRequest);
      return true;
    }

    const ctx = context();
    if (!ctx) {
      sendJson(res, 401, { success: false, message: MESSAGES.sessionRequired });
      return true;
    }

    let body: Body = {};
    if (hit.route.method !== 'GET') {
      if (!isSameOrigin(req)) {
        sendJson(res, 403, api.badRequest);
        return true;
      }
      if (!isJsonRequest(req)) {
        sendJson(res, 415, api.badRequest);
        return true;
      }
      let parsed: unknown;
      try {
        parsed = await readJsonBody(req, MAX_BODY_BYTES);
      } catch (error) {
        if (!(error instanceof BodyError)) throw error;
        sendJson(res, 400, api.badRequest);
        return true;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        sendJson(res, 400, api.badRequest);
        return true;
      }
      body = parsed as Body;
    }

    const result = api.run(hit, ctx, query, body);
    sendJson(res, result.status, result.body);
    return true;
  }

  return { handle };
}
