// LeadService: leads are their own records, separate from customers. A lead
// is never deleted: converting it (WON) or closing it (LOST) only changes its
// status, stamps the date of that outcome and, for WON, records what it became.
//
// Conversion reuses the customer, contact and opportunity services and runs as
// one transaction: either the customer (+ contact, + opportunity) exist AND the
// lead is WON, or nothing changed.
import type { LeadLostReason, LeadSource, LeadStage } from '@renvara/domain';
import { labelOf, LEAD_LOST_REASONS, LEAD_STAGES } from '../../public/app/js/core/constants.js';
import {
  hasErrors,
  MESSAGES,
  validateLead,
  validateLeadConversion,
  validateLeadLost,
} from '../../public/app/js/core/validation.js';
import type { ContactService } from './contact-service.ts';
import type { CustomerService } from './customer-service.ts';
import { CrmConflictError, CrmValidationError } from './errors.ts';
import type { OpportunityService } from './opportunity-service.ts';
import type { CrmRepository } from './repository.ts';
import {
  addLeadActivity,
  contactName,
  findInOrg,
  fold,
  inOrg,
  newId,
  opt,
  requireInOrg,
  str,
  type Body,
} from './scope.ts';
import type { TaskService } from './task-service.ts';
import type { CrmContext, CrmData, Customer, Lead } from './types.ts';

/** Mail providers whose domain says nothing about the company. */
const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  't-com.hr',
  'net.hr',
  'inet.hr',
]);
const LEGAL_FORMS =
  /\b(d\.?\s?o\.?\s?o\.?|j\.?\s?d\.?\s?o\.?\s?o\.?|d\.?\s?d\.?|obrt|gmbh|ltd|llc|s\.?r\.?l\.?)\b/g;

