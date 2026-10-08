// OpportunityService: an opportunity belongs to an existing customer; its
// optional contact must belong to the same customer. The next action is
// derived from tasks (ADR-0004), never stored on the opportunity.
import { labelOf, PIPELINE_BASELINE, STAGES } from '../../public/app/js/core/constants.js';
import { hasErrors, MESSAGES, validateOpportunity } from '../../public/app/js/core/validation.js';
import { CrmValidationError, type FieldErrors } from './errors.ts';
import type { CrmRepository } from './repository.ts';
import {
  addActivity,
  contactName,
  findInOrg,
  inOrg,
  newId,
  opt,
  requireInOrg,
  str,
  type Body,
} from './scope.ts';
import type { TaskService, TaskView } from './task-service.ts';
import type { CrmContext, CrmData, Opportunity } from './types.ts';

export interface OpportunityView extends Opportunity {
  customerName: string;
  contactName: string | null;
  nextAction: TaskView | null;
  /** Active and without an open task: breaks "no opportunity without a next action". */
  needsNextAction: boolean;
}

const money = (value: number | null, currency: string) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('hr-HR', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(value);

export function createOpportunityService(
  repo: CrmRepository,
  tasks: TaskService,
  { demoContent = true } = {},
) {
  function view(data: CrmData, ctx: CrmContext, o: Opportunity): OpportunityView {
    const contact = findInOrg(data.contacts, ctx, o.contactId);
    const nextAction = tasks.nextActionFor(ctx, o.id);
    return {
      ...o,
      customerName: findInOrg(data.customers, ctx, o.companyId)?.companyName ?? '',
      contactName: contact ? contactName(contact) : null,
      nextAction,
      needsNextAction: o.status === 'active' && nextAction === null,
    };
  }

  return {
    view: (ctx: CrmContext, o: Opportunity) => view(repo.data(), ctx, o),

    listOpportunities(
      ctx: CrmContext,
      filter: { companyId?: string | null; status?: string | null } = {},
    ): OpportunityView[] {
      const data = repo.data();
      return inOrg(data.opportunities, ctx)
        .filter(
          (o) =>
            (!filter.companyId || o.companyId === filter.companyId) &&
            (!filter.status || o.status === filter.status),
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
      const customer = findInOrg(data.customers, ctx, input.companyId);
      if (!customer) {
        throw new CrmValidationError({ companyId: MESSAGES.unavailable }, MESSAGES.unavailable);
      }
      const contactId = opt(input.contactId);
      if (contactId) {
        const contact = findInOrg(data.contacts, ctx, contactId);
        if (!contact) {
          throw new CrmValidationError({ contactId: MESSAGES.unavailable }, MESSAGES.unavailable);
        }
        if (contact.companyId !== customer.id) {
          throw new CrmValidationError({ contactId: MESSAGES.contactNotOfCustomer });
        }
      }

      const now = ctx.now.toISOString();
      const rawValue = str(String(input.value ?? '')).replace(',', '.');
      const status = (opt(input.status) ?? 'active') as Opportunity['status'];
      const opportunity: Opportunity = {
        id: newId(),
        organizationId: ctx.organizationId,
        companyId: customer.id,
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
      customer.updatedAt = now;
      addActivity(
        data,
        ctx,
        customer.id,
        'opportunity_created',
        `${opportunity.title} · ${money(opportunity.value, opportunity.currency)} · ${labelOf(STAGES, opportunity.stage)}`,
        opportunity.id,
      );

      if (opt(input.nextActionTitle)) {
        tasks.createIn(
          data,
          ctx,
          {
            title: input.nextActionTitle,
            type: 'follow_up',
            priority: 'normal',
            opportunityId: opportunity.id,
            companyId: customer.id,
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

    /** Dashboard pipeline: active opportunities created in the CRM, plus the demo's static totals. */
    pipeline(ctx: CrmContext) {
      const created = inOrg(repo.data().opportunities, ctx).filter(
        (o) => o.status === 'active' && !o.seeded,
      );
      return STAGES.map((stage) => {
        const count = created.filter((o) => o.stage === stage.value).length;
        const baseline = demoContent
          ? ((PIPELINE_BASELINE as Record<string, number>)[stage.value] ?? 0)
          : 0;
        return { value: stage.value, label: stage.label, created: count, total: baseline + count };
      });
    },
  };
}

export type OpportunityService = ReturnType<typeof createOpportunityService>;
