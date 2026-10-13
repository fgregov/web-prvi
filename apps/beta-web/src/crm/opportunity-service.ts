// OpportunityService: an opportunity belongs to a lead or to a customer, or to
// both once the lead is converted (ADR-0009); its optional contact belongs to
// its customer. Winning a lead's deal makes the lead WON; customer conversion
// is a separate, later step (LeadService). The next action is derived from
// tasks (ADR-0004), never stored on the opportunity.
import { labelOf, PIPELINE_BASELINE, STAGES } from '../../public/app/js/core/constants.js';
import {
  quarterOf,
  quarterPeriod,
  samePeriod,
  validateRange,
} from '../../public/app/js/core/period.js';
import {
  hasErrors,
  MESSAGES,
  validateOpportunity,
  validateOpportunityClose,
} from '../../public/app/js/core/validation.js';
import { CrmValidationError, type FieldErrors } from './errors.ts';
import { hasDocument, offerView } from './offer-service.ts';
import { cancelReminders, reminderView, shownReminder, type ReminderView } from './reminders.ts';
import type { CrmRepository } from './repository.ts';
import {
  addLeadActivity,
  addRecordActivity,
  contactName,
  findInOrg,
  inOrg,
  leadLabel,
  newId,
  opt,
  requireInOrg,
  str,
  type Body,
} from './scope.ts';
import type { TaskService, TaskView } from './task-service.ts';
import { addDays, calendarDateInZone, startOfDayInZone } from './time.ts';
import type { CrmContext, CrmData, Lead, Opportunity } from './types.ts';

export interface OpportunityView extends Opportunity {
  customerName: string;
  /** The lead the deal belongs to (ADR-0009). */
  leadName: string | null;
  leadStatus: Lead['status'] | null;
  /** The customer the lead was converted into; null while conversion is pending. */
  leadCustomerId: string | null;
  leadCustomerName: string | null;
  contactName: string | null;
  nextAction: TaskView | null;
  /** Active and without an open task: breaks "no opportunity without a next action". */
  needsNextAction: boolean;
  /** Offers sent in this deal, newest first, with their current wait. */
  offers: Array<ReturnType<typeof offerView>>;
  /** The viewing user's push reminder that has not fired yet. */
  reminder: ReminderView | null;
}

const amount = (value: unknown): number | null => {
  const raw = str(String(value ?? '')).replace(',', '.');
  return raw === '' ? null : Math.round(Number(raw) * 100) / 100;
};