/** "ABC d.o.o." and "abc" compare equal. */
const companyKey = (name: string) =>
  fold(name)
    .replace(LEGAL_FORMS, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const domainOf = (email: string) => {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  return domain && !FREE_MAIL.has(domain) ? domain : '';
};

export interface CustomerMatch {
  id: string;
  companyName: string;
  oib: string;
  city: string;
  reasons: Array<'oib' | 'name' | 'email_domain'>;
}

const amount = (value: unknown) => {
  const raw = str(String(value ?? '')).replace(',', '.');
  return raw === '' ? null : Math.round(Number(raw) * 100) / 100;
};

export function createLeadService(
  repo: CrmRepository,
  deps: {
    customers: CustomerService;
    contacts: ContactService;
    opportunities: OpportunityService;
    tasks: TaskService;
  },
) {
  function requireActive(lead: Lead) {
    if (lead.status !== 'active') {
      throw new CrmValidationError({ status: MESSAGES.leadClosed }, MESSAGES.leadClosed);
    }
  }

  /** Editable fields from a request body; status is never taken from the client. */
  function fields(input: Body) {
    const estimatedValue = amount(input.estimatedValue);
    return {
      name: str(input.name),
      companyName: str(input.companyName),
      email: str(input.email),
      phone: str(input.phone),
      jobTitle: str(input.jobTitle),
      source: (opt(input.source) ?? null) as LeadSource | null,
      notes: str(input.notes),
      estimatedValue,
      currency: estimatedValue === null ? null : (opt(input.currency) ?? 'EUR'),
    };
  }

  function setStage(ctx: CrmContext, lead: Lead, stage: LeadStage) {
    if (lead.stage === stage) return;
    lead.stage = stage;
    if (stage === 'qualified' && !lead.qualifiedAt) lead.qualifiedAt = ctx.now.toISOString();
  }

  /** Existing customers this lead (or a customer about to be created) may already be. */
  function findMatches(
    data: CrmData,
    ctx: CrmContext,
    probe: { names: string[]; oib?: string; email?: string },
  ): CustomerMatch[] {
    const keys = probe.names.map(companyKey).filter((k) => k.length >= 3);
    const domain = domainOf(probe.email ?? '');
    const contacts = inOrg(data.contacts, ctx);
    const matches: CustomerMatch[] = [];
    for (const c of inOrg(data.customers, ctx)) {
      const reasons: CustomerMatch['reasons'] = [];
      if (probe.oib && c.oib && probe.oib === c.oib) reasons.push('oib');
      const key = companyKey(c.companyName);
      if (
        key &&
        keys.some(
          (k) =>
            k === key || (k.length >= 4 && key.includes(k)) || (key.length >= 4 && k.includes(key)),
        )
      )
        reasons.push('name');
      if (
        domain &&
        (domainOf(c.email) === domain ||
          contacts.some((p) => p.companyId === c.id && domainOf(p.email) === domain))
      )
        reasons.push('email_domain');
      if (reasons.length) {
        matches.push({ id: c.id, companyName: c.companyName, oib: c.oib, city: c.city, reasons });
      }
    }
    return matches;
  }

  function view(data: CrmData, ctx: CrmContext, lead: Lead) {
    const customer = findInOrg(data.customers, ctx, lead.convertedCustomerId);
    const contact = findInOrg(data.contacts, ctx, lead.convertedContactId);
    const opportunity = findInOrg(data.opportunities, ctx, lead.convertedOpportunityId);
    return {
      ...lead,
      convertedCustomerName: customer?.companyName ?? null,
      convertedContactName: contact ? contactName(contact) : null,
      convertedOpportunityTitle: opportunity?.title ?? null,
    };
  }

  return {
    createLead(ctx: CrmContext, input: Body) {
      const errors = validateLead(input);
      if (hasErrors(errors)) {
        const onlyName = Object.keys(errors).length === 1 && errors.name;
        throw new CrmValidationError(errors, onlyName ? MESSAGES.leadNameRequired : undefined);
      }
      const data = repo.data();
      const now = ctx.now.toISOString();
      const lead: Lead = {
        id: newId(),
        organizationId: ctx.organizationId,
        ownerId: ctx.user.id,
        ownerName: ctx.user.displayName,
        ...fields(input),
        stage: 'new',
        status: 'active',
        qualifiedAt: null,
        convertedAt: null,
        lostAt: null,
        lostReason: null,
        lostNote: '',
        convertedCustomerId: null,
        convertedContactId: null,
        convertedOpportunityId: null,
        createdAt: now,
        updatedAt: now,
      };
      setStage(ctx, lead, (opt(input.stage) ?? 'new') as LeadStage);
      data.leads.push(lead);
      addLeadActivity(
        data,
        ctx,
        lead.id,
        'lead_created',
        [lead.name, lead.companyName].filter(Boolean).join(' · '),
      );
      repo.commit();
      return view(data, ctx, lead);
    },

    listLeads(ctx: CrmContext, filter: { status?: string | null; q?: string | null } = {}) {
      const data = repo.data();
      const q = fold(str(filter.q));
      return inOrg(data.leads, ctx)
        .filter((l) => !filter.status || l.status === filter.status)
        .filter((l) => !q || fold(`${l.name} ${l.companyName}`).includes(q))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((l) => view(data, ctx, l));
    },

    /** The lead with what it became, its tasks and its timeline. */
    getLead(ctx: CrmContext, id: string) {
      const data = repo.data();
      const lead = requireInOrg(data.leads, ctx, id);
      return {
        ...view(data, ctx, lead),
        tasks: deps.tasks.listTasks(ctx, { leadId: id }).filter((t) => t.status !== 'cancelled'),
        activities: inOrg(data.activities, ctx)
          .filter((a) => a.leadId === id)
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.seq - a.seq),
      };
    },

    /** Edit an active lead (fields and/or stage). Closed leads are history. */
    updateLead(ctx: CrmContext, id: string, input: Body) {
      const data = repo.data();
      const lead = requireInOrg(data.leads, ctx, id);
      requireActive(lead);
      const merged = { ...lead, ...input };
      const errors = validateLead(merged);
      if (hasErrors(errors)) throw new CrmValidationError(errors);
      const before = lead.stage;
      Object.assign(lead, fields(merged), { updatedAt: ctx.now.toISOString() });
      setStage(ctx, lead, (opt(merged.stage) ?? lead.stage) as LeadStage);
      if (lead.stage !== before) {
        addLeadActivity(
          data,
          ctx,
          lead.id,
          'lead_stage_changed',
          `${labelOf(LEAD_STAGES, before)} → ${labelOf(LEAD_STAGES, lead.stage)}`,
        );
      }
      repo.commit();
      return view(data, ctx, lead);
    },

    /** Close as LOST with an optional reason. The lead stays for reporting. */
    markLeadLost(ctx: CrmContext, id: string, input: Body) {
      const errors = validateLeadLost(input);
      if (hasErrors(errors)) throw new CrmValidationError(errors);
      const data = repo.data();
      const lead = requireInOrg(data.leads, ctx, id);
      requireActive(lead);
      const now = ctx.now.toISOString();
      Object.assign(lead, {
        status: 'lost',
        lostAt: now,
        lostReason: (opt(input.reason) ?? null) as LeadLostReason | null,
        lostNote: str(input.note),
        updatedAt: now,
      });
      addLeadActivity(
        data,
        ctx,
        lead.id,
        'lead_lost',
        lead.lostReason ? labelOf(LEAD_LOST_REASONS, lead.lostReason) : 'Bez navedenog razloga',
      );
      repo.commit();
      return view(data, ctx, lead);
    },

    /** Existing customers this lead may already be (shown before converting). */
    customerMatches(ctx: CrmContext, id: string): CustomerMatch[] {
      const data = repo.data();
      const lead = requireInOrg(data.leads, ctx, id);
      return findMatches(data, ctx, {
        names: [lead.companyName, lead.companyName ? '' : lead.name],
        email: lead.email,
      });
    },

    /**
     * Convert into a NEW or an EXISTING customer, optionally with a contact and
     * an opportunity. Atomic. A new customer that looks like an existing one is
     * refused (409, with the matches) unless `ignoreMatches` confirms it.
     */
    convertLead(ctx: CrmContext, id: string, input: Body) {
      const data = repo.data();
      const lead = requireInOrg(data.leads, ctx, id);
      requireActive(lead);
      const errors = validateLeadConversion(input, { existing: inOrg(data.customers, ctx) });
      if (hasErrors(errors)) {
        const unavailable = errors.customerId === MESSAGES.unavailable;
        throw new CrmValidationError(errors, unavailable ? MESSAGES.unavailable : undefined);
      }
      const customerInput = (input.customer ?? {}) as Body;
      const contactInput = input.createContact === true ? ((input.contact ?? {}) as Body) : null;
      const opportunityInput =
        input.createOpportunity === true ? ((input.opportunity ?? {}) as Body) : null;

      let existing: Customer | undefined;
      if (input.conversionMode === 'EXISTING_CUSTOMER') {
        existing = findInOrg(data.customers, ctx, input.customerId);
        if (!existing) {
          throw new CrmValidationError({ customerId: MESSAGES.unavailable }, MESSAGES.unavailable);
        }
      } else if (input.ignoreMatches !== true) {
        const matches = findMatches(data, ctx, {
          names: [str(customerInput.companyName)],
          oib: str(customerInput.oib),
          email: lead.email,
        });
        if (matches.length)
          throw new CrmConflictError(MESSAGES.possibleExistingCustomer, { matches });
      }

      const result = repo.transaction(() => {
        let customerId: string;
        let contactId: string | null = null;
        if (existing) {
          customerId = existing.id;
          if (contactInput) {
            contactId = deps.contacts.createContact(ctx, {
              companyId: customerId,
              fullName: contactInput.fullName,
              role: contactInput.role,
              email: contactInput.email,
              phone: contactInput.phone,
              notes: `Iz leada: ${lead.name}`,
            }).id;
          }
        } else {
          const customer = deps.customers.createCustomer(
            ctx,
            {
              ...customerInput,
              notes: str(customerInput.notes) || lead.notes,
              contactName: contactInput?.fullName ?? '',
              contactRole: contactInput?.role ?? '',
              contactEmail: contactInput?.email ?? '',
              contactPhone: contactInput?.phone ?? '',
            },
            { withContact: Boolean(contactInput) },
          );
          customerId = customer.id;
          contactId = customer.primaryContactId;
        }

        let opportunityId: string | null = null;
        if (opportunityInput) {
          opportunityId = deps.opportunities.createOpportunity(ctx, {
            companyId: customerId,
            contactId,
            title: opportunityInput.title,
            value: opportunityInput.value,
            currency: opportunityInput.currency ?? lead.currency ?? 'EUR',
            stage: opportunityInput.stage,
            notes: `Iz leada: ${lead.name}`,
          }).opportunity.id;
        }

        const now = ctx.now.toISOString();
        setStage(ctx, lead, 'qualified'); // a converted lead was qualified, at the latest now
        Object.assign(lead, {
          status: 'won',
          convertedAt: now,
          convertedCustomerId: customerId,
          convertedContactId: contactId,
          convertedOpportunityId: opportunityId,
          updatedAt: now,
        });
        // The lead's own tasks without a customer now belong to it too (nothing is moved or lost).
        for (const task of inOrg(data.tasks, ctx)) {
          if (task.leadId === lead.id && !task.companyId) task.companyId = customerId;
        }
        const customerName = findInOrg(data.customers, ctx, customerId)?.companyName ?? '';
        addLeadActivity(
          data,
          ctx,
          lead.id,
          'lead_converted',
          `${lead.name} → ${customerName}`,
          customerId,
        );
        return { customerId, contactId, opportunityId };
      }); // saved by the transaction
      return { lead: view(data, ctx, lead), ...result };
    },
  };
}

export type LeadService = ReturnType<typeof createLeadService>;
