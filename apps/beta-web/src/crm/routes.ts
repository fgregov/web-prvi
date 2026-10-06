// /api/* endpoints of the CRM. Every route needs a valid session; the
// organization comes from the server-side context, never from the request.
// Writes accept JSON only, from this origin only (same CSRF rule as login).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BodyError, isJsonRequest, isSameOrigin, readJsonBody, sendJson } from '../http/respond.ts';
import { MESSAGES } from '../messages.ts';
import { CrmNotFoundError, CrmValidationError } from './errors.ts';
import type { CrmServices } from './index.ts';
import { inOrg, type Body } from './scope.ts';
import { seedDemoData } from './seed.ts';
import type { CrmContext } from './types.ts';

const MAX_BODY_BYTES = 32 * 1024;
const ID = '([A-Za-z0-9_-]{1,64})';

type Handler = (args: {
  ctx: CrmContext;
  params: string[];
  query: URLSearchParams;
  body: Body;
}) => { status?: number; body: Record<string, unknown> };

interface Route {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly pattern: RegExp;
  readonly handler: Handler;
}

export function createCrmRoutes(crm: CrmServices) {
  const q = (query: URLSearchParams, name: string) => query.get(name) || null;
  const ok = (body: Record<string, unknown>, status = 200) => ({
    status,
    body: { success: true, ...body },
  });
  const id = (params: string[]) => params[0] as string;

  const routes: Route[] = [
    // ---- customers
    {
      method: 'GET',
      pattern: /^\/api\/customers$/,
      handler: ({ ctx, query }) =>
        ok({ customers: crm.customers.listCustomers(ctx, { q: q(query, 'q') }) }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/customers$/,
      handler: ({ ctx, body }) => ok({ customer: crm.customers.createCustomer(ctx, body) }, 201),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/customers/${ID}$`),
      handler: ({ ctx, params }) => ok({ customer: crm.customers.getProfile(ctx, id(params)) }),
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/api/customers/${ID}$`),
      handler: ({ ctx, params, body }) =>
        ok({ customer: crm.customers.updateCustomer(ctx, id(params), body) }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/customers/${ID}/notes$`),
      handler: ({ ctx, params, body }) =>
        ok({ activity: crm.customers.addNote(ctx, id(params), body) }, 201),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/customers/${ID}/emails$`),
      handler: ({ ctx, params, body }) =>
        ok({ activity: crm.customers.logEmail(ctx, id(params), body) }, 201),
    },
    // ---- contacts
    {
      method: 'GET',
      pattern: /^\/api\/contacts$/,
      handler: ({ ctx, query }) =>
        ok({ contacts: crm.contacts.listContacts(ctx, { companyId: q(query, 'companyId') }) }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/contacts$/,
      handler: ({ ctx, body }) => ok({ contact: crm.contacts.createContact(ctx, body) }, 201),
    },
    // ---- opportunities
    {
      method: 'GET',
      pattern: /^\/api\/opportunities$/,
      handler: ({ ctx, query }) =>
        ok({
          opportunities: crm.opportunities.listOpportunities(ctx, {
            companyId: q(query, 'companyId'),
            status: q(query, 'status'),
          }),
        }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/opportunities$/,
      handler: ({ ctx, body }) => ok(crm.opportunities.createOpportunity(ctx, body), 201),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/opportunities/${ID}$`),
      handler: ({ ctx, params }) =>
        ok({ opportunity: crm.opportunities.getOpportunity(ctx, id(params)) }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/pipeline$/,
      handler: ({ ctx }) => ok({ stages: crm.opportunities.pipeline(ctx) }),
    },
    // ---- tasks
    {
      method: 'GET',
      pattern: /^\/api\/tasks$/,
      handler: ({ ctx, query }) =>
        ok({
          tasks: crm.tasks.listTasks(ctx, {
            status: q(query, 'status'),
            companyId: q(query, 'companyId'),
            contactId: q(query, 'contactId'),
            opportunityId: q(query, 'opportunityId'),
            type: q(query, 'type'),
            priority: q(query, 'priority'),
          }),
        }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/tasks\/sections$/,
      handler: ({ ctx }) => ok({ sections: crm.tasks.sections(ctx) }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/tasks\/priorities$/,
      handler: ({ ctx }) => ok({ tasks: crm.tasks.priorities(ctx) }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/tasks$/,
      handler: ({ ctx, body }) => ok({ task: crm.tasks.createTask(ctx, body) }, 201),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/tasks/${ID}$`),
      handler: ({ ctx, params }) => ok({ task: crm.tasks.getTask(ctx, id(params)) }),
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/api/tasks/${ID}$`),
      handler: ({ ctx, params, body }) => ok({ task: crm.tasks.updateTask(ctx, id(params), body) }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/tasks/${ID}/(complete|reopen|cancel)$`),
      handler: ({ ctx, params }) => {
        const action = params[1];
        const task =
          action === 'complete'
            ? crm.tasks.completeTask(ctx, id(params))
            : action === 'reopen'
              ? crm.tasks.reopenTask(ctx, id(params))
              : crm.tasks.cancelTask(ctx, id(params));
        return ok({ task });
      },
    },
    // ---- Sales Calendar: tasks with a calendar slot in [from, to)
    {
      method: 'GET',
      pattern: /^\/api\/calendar$/,
      handler: ({ ctx, query }) => {
        const date = q(query, 'date');
        if (date) return ok({ tasks: crm.calendar.getDay(ctx, date) });
        const from = new Date(q(query, 'from') ?? '');
        const to = new Date(q(query, 'to') ?? '');
        return ok({ tasks: crm.calendar.getCalendarTasks(ctx, from, to) });
      },
    },
    // ---- BETA: restore this organization's demo data
    {
      method: 'POST',
      pattern: /^\/api\/demo\/reset$/,
      handler: ({ ctx }) => {
        const data = crm.repo.data();
        const seed = seedDemoData(ctx);
        const keep = <T extends { organizationId: string }>(rows: T[]) =>
          rows.filter((row) => row.organizationId !== ctx.organizationId);
        crm.repo.replace({
          ...data,
          seq: Math.max(data.seq, seed.seq),
          customers: [...keep(data.customers), ...seed.customers],
          contacts: [...keep(data.contacts), ...seed.contacts],
          opportunities: [...keep(data.opportunities), ...seed.opportunities],
          tasks: [...keep(data.tasks), ...seed.tasks],
          activities: [...keep(data.activities), ...seed.activities],
        });
        return ok({ customers: inOrg(crm.repo.data().customers, ctx).length });
      },
    },
  ];

  /** Returns false when the path is not a CRM endpoint. */
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    query: URLSearchParams,
    context: () => CrmContext | null,
  ): Promise<boolean> {
    const matches = routes
      .map((route) => ({ route, match: route.pattern.exec(path) }))
      .filter((m): m is { route: Route; match: RegExpExecArray } => m.match !== null);
    if (matches.length === 0) return false;

    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const hit = matches.find((m) => m.route.method === method);
    if (!hit) {
      res.setHeader('Allow', [...new Set(matches.map((m) => m.route.method))].join(', '));
      sendJson(res, 405, { success: false, message: MESSAGES.badRequest });
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
        sendJson(res, 403, { success: false, message: MESSAGES.badRequest });
        return true;
      }
      if (!isJsonRequest(req)) {
        sendJson(res, 415, { success: false, message: MESSAGES.badRequest });
        return true;
      }
      let parsed: unknown;
      try {
        parsed = await readJsonBody(req, MAX_BODY_BYTES);
      } catch (error) {
        if (!(error instanceof BodyError)) throw error;
        sendJson(res, 400, { success: false, message: MESSAGES.badRequest });
        return true;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        sendJson(res, 400, { success: false, message: MESSAGES.badRequest });
        return true;
      }
      body = parsed as Body;
    }

    try {
      const result = hit.route.handler({ ctx, params: hit.match.slice(1), query, body });
      sendJson(res, result.status ?? 200, result.body);
    } catch (error) {
      if (error instanceof CrmValidationError) {
        sendJson(res, 422, { success: false, message: error.message, errors: error.errors });
      } else if (error instanceof CrmNotFoundError) {
        sendJson(res, 404, { success: false, message: error.message });
      } else {
        throw error;
      }
    }
    return true;
  }

  return { handle };
}