const money = (value: number | null, currency: string) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('hr-HR', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(value);

/** A reporting period asked for by the client: calendar dates, both or neither. */
export interface CreatedPeriod {
  from?: unknown;
  to?: unknown;
}

/**
 * The period as instants in the organization's timezone ([from, to)), or null
 * when none is asked for. Validated like the dashboard period, so an invalid
 * range is refused before any record is read.
 */
function createdBounds(ctx: CrmContext, period: CreatedPeriod) {
  const none = (v: unknown) => v === undefined || v === null || v === '';
  if (none(period.from) && none(period.to)) return null;
  const startDate = String(period.from ?? '');
  const endDate = String(period.to ?? '');
  const problem = validateRange(startDate, endDate);
  if (problem) throw new CrmValidationError({ range: problem }, problem);
  const today = quarterOf(calendarDateInZone(ctx.now, ctx.timeZone));
  return {
    from: startOfDayInZone(startDate, ctx.timeZone).getTime(),
    to: startOfDayInZone(addDays(endDate, 1), ctx.timeZone).getTime(),
    isCurrentQuarter: samePeriod(quarterPeriod(today.year, today.quarter), {
      type: 'QUARTER',
      startDate,
      endDate,
    }),
  };
}

/** Created inside the bounds (or no bounds asked for). */
const createdIn = (bounds: ReturnType<typeof createdBounds>, o: Opportunity) => {
  if (!bounds) return true;
  const at = Date.parse(o.createdAt);
  return at >= bounds.from && at < bounds.to;
};

/**
 * Timeline entry of a deal: on its customer and, for a lead's deal, also on
 * the lead (one entry, both links), so each sees its own history.
 */
export function addDealActivity(
  data: CrmData,
  ctx: CrmContext,
  o: Opportunity,
  type: string,
  description: string,
) {
  return addRecordActivity(
    data,
    ctx,
    { companyId: o.companyId, leadId: o.leadId },
    type,
    description,
    o.id,
  );
}

/**
 * A lead's deal was won: the lead is WON (once; a later win keeps the first
 * date). No customer is created — conversion is offered separately.
 */
export function markLeadWon(data: CrmData, ctx: CrmContext, o: Opportunity) {
  const lead = findInOrg(data.leads, ctx, o.leadId);
  if (!lead || lead.status !== 'active') return;
  const now = ctx.now.toISOString();
  Object.assign(lead, {
    status: 'won',
    wonAt: o.closedAt ?? now,
    wonBasis: 'opportunity',
    stage: 'qualified', // a won lead was qualified, at the latest now
    qualifiedAt: lead.qualifiedAt ?? now,
    updatedAt: now,
  });
  addLeadActivity(data, ctx, lead.id, 'lead_won', `Osvojena prilika: ${o.title}`, null);
}

/**
 * Gives a lead's deal its customer (the lead's conversion): the deal keeps its
 * id, dates, lead and history; its offers and its tasks without a customer
 * get the customer too.
 */
export function linkDealToCustomer(
  data: CrmData,
  ctx: CrmContext,
  o: Opportunity,
  customerId: string,
  now: string,
) {
  o.companyId = customerId;
  o.updatedAt = now;
  for (const offer of inOrg(data.offers ?? [], ctx)) {
    if (offer.opportunityId === o.id && !offer.companyId) {
      offer.companyId = customerId;
      offer.updatedAt = now;
    }
  }
  for (const task of inOrg(data.tasks, ctx)) {
    if (task.opportunityId === o.id && !task.companyId) task.companyId = customerId;
  }
}

export function createOpportunityService(
  repo: CrmRepository,
  tasks: TaskService,
  { demoContent = true } = {},
) {
  function view(data: CrmData, ctx: CrmContext, o: Opportunity): OpportunityView {
    const contact = findInOrg(data.contacts, ctx, o.contactId);
    const nextAction = tasks.nextActionFor(ctx, o.id);
    const reminder = shownReminder(data, ctx, 'opportunityId', o.id);
    const lead = findInOrg(data.leads, ctx, o.leadId);
    const leadCustomer = findInOrg(data.customers, ctx, lead?.convertedCustomerId);
    return {
      ...o,
      leadId: o.leadId ?? null,
      customerName: findInOrg(data.customers, ctx, o.companyId)?.companyName ?? '',
      leadName: lead ? leadLabel(lead) : null,
      leadStatus: lead?.status ?? null,
      leadCustomerId: leadCustomer?.id ?? null,
      leadCustomerName: leadCustomer?.companyName ?? null,
      contactName: contact ? contactName(contact) : null,
      nextAction,
      needsNextAction: o.status === 'active' && nextAction === null,
      offers: inOrg(data.offers ?? [], ctx)
        .filter((offer) => offer.opportunityId === o.id)
        .sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt))
        .map((offer) => offerView(offer, ctx, o, hasDocument(data, ctx, offer.id))),
      reminder: reminder ? reminderView(reminder) : null,
    };
  }

  return {
    view: (ctx: CrmContext, o: Opportunity) => view(repo.data(), ctx, o),

    /** `from`/`to` (both or neither): only opportunities created in that period. */
    listOpportunities(
      ctx: CrmContext,
      filter: {
        companyId?: string | null;
        leadId?: string | null;
        status?: string | null;
      } & CreatedPeriod = {},
    ): OpportunityView[] {
      const bounds = createdBounds(ctx, filter);
      const data = repo.data();
      return inOrg(data.opportunities, ctx)
        .filter(
          (o) =>
            (!filter.companyId || o.companyId === filter.companyId) &&
            (!filter.leadId || o.leadId === filter.leadId) &&
            (!filter.status || o.status === filter.status) &&
            createdIn(bounds, o),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((o) => view(data, ctx, o));
    },

    getOpportunity(ctx: CrmContext, id: string): OpportunityView {
      const data = repo.data();
      return view(data, ctx, requireInOrg(data.opportunities, ctx, id));
    },

    /**
     * Creates the opportunity and, when `nextActionTitle` is given, its first open
     * task in the same write. `nextActionMissing` tells the client to prompt for one.
     */
    createOpportunity(ctx: CrmContext, input: Body) {
      const errors: FieldErrors = validateOpportunity(input);
      if (hasErrors(errors)) throw new CrmValidationError(errors);
      const data = repo.data();
      // Path A: from a lead (no customer needed) · Path B: from a customer.
      const leadId = opt(input.leadId);
      const lead = leadId ? findInOrg(data.leads, ctx, leadId) : undefined;
      if (leadId && !lead) {
        throw new CrmValidationError({ leadId: MESSAGES.unavailable }, MESSAGES.unavailable);
      }
      if (lead?.status === 'lost') {
        throw new CrmValidationError(
          { leadId: MESSAGES.leadLostNoOpportunity },
          MESSAGES.leadLostNoOpportunity,
        );
      }
      const companyId = opt(input.companyId);
      const customer = companyId ? findInOrg(data.customers, ctx, companyId) : undefined;
      if (companyId && !customer) {
        throw new CrmValidationError({ companyId: MESSAGES.unavailable }, MESSAGES.unavailable);
      }
      // Both only for a converted lead and the customer it became.
      if (lead && customer && lead.convertedCustomerId !== customer.id) {
        throw new CrmValidationError(
          { companyId: MESSAGES.leadCustomerMismatch },
          MESSAGES.leadCustomerMismatch,
        );
      }
      const contactId = opt(input.contactId);
      if (contactId) {
        const contact = findInOrg(data.contacts, ctx, contactId);
        if (!contact) {
          throw new CrmValidationError({ contactId: MESSAGES.unavailable }, MESSAGES.unavailable);
        }
        if (!customer || contact.companyId !== customer.id) {
          throw new CrmValidationError({ contactId: MESSAGES.contactNotOfCustomer });
        }
      }

      const now = ctx.now.toISOString();
      const rawValue = str(String(input.value ?? '')).replace(',', '.');
      const status = (opt(input.status) ?? 'active') as Opportunity['status'];
      const opportunity: Opportunity = {
        id: newId(),
        organizationId: ctx.organizationId,
        companyId: customer?.id ?? null,
        leadId: lead?.id ?? null,
        contactId,
        title: str(input.title),
        value: rawValue === '' ? null : Number(rawValue),
        currency: opt(input.currency) ?? 'EUR',
        stage: opt(input.stage) ?? 'new',
        status,
        expectedCloseDate: opt(input.expectedCloseDate),
        ownerId: ctx.user.id,
        ownerName: ctx.user.displayName,
        notes: str(input.notes),
        closedAt: status === 'active' ? null : now,
        createdAt: now,
        updatedAt: now,
      };
      data.opportunities.push(opportunity);
      if (customer) customer.updatedAt = now;
      if (lead) lead.updatedAt = now;
      addDealActivity(
        data,
        ctx,
        opportunity,
        'opportunity_created',
        `${opportunity.title} · ${money(opportunity.value, opportunity.currency)} · ${labelOf(STAGES, opportunity.stage)}`,
      );
      // Created as won right away (a deal recorded after the fact) also wins its lead.
      if (opportunity.status === 'won' && lead) markLeadWon(data, ctx, opportunity);

      if (opt(input.nextActionTitle)) {
        tasks.createIn(
          data,
          ctx,
          {
            title: input.nextActionTitle,
            type: 'follow_up',
            priority: 'normal',
            opportunityId: opportunity.id,
            companyId: customer?.id ?? null,
            leadId: lead?.id ?? null,
            contactId,
            dueDate: opt(input.nextActionDueDate),
          },
          'user',
        );
      }
      repo.commit();
      const result = view(data, ctx, opportunity);
      return { opportunity: result, nextActionMissing: result.needsNextAction };
    },

    /**
     * Closes a deal: WON (optionally with the final amount, when it differs
     * from the estimate) or LOST (optionally with a reason). The day it is
     * closed is the day it counts as won or lost. Its pending reminders end.
     */
    closeOpportunity(ctx: CrmContext, id: string, input: Body): OpportunityView {
      const errors = validateOpportunityClose(input);
      if (hasErrors(errors)) throw new CrmValidationError(errors);
      const data = repo.data();
      const opportunity = requireInOrg(data.opportunities, ctx, id);
      if (opportunity.status !== 'active') {
        throw new CrmValidationError(
          { status: MESSAGES.opportunityClosed },
          MESSAGES.opportunityClosed,
        );
      }
      const now = ctx.now.toISOString();
      const won = input.outcome === 'won';
      const final = won ? amount(input.wonValue) : null;
      Object.assign(opportunity, {
        status: won ? 'won' : 'lost',
        closedAt: now,
        wonValue: won && final !== null && final !== opportunity.value ? final : null,
        lostReason: won ? '' : str(input.lostReason),
        updatedAt: now,
      });
      cancelReminders(data, ctx, 'opportunityId', opportunity.id);
      const shown = won ? (opportunity.wonValue ?? opportunity.value) : opportunity.value;
      addDealActivity(
        data,
        ctx,
        opportunity,
        won ? 'opportunity_won' : 'opportunity_lost',
        [
          opportunity.title,
          money(shown, opportunity.currency),
          won ? null : str(input.lostReason) || null,
        ]
          .filter(Boolean)
          .join(' · '),
      );
      // A won deal makes its lead WON; a lost one never changes the lead.
      if (won) markLeadWon(data, ctx, opportunity);
      repo.commit();
      return view(data, ctx, opportunity);
    },

    /**
     * A lead's deal (without a customer) of a lead that is already a customer:
     * links it to that customer — the lead's confirmed conversion, never any
     * other. Its offers and tasks follow. Explicit, never automatic.
     */
    linkToLeadCustomer(ctx: CrmContext, id: string): OpportunityView {
      const data = repo.data();
      const opportunity = requireInOrg(data.opportunities, ctx, id);
      const lead = findInOrg(data.leads, ctx, opportunity.leadId);
      const customer = findInOrg(data.customers, ctx, lead?.convertedCustomerId);
      if (!lead || !customer) {
        throw new CrmValidationError(
          { leadId: MESSAGES.leadNotConverted },
          MESSAGES.leadNotConverted,
        );
      }
      if (opportunity.companyId === customer.id) return view(data, ctx, opportunity); // repeated tap
      if (opportunity.companyId) {
        throw new CrmValidationError(
          { companyId: MESSAGES.leadCustomerMismatch },
          MESSAGES.leadCustomerMismatch,
        );
      }
      const now = ctx.now.toISOString();
      linkDealToCustomer(data, ctx, opportunity, customer.id, now);
      addDealActivity(
        data,
        ctx,
        opportunity,
        'opportunity_customer_linked',
        `${opportunity.title} → ${customer.companyName}`,
      );
      repo.commit();
      return view(data, ctx, opportunity);
    },

    /**
     * Opportunity Pipeline totals per stage: active opportunities (created in
     * the period, when one is given) in their current stage. The demo's static
     * totals belong to the current view only (no period, or the current
     * quarter); they already include the seeded opportunities.
     */
    pipeline(ctx: CrmContext, period: CreatedPeriod = {}) {
      const bounds = createdBounds(ctx, period);
      const withBaseline = demoContent && (!bounds || bounds.isCurrentQuarter);
      const active = inOrg(repo.data().opportunities, ctx).filter(
        (o) => o.status === 'active' && createdIn(bounds, o) && (!o.seeded || !withBaseline),
      );
      return STAGES.map((stage) => {
        const count = active.filter((o) => o.stage === stage.value).length;
        const baseline = withBaseline
          ? ((PIPELINE_BASELINE as Record<string, number>)[stage.value] ?? 0)
          : 0;
        return { value: stage.value, label: stage.label, created: count, total: baseline + count };
      });
    },
  };
}

export type OpportunityService = ReturnType<typeof createOpportunityService>;
