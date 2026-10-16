// IZVJEŠTAJI API, transport-neutral (the Node server wraps it in
// report-routes.ts, the in-browser demo calls it directly):
//
//   GET  /api/reports/options    report types this member may run, the choices of
//                                the filters (customers, closed opportunities,
//                                representatives, years) and the e-mail state
//   POST /api/reports/generate   { type, …filters } → the report (what the page shows)
//   POST /api/reports/pdf        { type, …filters } → application/pdf (the same report)
//   POST /api/reports/email      { filters, to, subject, message, fileName, requestId }
//   GET  /api/reports/emails     the last e-mails sent from reports
//
// Every call is checked here, whatever the page showed: reports.view and
// opportunities.view for all, reports.sales_reps for the comparison of
// representatives, reports.email for sending. Filters are read and checked on
// the server (core/reports.js); the organization always comes from the session.
import {
  canRunReport,
  cleanAttachmentName,
  normalizeReportFilters,
  REPORT_BASE_RIGHTS,
  REPORT_EMAIL_TEXT,
  REPORT_MESSAGES,
  REPORT_TYPES,
  reportFileName,
  reportSubject,
  UNASSIGNED,
  UNASSIGNED_LABEL,
  validateReportEmail,
} from '../../public/app/js/core/reports.js';
import type { Mailer } from '../email/mailer.ts';
import { CrmValidationError, FORBIDDEN_MESSAGE } from '../crm/errors.ts';
import type { CrmServices } from '../crm/index.ts';
import { inOrg, newId } from '../crm/scope.ts';
import { calendarDateInZone } from '../crm/time.ts';
import type { CrmContext, ReportEmail } from '../crm/types.ts';
import { RequestLimiter } from '../http/request-limiter.ts';
import {
  buildReport,
  closedDeals,
  type Report,
  type ReportFilters,
  type ReportMember,
} from './report-engine.ts';
import { renderReportPdf, type PdfResources } from './report-pdf.ts';

export type ReportResponse =
  | {
      readonly status: number;
      readonly json: Record<string, unknown>;
      readonly retryAfter?: number;
    }
  | {
      readonly status: number;
      readonly bytes: Uint8Array;
      readonly fileName: string;
      readonly inline: boolean;
    };

export interface ReportApiOptions {
  readonly crm: CrmServices;
  /** The organization's members (names for the representatives). */
  readonly members: (ctx: CrmContext) => Promise<readonly ReportMember[]>;
  readonly pdf: () => Promise<PdfResources>;
  readonly mailer: Mailer;
  /** Structured log without personal data (never addresses, texts or keys). */
  readonly log?: (event: string, fields: Record<string, unknown>) => void;
  readonly limits?: {
    readonly generate?: RequestLimiter;
    readonly emailPerUser?: RequestLimiter;
    readonly emailPerOrg?: RequestLimiter;
  };
}

const forbidden = (): ReportResponse => ({
  status: 403,
  json: { success: false, message: FORBIDDEN_MESSAGE },
});
const invalid = (errors: Record<string, string>, message?: string): ReportResponse => ({
  status: 422,
  json: {
    success: false,
    message: message ?? Object.values(errors)[0] ?? 'Provjerite filtre izvještaja.',
    errors,
  },
});
const ok = (body: Record<string, unknown>, status = 200): ReportResponse => ({
  status,
  json: { success: true, ...body },
});

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_PDF_BYTES = 15 * 1024 * 1024;

