// Transport-neutral CRM API: the route table and error mapping. The Node
// server (routes.ts) adds session, CSRF and body parsing around it; the static
// demo build calls it from the browser.
import { MESSAGES } from '../messages.ts';
import { CrmConflictError, CrmNotFoundError, CrmValidationError } from './errors.ts';
import type { CrmServices } from './index.ts';
import { inOrg, type Body } from './scope.ts';
import { seedDemoData } from './seed.ts';
import type { CrmContext } from './types.ts';

export interface ApiResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export type ApiMatch =
  | { readonly kind: 'none' }
  | { readonly kind: 'method_not_allowed'; readonly allow: string }
  | { readonly kind: 'ok'; readonly route: Route; readonly params: string[] };

const ID = '([A-Za-z0-9_-]{1,64})';

type Handler = (args: {
  ctx: CrmContext;
  params: string[];
  query: URLSearchParams;
  body: Body;
}) => { status?: number; body: Record<string, unknown> };

export interface Route {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly pattern: RegExp;
  readonly handler: Handler;
}

export function createCrmApi(crm: CrmServices) {
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
            leadId: q(query, 'leadId'),
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
    // ---- leads (separate from customers; never deleted)
    {
      method: 'GET',
      pattern: /^\/api\/leads$/,
      handler: ({ ctx, query }) =>
        ok({ leads: crm.leads.listLeads(ctx, { status: q(query, 'status'), q: q(query, 'q') }) }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/leads$/,
      handler: ({ ctx, body }) => ok({ lead: crm.leads.createLead(ctx, body) }, 201),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/leads/${ID}$`),
      handler: ({ ctx, params }) => ok({ lead: crm.leads.getLead(ctx, id(params)) }),
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/api/leads/${ID}$`),
      handler: ({ ctx, params, body }) => ok({ lead: crm.leads.updateLead(ctx, id(params), body) }),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/leads/${ID}/matches$`),
      handler: ({ ctx, params }) => ok({ matches: crm.leads.customerMatches(ctx, id(params)) }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/leads/${ID}/convert$`),
      handler: ({ ctx, params, body }) => ok(crm.leads.convertLead(ctx, id(params), body)),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/leads/${ID}/lost$`),
      handler: ({ ctx, params, body }) =>
        ok({ lead: crm.leads.markLeadLost(ctx, id(params), body) }),
    },
    // ---- Home dashboard: one period (calendar dates, inclusive) and its comparison period
    {
      method: 'GET',
      pattern: /^\/api\/dashboard\/summary$/,
      handler: ({ ctx, query }) =>
        ok({ summary: crm.dashboard.getPeriodSummary(ctx, q(query, 'from'), q(query, 'to')) }),
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
          leads: [...keep(data.leads), ...seed.leads],
        });
        return ok({ customers: inOrg(crm.repo.data().customers, ctx).length });
      },
    },
  ];

  /** Which route a request addresses (method included). */
  function match(method: string, path: string): ApiMatch {
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

  /** Runs a matched route; invalid input → 422, unknown or foreign record → 404. */
  function run(
    hit: Extract<ApiMatch, { kind: 'ok' }>,
    ctx: CrmContext,
    query: URLSearchParams,
    body: Body,
  ): ApiResponse {
    try {
      const result = hit.route.handler({ ctx, params: hit.params, query, body });
      return { status: result.status ?? 200, body: result.body };
    } catch (error) {
      if (error instanceof CrmValidationError) {
        return {
          status: 422,
          body: { success: false, message: error.message, errors: error.errors },
        };
      }
      if (error instanceof CrmConflictError) {
        return { status: 409, body: { success: false, message: error.message, ...error.details } };
      }
      if (error instanceof CrmNotFoundError) {
        return { status: 404, body: { success: false, message: error.message } };
      }
      throw error;
    }
  }

  return { match, run, badRequest: { success: false, message: MESSAGES.badRequest } };
}

export type CrmApi = ReturnType<typeof createCrmApi>;