export function createReportApi(options: ReportApiOptions) {
  const { crm, mailer } = options;
  const log = options.log ?? (() => {});
  const limits = {
    generate: options.limits?.generate ?? new RequestLimiter(60, 60_000),
    emailPerUser: options.limits?.emailPerUser ?? new RequestLimiter(10, 10 * 60_000),
    emailPerOrg: options.limits?.emailPerOrg ?? new RequestLimiter(200, 24 * 60 * 60_000),
  };
  /** requestId → the outcome of that send (a repeated click gets the same answer). */
  const sends = new Map<string, { at: number; result: Promise<ReportResponse> }>();

  const can = (ctx: CrmContext, key: string) => ctx.access?.permissions.has(key) === true;
  const today = (ctx: CrmContext) => calendarDateInZone(ctx.now, ctx.timeZone);

  function busy(limiter: RequestLimiter, key: string): ReportResponse | null {
    const at = Date.now();
    if (limiter.allow(key, at)) return null;
    const retryAfter = limiter.retryAfterSeconds(key, at);
    return {
      status: 429,
      retryAfter,
      json: {
        success: false,
        message: `Previše zahtjeva. Pokušajte ponovno za ${retryAfter} s.`,
      },
    };
  }

  /** Reads the filters and checks the member may run that report. */
  function filtersOf(
    ctx: CrmContext,
    input: unknown,
  ): { filters: ReportFilters } | { refused: ReportResponse } {
    const { filters, errors } = normalizeReportFilters(input, today(ctx));
    if (!filters) return { refused: invalid(errors) };
    if (!canRunReport(ctx.access?.permissions ?? new Set(), filters.type)) {
      return { refused: forbidden() };
    }
    return { filters: filters as ReportFilters };
  }

  async function report(ctx: CrmContext, filters: ReportFilters): Promise<Report> {
    const members = await options.members(ctx);
    return buildReport({ data: crm.repo.data(), ctx, members }, filters);
  }

  /** CrmValidationError → 422; anything else is a server error (logged without data). */
  async function guarded(work: () => Promise<ReportResponse>): Promise<ReportResponse> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof CrmValidationError) return invalid(error.errors, error.message);
      log('report.error', { error: (error as Error)?.name ?? 'Error' });
      return {
        status: 500,
        json: {
          success: false,
          message: 'Izvještaj trenutno nije moguće izraditi. Pokušajte ponovno.',
        },
      };
    }
  }

  async function options_(ctx: CrmContext): Promise<ReportResponse> {
    if (!REPORT_BASE_RIGHTS.every((key) => can(ctx, key))) return forbidden();
    const data = crm.repo.data();
    const members = await options.members(ctx);
    const deals = closedDeals(data, ctx, members);
    const permissions = ctx.access?.permissions ?? new Set<string>();
    const years = new Set<number>([Number(today(ctx).slice(0, 4))]);
    for (const d of deals) years.add(Number(d.closedDate.slice(0, 4)));
    const owners = new Set(deals.map((d) => d.ownerId).filter(Boolean));
    const reps = members
      .filter((m) => (m.role === 'user' && m.status === 'active') || owners.has(m.id))
      .map((m) => ({ id: m.id, name: m.status === 'active' ? m.name : `${m.name} (neaktivan)` }));
    for (const id of owners) {
      if (id && !reps.some((r) => r.id === id)) {
        reps.push({
          id,
          name: deals.find((d) => d.ownerId === id)?.ownerName ?? 'Nepoznat korisnik',
        });
      }
    }
    const collator = new Intl.Collator('hr', { sensitivity: 'base' });
    reps.sort((a, b) => collator.compare(a.name, b.name));
    return ok({
      today: today(ctx),
      timeZone: ctx.timeZone,
      types: REPORT_TYPES.filter((t) => canRunReport(permissions, t.value)).map((t) => ({
        value: t.value,
        label: t.label,
      })),
      customers: inOrg(data.customers, ctx)
        .map((c) => ({ id: c.id, name: c.companyName, active: c.status !== 'inactive' }))
        .sort((a, b) => collator.compare(a.name, b.name)),
      opportunities: deals
        .map((d) => ({
          id: d.id,
          title: d.title,
          customerId: d.customerId,
          status: d.status,
          closedDate: d.closedDate,
        }))
        .sort((a, b) => collator.compare(a.title, b.title)),
      reps: [...reps, { id: UNASSIGNED, name: UNASSIGNED_LABEL }],
      years: [...years].sort((a, b) => b - a),
      email: {
        allowed: can(ctx, 'reports.email'),
        configured: mailer.configured,
        from: mailer.configured ? mailer.from : null,
        message: mailer.configured
          ? null
          : 'Slanje e-maila nije konfigurirano na serveru (e-mail servis, npr. Resend: RESEND_API_KEY i RENVARA_EMAIL_FROM). Izvještaj možete preuzeti kao PDF.',
      },
    });
  }

  async function generate(ctx: CrmContext, body: Record<string, unknown>): Promise<ReportResponse> {
    const read = filtersOf(ctx, body);
    if ('refused' in read) return read.refused;
    const { filters } = read;
    const limited = busy(limits.generate, ctx.user.id);
    if (limited) return limited;
    return guarded(async () => {
      const r = await report(ctx, filters);
      return ok({
        report: r,
        fileName: reportFileName(filters),
        email: {
          subject: reportSubject(r.title, r.period.label),
          message: REPORT_EMAIL_TEXT,
        },
      });
    });
  }

  async function pdf(
    ctx: CrmContext,
    body: Record<string, unknown>,
    inline: boolean,
  ): Promise<ReportResponse> {
    const read = filtersOf(ctx, body);
    if ('refused' in read) return read.refused;
    const { filters } = read;
    const limited = busy(limits.generate, ctx.user.id);
    if (limited) return limited;
    return guarded(async () => {
      const r = await report(ctx, filters);
      const bytes = await renderReportPdf(r, await options.pdf());
      return { status: 200, bytes, fileName: reportFileName(filters), inline } as ReportResponse;
    });
  }

  async function email(ctx: CrmContext, body: Record<string, unknown>): Promise<ReportResponse> {
    const read = filtersOf(ctx, body.filters);
    if ('refused' in read) return read.refused;
    const { filters } = read;
    if (!can(ctx, 'reports.email')) return forbidden();
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    if (!REQUEST_ID.test(requestId)) return invalid({ requestId: REPORT_MESSAGES.id });
    const errors = validateReportEmail(body);
    if (Object.keys(errors).length) return invalid(errors);
    if (!mailer.configured) {
      return {
        status: 503,
        json: {
          success: false,
          code: 'email_not_configured',
          message:
            'E-mail nije poslan: slanje e-maila nije konfigurirano na serveru. Administrator treba postaviti e-mail servis (RESEND_API_KEY i RENVARA_EMAIL_FROM).',
        },
      };
    }
    // One click, one e-mail: a repeat of the same request gets the first answer.
    const key = `${ctx.organizationId}:${ctx.user.id}:${requestId}`;
    const now = Date.now();
    for (const [k, v] of sends) if (now - v.at > 30 * 60_000) sends.delete(k);
    const previous = sends.get(key);
    if (previous) return previous.result;
    const limited =
      busy(limits.emailPerUser, ctx.user.id) ?? busy(limits.emailPerOrg, ctx.organizationId);
    if (limited) return limited;
    const result = guarded(() => send(ctx, filters, body, requestId));
    sends.set(key, { at: now, result });
    return result;
  }

  async function send(
    ctx: CrmContext,
    filters: ReportFilters,
    body: Record<string, unknown>,
    requestId: string,
  ): Promise<ReportResponse> {
    const r = await report(ctx, filters);
    const bytes = await renderReportPdf(r, await options.pdf());
    if (bytes.length > MAX_PDF_BYTES) {
      return invalid({ range: 'PDF je prevelik za e-mail. Suzite razdoblje ili filtre.' });
    }
    const to = String(body.to).trim();
    const attachmentName = cleanAttachmentName(body.fileName, reportFileName(filters));
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const result = await mailer.send({
      to,
      subject: String(body.subject).trim(),
      text: `${message || REPORT_EMAIL_TEXT}\n\n—\n${r.title} · ${r.period.label}\nPoslano iz RENVARA CRM-a (${ctx.user.displayName}).`,
      attachments: [{ filename: attachmentName, content: bytes, contentType: 'application/pdf' }],
      idempotencyKey: `renvara-report-${ctx.organizationId}-${requestId}`.slice(0, 256),
    });
    const entry: ReportEmail = {
      id: newId(),
      organizationId: ctx.organizationId,
      sentBy: ctx.user.id,
      sentByName: ctx.user.displayName,
      recipient: to,
      reportType: filters.type,
      periodFrom: filters.from ?? null,
      periodTo: filters.to ?? null,
      attachmentName,
      status: result.ok ? 'sent' : 'failed',
      provider: mailer.provider ?? 'none',
      providerMessageId: result.ok ? result.id : null,
      error: result.ok ? null : result.error,
      createdAt: new Date().toISOString(),
    };
    const data = crm.repo.data();
    data.reportEmails ??= [];
    data.reportEmails.push(entry);
    if (data.reportEmails.length > 5000)
      data.reportEmails.splice(0, data.reportEmails.length - 5000);
    crm.repo.commit();
    log('report.email', {
      status: entry.status,
      reportType: entry.reportType,
      provider: entry.provider,
      error: entry.error,
      bytes: bytes.length,
    });
    if (!result.ok) {
      return {
        status: 502,
        json: {
          success: false,
          code: 'email_failed',
          message:
            result.error === 'http_401' || result.error === 'http_403'
              ? 'E-mail nije poslan: e-mail servis je odbio pristup (provjerite API ključ na serveru).'
              : result.error === 'http_422' || result.error === 'http_400'
                ? 'E-mail nije poslan: e-mail servis je odbio poruku (provjerite adresu primatelja i adresu pošiljatelja na serveru).'
                : result.error === 'http_429'
                  ? 'E-mail nije poslan: dosegnuto je ograničenje e-mail servisa. Pokušajte kasnije.'
                  : 'E-mail nije poslan: e-mail servis trenutno nije dostupan. Pokušajte ponovno.',
          entry: emailView(entry),
        },
      };
    }
    return ok({ entry: emailView(entry) }, 201);
  }

  const emailView = (e: ReportEmail) => ({
    id: e.id,
    recipient: e.recipient,
    reportType: e.reportType,
    reportTitle: REPORT_TYPES.find((t) => t.value === e.reportType)?.label ?? e.reportType,
    periodFrom: e.periodFrom,
    periodTo: e.periodTo,
    attachmentName: e.attachmentName,
    status: e.status,
    sentByName: e.sentByName,
    createdAt: e.createdAt,
  });

  async function emails(ctx: CrmContext): Promise<ReportResponse> {
    if (!can(ctx, 'reports.view') || !can(ctx, 'reports.email')) return forbidden();
    const everyone = ctx.access?.role === 'owner' || ctx.access?.role === 'admin';
    const list = inOrg(crm.repo.data().reportEmails ?? [], ctx)
      .filter((e) => everyone || e.sentBy === ctx.user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map(emailView);
    return ok({ emails: list });
  }

  const ROUTES: Array<{ method: 'GET' | 'POST'; path: string }> = [
    { method: 'GET', path: '/api/reports/options' },
    { method: 'POST', path: '/api/reports/generate' },
    { method: 'POST', path: '/api/reports/pdf' },
    { method: 'POST', path: '/api/reports/email' },
    { method: 'GET', path: '/api/reports/emails' },
  ];

  return {
    /** 'none': not a reports address · 'method': its address, another method · 'ok'. */
    match(method: string, path: string): 'none' | 'method' | 'ok' {
      const route = ROUTES.find((r) => r.path === path);
      if (!route) return 'none';
      return route.method === method ? 'ok' : 'method';
    },
    allowed(path: string) {
      return ROUTES.find((r) => r.path === path)?.method ?? 'GET';
    },
    async run(
      method: string,
      path: string,
      ctx: CrmContext,
      body: Record<string, unknown>,
      query: URLSearchParams,
    ): Promise<ReportResponse> {
      if (method === 'GET' && path === '/api/reports/options') return options_(ctx);
      if (method === 'POST' && path === '/api/reports/generate') return generate(ctx, body);
      if (method === 'POST' && path === '/api/reports/pdf') {
        return pdf(ctx, body, query.get('download') !== '1');
      }
      if (method === 'POST' && path === '/api/reports/email') return email(ctx, body);
      if (method === 'GET' && path === '/api/reports/emails') return emails(ctx);
      return { status: 404, json: { success: false, message: 'Nije pronađeno.' } };
    },
  };
}

export type ReportApi = ReturnType<typeof createReportApi>;
