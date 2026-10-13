// LeadService: leads are their own records (not customers), scoped to one
// organization, never deleted. Lead-first (ADR-0009): a lead has deals without
// being a customer; a won deal makes it WON; conversion into a customer comes
// after, atomic and idempotent; LOST is an explicit close. Period reporting
// counts each outcome by its own date.
import { leadOutcomeMetrics } from '@renvara/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../public/app/js/core/validation.js';
import { taskInputFromForm } from '../public/app/js/features/tasks/task-input.js';
import { CrmConflictError, CrmNotFoundError, CrmValidationError } from '../src/crm/errors.ts';
import { createCrmServices, type CrmServices } from '../src/crm/index.ts';
import { createMemoryRepository, emptyData } from '../src/crm/repository.ts';
import type { CrmContext } from '../src/crm/types.ts';

const ctxA: CrmContext = {
  organizationId: 'org-a',
  user: { id: 'user-a', displayName: 'Ana A.' },
  timeZone: 'Europe/Zagreb',
  now: new Date('2026-10-05T09:00:00Z'),
};
const ctxB: CrmContext = {
  ...ctxA,
  organizationId: 'org-b',
  user: { id: 'user-b', displayName: 'B' },
};

let crm: CrmServices;
beforeEach(() => {
  crm = createCrmServices(createMemoryRepository(emptyData()));
});

function rejects(fn: () => unknown, errors: Record<string, string>, message?: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CrmValidationError);
    expect((error as CrmValidationError).errors).toMatchObject(errors);
    if (message) expect((error as CrmValidationError).message).toBe(message);
    return;
  }
  throw new Error('expected a validation error');
}

const marko = () =>
  crm.leads.createLead(ctxA, {
    name: 'Marko Horvat',
    companyName: 'ABC d.o.o.',
    phone: '091 234 5678',
    source: 'referral',
  });

describe('LeadService · create', () => {
  it('needs only a name and defaults to NEW / ACTIVE, owned by the current user', () => {
    const lead = crm.leads.createLead(ctxA, { name: '  Ivan Horvat ' });
    expect(lead).toMatchObject({
      organizationId: 'org-a',
      ownerId: 'user-a',
      ownerName: 'Ana A.',
      name: 'Ivan Horvat',
      companyName: '',
      source: null,
      stage: 'new',
      status: 'active',
      estimatedValue: null,
      currency: null,
      qualifiedAt: null,
      convertedAt: null,
      lostAt: null,
      createdAt: ctxA.now.toISOString(),
    });
    // A lead is not a customer.
    expect(crm.customers.listCustomers(ctxA)).toHaveLength(0);
    expect(crm.leads.getLead(ctxA, lead.id).activities[0]).toMatchObject({
      type: 'lead_created',
      leadId: lead.id,
      companyId: null,
    });
  });

  it('never trusts the client for tenant, owner or status', () => {
    const lead = crm.leads.createLead(ctxA, {
      name: 'X',
      organizationId: 'org-b',
      ownerId: 'someone',
      status: 'won',
      convertedAt: '2026-01-01T00:00:00Z',
    });
    expect(lead).toMatchObject({
      organizationId: 'org-a',
      ownerId: 'user-a',
      status: 'active',
      convertedAt: null,
    });
  });

  it('validates name, e-mail, value, source and stage', () => {
    rejects(
      () => crm.leads.createLead(ctxA, { name: ' ' }),
      { name: MESSAGES.leadNameRequired },
      MESSAGES.leadNameRequired,
    );
    rejects(() => crm.leads.createLead(ctxA, { name: 'X', email: 'nope' }), {
      email: 'Neispravna e-mail adresa.',
    });
    rejects(() => crm.leads.createLead(ctxA, { name: 'X', estimatedValue: '-5' }), {
      estimatedValue: expect.any(String),
    });
    rejects(() => crm.leads.createLead(ctxA, { name: 'X', source: 'fax' }), {
      source: 'Odaberite izvor leada.',
    });
    rejects(() => crm.leads.createLead(ctxA, { name: 'X', stage: 'won' }), {
      stage: 'Odaberite fazu.',
    });
    expect(crm.repo.data().leads).toHaveLength(0);
  });

  it('keeps value with currency and stamps qualifiedAt for a qualified start', () => {
    const lead = crm.leads.createLead(ctxA, {
      name: 'Hotel',
      estimatedValue: '12500,5',
      stage: 'qualified',
    });
    expect(lead).toMatchObject({ estimatedValue: 12500.5, currency: 'EUR', stage: 'qualified' });
    expect(lead.qualifiedAt).toBe(ctxA.now.toISOString());
  });
});

describe('LeadService · tenant isolation', () => {
  it('another organization can neither see nor change a lead', () => {
    const lead = marko();
    expect(crm.leads.listLeads(ctxB)).toHaveLength(0);
    expect(() => crm.leads.getLead(ctxB, lead.id)).toThrow(CrmNotFoundError);
    expect(() => crm.leads.updateLead(ctxB, lead.id, { name: 'Y' })).toThrow(CrmNotFoundError);
    expect(() => crm.leads.markLeadLost(ctxB, lead.id, {})).toThrow(CrmNotFoundError);
    expect(() =>
      crm.leads.convertLead(ctxB, lead.id, {
        conversionMode: 'CREATE_CUSTOMER',
        customer: { companyName: 'ABC', oib: '1', city: 'Zagreb' },
      }),
    ).toThrow(CrmNotFoundError);
    expect(crm.leads.getLead(ctxA, lead.id).status).toBe('active');
  });

  it('lists by status, newest first', () => {
    const first = marko();
    const second = crm.leads.createLead(
      { ...ctxA, now: new Date('2026-10-06T09:00:00Z') },
      { name: 'Ana' },
    );
    crm.leads.markLeadLost(ctxA, first.id, {});
    expect(crm.leads.listLeads(ctxA).map((l) => l.id)).toEqual([second.id, first.id]);
    expect(crm.leads.listLeads(ctxA, { status: 'active' }).map((l) => l.id)).toEqual([second.id]);
    expect(crm.leads.listLeads(ctxA, { status: 'lost' }).map((l) => l.id)).toEqual([first.id]);
    expect(crm.leads.listLeads(ctxA, { q: 'abc' }).map((l) => l.id)).toEqual([first.id]);
  });
});

describe('LeadService · update', () => {
  it('moves the stage, stamps qualifiedAt once and logs the change', () => {
    const lead = marko();
    crm.leads.updateLead(ctxA, lead.id, { stage: 'contacted' });
    const later = { ...ctxA, now: new Date('2026-10-06T09:00:00Z') };
    const qualified = crm.leads.updateLead(later, lead.id, { stage: 'qualified' });
    expect(qualified.qualifiedAt).toBe(later.now.toISOString());
    crm.leads.updateLead({ ...ctxA, now: new Date('2026-10-07T09:00:00Z') }, lead.id, {
      stage: 'contacted',
    });
    expect(crm.leads.getLead(ctxA, lead.id).qualifiedAt).toBe(later.now.toISOString());
    expect(
      crm.leads.getLead(ctxA, lead.id).activities.filter((a) => a.type === 'lead_stage_changed'),
    ).toHaveLength(3);
  });

  it('closed leads are history and cannot be edited', () => {
    const lead = marko();
    crm.leads.markLeadLost(ctxA, lead.id, {});
    rejects(() => crm.leads.updateLead(ctxA, lead.id, { name: 'Y' }), {
      status: MESSAGES.leadClosed,
    });
  });
});

describe('LeadService · tasks on a lead', () => {
  it('a task can concern a lead without any customer', () => {
    const lead = marko();
    const task = crm.tasks.createTask(ctxA, {
      title: 'Follow-up Marko',
      type: 'follow_up',
      leadId: lead.id,
      dueDate: '2026-10-06',
    });
    expect(task).toMatchObject({
      leadId: lead.id,
      leadName: 'Marko Horvat · ABC d.o.o.',
      companyId: null,
    });
    expect(crm.leads.getLead(ctxA, lead.id).tasks.map((t) => t.id)).toEqual([task.id]);
    expect(crm.tasks.listTasks(ctxA, { leadId: lead.id })).toHaveLength(1);
  });

  it('rejects a lead of another organization', () => {
    const foreign = crm.leads.createLead(ctxB, { name: 'Tuđi lead' });
    rejects(
      () => crm.tasks.createTask(ctxA, { title: 'X', leadId: foreign.id, dueDate: '2026-12-31' }),
      {
        leadId: MESSAGES.unavailable,
      },
    );
    rejects(
      () => crm.tasks.createTask(ctxA, { title: 'X', leadId: 'not an id', dueDate: '2026-12-31' }),
      {
        leadId: MESSAGES.unavailable,
      },
    );
  });
});

/** A lead with a deal that was won (ADR-0009: the lead is WON, no customer yet). */
function wonLead(name = 'Marko Horvat', companyName = 'ABC d.o.o.') {
  const lead = crm.leads.createLead(ctxA, {
    name,
    companyName,
    phone: '091 234 5678',
    source: 'referral',
  });
  const { opportunity: deal } = crm.opportunities.createOpportunity(ctxA, {
    leadId: lead.id,
    title: 'Vending aparat',
    value: '5000',
  });
  crm.opportunities.closeOpportunity(ctxA, deal.id, { outcome: 'won' });
  return { lead, deal };
}

describe('LeadService · conversion (after WON)', () => {
  const toNewCustomer = {
    conversionMode: 'CREATE_CUSTOMER',
    customer: { companyName: 'ABC d.o.o.', oib: '12345678903', city: 'Zagreb' },
    createContact: true,
    contact: { fullName: 'Marko Horvat', phone: '091 234 5678', role: 'Direktor' },
  };

  it('an active lead is not converted: the deal is won first', () => {
    const lead = marko();
    rejects(() => crm.leads.convertLead(ctxA, lead.id, toNewCustomer), {
      status: MESSAGES.leadNotWon,
    });
    expect(crm.repo.data().customers).toHaveLength(0);
  });

  it('KREIRAJ KUPCA: an ACTIVE customer with a contact; the lead stays WON and records it', () => {
    const { lead, deal } = wonLead();
    const task = crm.tasks.createTask(ctxA, {
      title: 'Follow-up Marko',
      leadId: lead.id,
      dueDate: '2026-12-31',
    });
    const result = crm.leads.convertLead(ctxA, lead.id, toNewCustomer);
    const customer = crm.customers.getCustomer(ctxA, result.customerId);
    expect(customer).toMatchObject({
      companyName: 'ABC d.o.o.',
      status: 'active',
      type: 'customer',
    });
    expect(customer.primaryContactId).toBe(result.contactId);
    expect(crm.customers.listCustomers(ctxA, { status: 'active' }).map((c) => c.id)).toContain(
      result.customerId,
    );
    expect(result).toMatchObject({ opportunityId: deal.id, alreadyConverted: false });
    expect(result.lead).toMatchObject({
      status: 'won',
      wonBasis: 'opportunity',
      conversionPending: false,
      convertedAt: ctxA.now.toISOString(),
      convertedCustomerId: result.customerId,
      convertedContactId: result.contactId,
      convertedOpportunityId: deal.id,
      convertedCustomerName: 'ABC d.o.o.',
      convertedOpportunityTitle: 'Vending aparat',
    });
    // The lead and its history stay; its own task now also concerns the customer.
    expect(crm.repo.data().leads).toHaveLength(1);
    expect(crm.tasks.getTask(ctxA, task.id)).toMatchObject({
      leadId: lead.id,
      companyId: result.customerId,
    });
    expect(crm.leads.getLead(ctxA, lead.id).activities[0]).toMatchObject({
      type: 'lead_converted',
      companyId: result.customerId,
    });
  });

  it('the won deal is the same record: id, lead, dates, values and offers kept, customer added', () => {
    const lead = crm.leads.createLead(ctxA, { name: 'FERO-TERM' });
    const { opportunity: deal } = crm.opportunities.createOpportunity(ctxA, {
      leadId: lead.id,
      title: 'Vending aparat',
      value: '5000',
      nextActionTitle: 'Poslati ponudu',
      nextActionDueDate: '2026-10-15',
    });
    const offer = crm.offers.recordSent(ctxA, { opportunityId: deal.id, title: 'Ponuda vending' });
    expect(offer.companyId).toBeNull();
    const won = crm.opportunities.closeOpportunity(ctxA, deal.id, {
      outcome: 'won',
      wonValue: '5500',
    });
    const before = structuredClone(crm.repo.data().opportunities.find((o) => o.id === deal.id)!);
    const result = crm.leads.convertLead(ctxA, lead.id, {
      conversionMode: 'CREATE_CUSTOMER',
      customer: { companyName: 'FERO-TERM d.o.o.', oib: '60417283915', city: 'Osijek' },
    });
    const after = crm.repo.data().opportunities.find((o) => o.id === deal.id)!;
    expect(crm.repo.data().opportunities).toHaveLength(1); // no replacement deal
    expect(after).toMatchObject({
      ...before,
      companyId: result.customerId,
      leadId: lead.id,
      updatedAt: expect.any(String),
    });
    expect(after.closedAt).toBe(won.closedAt);
    expect(after.wonValue).toBe(5500);
    expect(crm.repo.data().offers.find((o) => o.id === offer.id)?.companyId).toBe(
      result.customerId,
    );
    expect(crm.tasks.listTasks(ctxA, { opportunityId: deal.id })[0]).toMatchObject({
      leadId: lead.id,
      companyId: result.customerId,
    });
    // On the customer's profile now, and still on the lead.
    expect(
      crm.customers.getProfile(ctxA, result.customerId).opportunities.map((o) => o.id),
    ).toEqual([deal.id]);
    expect(crm.leads.getLead(ctxA, lead.id).opportunities.map((o) => o.id)).toEqual([deal.id]);
  });

  it('a company-only conversion needs no contact', () => {
    const { lead } = wonLead('Hotel Lavanda', '');
    const result = crm.leads.convertLead(ctxA, lead.id, {
      conversionMode: 'CREATE_CUSTOMER',
      customer: { companyName: 'Hotel Lavanda', oib: '11111111111', city: 'Poreč' },
    });
    expect(result.contactId).toBeNull();
    expect(crm.customers.getCustomer(ctxA, result.customerId).primaryContactId).toBeNull();
  });

  it('POVEŽI S POSTOJEĆIM KUPCEM: no duplicate customer', () => {
    const abc = crm.customers.createCustomer(ctxA, {
      companyName: 'ABC d.o.o.',
      oib: '12345678903',
      city: 'Zagreb',
      contactName: 'Ivana',
      type: 'prospect',
    });
    const { lead, deal } = wonLead();
    expect(crm.leads.customerMatches(ctxA, lead.id)).toEqual([
      expect.objectContaining({ id: abc.id, reasons: ['name'] }),
    ]);
    const result = crm.leads.convertLead(ctxA, lead.id, {
      conversionMode: 'EXISTING_CUSTOMER',
      customerId: abc.id,
      createContact: true,
      contact: { fullName: 'Marko Horvat' },
    });
    expect(result.customerId).toBe(abc.id);
    expect(crm.customers.listCustomers(ctxA)).toHaveLength(1);
    expect(crm.customers.getCustomer(ctxA, abc.id).type).toBe('customer'); // it has a won deal now
    expect(
      crm.contacts.listContacts(ctxA, { companyId: abc.id }).map((c) => c.firstName),
    ).toContain('Marko');
    expect(crm.opportunities.getOpportunity(ctxA, deal.id).companyId).toBe(abc.id);
  });

  it('an inactive existing customer is linked only after a confirmed reactivation', () => {
    const old = crm.customers.createCustomer(ctxA, {
      companyName: 'Stari kupac',
      oib: '22222222222',
      city: 'Pula',
      contactName: 'I',
    });
    crm.customers.setActive(ctxA, old.id, false);
    const { lead } = wonLead();
    let conflict: unknown;
    try {
      crm.leads.convertLead(ctxA, lead.id, {
        conversionMode: 'EXISTING_CUSTOMER',
        customerId: old.id,
      });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(CrmConflictError);
    expect((conflict as CrmConflictError).message).toBe(MESSAGES.customerInactive);
    expect(crm.leads.getLead(ctxA, lead.id).conversionPending).toBe(true);
    expect(crm.customers.getCustomer(ctxA, old.id).status).toBe('inactive');

    crm.leads.convertLead(ctxA, lead.id, {
      conversionMode: 'EXISTING_CUSTOMER',
      customerId: old.id,
      reactivate: true,
    });
    expect(crm.customers.getCustomer(ctxA, old.id).status).toBe('active');
  });

  it('a possible existing customer stops the new one until confirmed', () => {
    crm.customers.createCustomer(ctxA, {
      companyName: 'ABC',
      oib: '99999999999',
      city: 'Split',
      contactName: 'I',
    });
    const { lead } = wonLead();
    let conflict: unknown;
    try {
      crm.leads.convertLead(ctxA, lead.id, toNewCustomer);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(CrmConflictError);
    expect((conflict as CrmConflictError).message).toBe(MESSAGES.possibleExistingCustomer);
    expect((conflict as CrmConflictError).details.matches).toHaveLength(1);
    expect(crm.leads.getLead(ctxA, lead.id)).toMatchObject({
      status: 'won',
      conversionPending: true,
    });
    const confirmed = crm.leads.convertLead(ctxA, lead.id, {
      ...toNewCustomer,
      ignoreMatches: true,
    });
    expect(confirmed.lead.conversionPending).toBe(false);
    expect(crm.customers.listCustomers(ctxA)).toHaveLength(2);
  });

  it('rejects a customer of another organization', () => {
    const foreign = crm.customers.createCustomer(ctxB, {
      companyName: 'Tuđa',
      oib: '1',
      city: 'X',
      contactName: 'Y',
    });
    const { lead } = wonLead();
    rejects(
      () =>
        crm.leads.convertLead(ctxA, lead.id, {
          conversionMode: 'EXISTING_CUSTOMER',
          customerId: foreign.id,
        }),
      { customerId: MESSAGES.unavailable },
      MESSAGES.unavailable,
    );
  });

  it('validates the conversion before writing anything (missing customer data is asked for)', () => {
    const { lead } = wonLead();
    rejects(
      () =>
        crm.leads.convertLead(ctxA, lead.id, {
          conversionMode: 'CREATE_CUSTOMER',
          customer: { companyName: '' },
          createContact: true,
          contact: {},
        }),
      {
        'customer.companyName': expect.any(String),
        'customer.oib': expect.any(String),
        'contact.fullName': expect.any(String),
      },
    );
    expect(crm.repo.data().customers).toHaveLength(0);
  });

  it('is atomic: a failure after the customer was reactivated leaves nothing behind', () => {
    const old = crm.customers.createCustomer(ctxA, {
      companyName: 'Stari kupac',
      oib: '22222222222',
      city: 'Pula',
      contactName: 'I',
    });
    crm.customers.setActive(ctxA, old.id, false);
    const { lead } = wonLead();
    const before = structuredClone(crm.repo.data());
    vi.spyOn(crm.contacts, 'createContact').mockImplementation(() => {
      throw new Error('database unavailable');
    });
    expect(() =>
      crm.leads.convertLead(ctxA, lead.id, {
        conversionMode: 'EXISTING_CUSTOMER',
        customerId: old.id,
        reactivate: true,
        createContact: true,
        contact: { fullName: 'Marko Horvat' },
      }),
    ).toThrow('database unavailable');
    expect(crm.repo.data()).toEqual(before);
    expect(crm.leads.getLead(ctxA, lead.id)).toMatchObject({ status: 'won', convertedAt: null });
    vi.restoreAllMocks();
  });

  it('idempotent: a repeated conversion returns the same customer and creates no duplicate', () => {
    const { lead } = wonLead();
    const first = crm.leads.convertLead(ctxA, lead.id, toNewCustomer);
    const again = crm.leads.convertLead(ctxA, lead.id, { ...toNewCustomer, ignoreMatches: true });
    expect(again).toMatchObject({ customerId: first.customerId, alreadyConverted: true });
    expect(crm.repo.data().customers).toHaveLength(1);
    // Into a different customer: refused; and a won lead is never closed as lost.
    const other = crm.customers.createCustomer(ctxA, {
      companyName: 'Drugi',
      oib: '33333333333',
      city: 'Zadar',
      contactName: 'D',
    });
    rejects(
      () =>
        crm.leads.convertLead(ctxA, lead.id, {
          conversionMode: 'EXISTING_CUSTOMER',
          customerId: other.id,
        }),
      { status: MESSAGES.leadAlreadyConverted },
    );
    rejects(() => crm.leads.markLeadLost(ctxA, lead.id, {}), { status: MESSAGES.leadClosed });
  });

  it("the lead's other deals stay under the lead; linking one to the customer is explicit", () => {
    const { lead } = wonLead();
    const { opportunity: second } = crm.opportunities.createOpportunity(ctxA, {
      leadId: lead.id,
      title: 'Kapsulni sustav',
    });
    rejects(() => crm.opportunities.linkToLeadCustomer(ctxA, second.id), {
      leadId: MESSAGES.leadNotConverted,
    });
    const result = crm.leads.convertLead(ctxA, lead.id, toNewCustomer);
    expect(crm.opportunities.getOpportunity(ctxA, second.id)).toMatchObject({
      companyId: null,
      leadId: lead.id,
      status: 'active',
    });
    const linked = crm.opportunities.linkToLeadCustomer(ctxA, second.id);
    expect(linked).toMatchObject({ companyId: result.customerId, leadId: lead.id });
  });
});

describe('LeadService · lead-first sales (ADR-0009)', () => {
  it('KREIRAJ PRILIKU: deals of a lead need no customer; several, each with its own status', () => {
    const lead = marko();
    const deal = (title: string, value: string) =>
      crm.opportunities.createOpportunity(ctxA, { leadId: lead.id, title, value }).opportunity;
    const a = deal('Vending aparat', '5000');
    const b = deal('Dodatni snack aparat', '3000');
    const c = deal('Kapsulni sustav', '2000');
    expect(a).toMatchObject({
      leadId: lead.id,
      companyId: null,
      leadName: 'Marko Horvat · ABC d.o.o.',
    });
    expect(crm.repo.data().customers).toHaveLength(0);

    crm.opportunities.closeOpportunity(ctxA, c.id, { outcome: 'lost' });
    expect(crm.leads.getLead(ctxA, lead.id).status).toBe('active'); // a lost deal does not close the lead

    const atWin = { ...ctxA, now: new Date('2026-10-06T10:00:00Z') };
    const wonA = crm.opportunities.closeOpportunity(atWin, a.id, { outcome: 'won' });
    expect(wonA).toMatchObject({ leadStatus: 'won', leadCustomerId: null });
    expect(crm.leads.getLead(ctxA, lead.id)).toMatchObject({
      status: 'won',
      wonAt: wonA.closedAt,
      wonBasis: 'opportunity',
      conversionPending: true,
      convertedAt: null,
      convertedCustomerId: null,
    });
    expect(crm.repo.data().customers).toHaveLength(0); // never created automatically
    expect(crm.opportunities.getOpportunity(ctxA, b.id).status).toBe('active');

    // A later win keeps the first WON date and creates nothing.
    crm.opportunities.closeOpportunity(ctxA, b.id, { outcome: 'won' });
    expect(crm.leads.getLead(ctxA, lead.id).wonAt).toBe(wonA.closedAt);
    expect(crm.repo.data().customers).toHaveLength(0);
    expect(
      crm.leads.getLead(ctxA, lead.id).activities.filter((x) => x.type === 'lead_won'),
    ).toHaveLength(1);
  });

  it('relations are validated: no orphan, no unrelated customer, no foreign lead, no contact without a customer', () => {
    const lead = marko();
    const abc = crm.customers.createCustomer(ctxA, {
      companyName: 'XYZ',
      oib: '12345678903',
      city: 'Zagreb',
      contactName: 'Ivana',
    });
    rejects(() => crm.opportunities.createOpportunity(ctxA, { title: 'X' }), {
      companyId: MESSAGES.originRequired,
    });
    rejects(
      () =>
        crm.opportunities.createOpportunity(ctxA, {
          title: 'X',
          leadId: lead.id,
          companyId: abc.id,
        }),
      { companyId: MESSAGES.leadCustomerMismatch },
    );
    const foreignLead = crm.leads.createLead(ctxB, { name: 'Tuđi lead' });
    rejects(
      () => crm.opportunities.createOpportunity(ctxA, { title: 'X', leadId: foreignLead.id }),
      { leadId: MESSAGES.unavailable },
    );
    rejects(
      () =>
        crm.opportunities.createOpportunity(ctxA, {
          title: 'X',
          leadId: lead.id,
          contactId: abc.primaryContactId,
        }),
      { contactId: MESSAGES.opportunityNeedsCustomerForContact },
    );
    // Path B (customer → opportunity) is unchanged.
    expect(
      crm.opportunities.createOpportunity(ctxA, { title: 'Servis', companyId: abc.id }).opportunity,
    ).toMatchObject({ companyId: abc.id, leadId: null });
  });

  it('a lead with open deals is not closed as lost; a lost lead gets no new deals', () => {
    const lead = marko();
    const { opportunity } = crm.opportunities.createOpportunity(ctxA, {
      leadId: lead.id,
      title: 'Vending aparat',
    });
    rejects(() => crm.leads.markLeadLost(ctxA, lead.id, {}), {
      status: MESSAGES.leadHasActiveOpportunities,
    });
    crm.opportunities.closeOpportunity(ctxA, opportunity.id, { outcome: 'lost' });
    crm.leads.markLeadLost(ctxA, lead.id, { reason: 'price' });
    rejects(() => crm.opportunities.createOpportunity(ctxA, { title: 'X', leadId: lead.id }), {
      leadId: MESSAGES.leadLostNoOpportunity,
    });
  });

  it('the task form keeps the deal of a lead (no customer) — regression', () => {
    const values = {
      title: 'Poslati ponudu',
      type: 'follow_up',
      priority: 'normal',
      description: '',
      companyId: '',
      contactId: '',
      leadId: 'lead-1',
      opportunityId: 'deal-1',
      date: '2026-10-15',
      dueTime: '',
      inCalendar: false,
      startTime: '',
      endTime: '',
    };
    expect(taskInputFromForm(values).input).toMatchObject({
      leadId: 'lead-1',
      opportunityId: 'deal-1',
      companyId: null,
    });
    // Without a lead or a customer there is no deal to keep.
    expect(taskInputFromForm({ ...values, leadId: '' }).input).toMatchObject({
      opportunityId: null,
    });
  });

  it('a task of a lead deal gets the lead, no customer, and is in the Sales Calendar', () => {
    const lead = marko();
    const { opportunity } = crm.opportunities.createOpportunity(ctxA, {
      leadId: lead.id,
      title: 'Vending aparat',
    });
    const task = crm.tasks.createTask(ctxA, {
      title: 'Poslati ponudu',
      opportunityId: opportunity.id,
      scheduledStartAt: '2026-10-15T08:00:00.000Z',
    });
    expect(task).toMatchObject({ leadId: lead.id, companyId: null, opportunityId: opportunity.id });
    expect(
      crm.calendar
        .getCalendarTasks(ctxA, new Date('2026-10-15T00:00:00Z'), new Date('2026-10-16T00:00:00Z'))
        .map((t) => t.id),
    ).toContain(task.id);
    const other = marko();
    rejects(
      () =>
        crm.tasks.createTask(ctxA, {
          title: 'X',
          leadId: other.id,
          opportunityId: opportunity.id,
          dueDate: '2026-10-20',
        }),
      { opportunityId: MESSAGES.opportunityNotOfLead },
    );
  });
});

describe('LeadService · lost', () => {
  it('closes as LOST with a reason and keeps the lead', () => {
    const lead = marko();
    const lost = crm.leads.markLeadLost(ctxA, lead.id, {
      reason: 'not_interested',
      note: 'Ima dobavljača.',
    });
    expect(lost).toMatchObject({
      status: 'lost',
      lostAt: ctxA.now.toISOString(),
      lostReason: 'not_interested',
      lostNote: 'Ima dobavljača.',
      convertedAt: null,
    });
    expect(crm.repo.data().leads).toHaveLength(1);
    expect(crm.leads.getLead(ctxA, lead.id).activities[0]).toMatchObject({
      type: 'lead_lost',
      description: 'Nije zainteresiran',
    });
  });

  it('the reason is optional but must be known', () => {
    expect(crm.leads.markLeadLost(ctxA, marko().id, {}).lostReason).toBeNull();
    rejects(() => crm.leads.markLeadLost(ctxA, marko().id, { reason: 'bored' }), {
      reason: 'Odaberite razlog.',
    });
  });
});

describe('LeadService · period semantics', () => {
  it('a lead created in Q3, its deal won in Q4 and converted in Q4: new in Q3, won and converted in Q4', () => {
    const q3 = (s: CrmServices) => s.dashboard.getPeriodSummary(ctxA, '2026-07-01', '2026-09-30');
    const q4 = (s: CrmServices) => s.dashboard.getPeriodSummary(ctxA, '2026-10-01', '2026-12-31');
    const beforeQ3 = q3(crm);
    const beforeQ4 = q4(crm);

    const inQ3 = { ...ctxA, now: new Date('2026-09-15T08:00:00Z') };
    const lead = crm.leads.createLead(inQ3, { name: 'Marko Horvat', companyName: 'ABC d.o.o.' });
    const lost = crm.leads.createLead(inQ3, { name: 'Kafić' });
    const { opportunity } = crm.opportunities.createOpportunity(inQ3, {
      leadId: lead.id,
      title: 'Vending aparat',
      value: '5000',
    });
    crm.opportunities.closeOpportunity(ctxA, opportunity.id, { outcome: 'won' });
    const pending = q4(crm);
    expect(pending.leads).toMatchObject({
      won: beforeQ4.leads.won + 1,
      converted: beforeQ4.leads.converted,
      conversionPending: 1,
    });
    crm.leads.convertLead(ctxA, lead.id, {
      conversionMode: 'CREATE_CUSTOMER',
      customer: { companyName: 'ABC d.o.o.', oib: '12345678903', city: 'Zagreb' },
    });
    crm.leads.markLeadLost(ctxA, lost.id, { reason: 'price' });

    const afterQ3 = q3(crm);
    const afterQ4 = q4(crm);
    // The lead is counted once as a new lead: not again for its deal or its conversion.
    expect(afterQ3.leads.created).toBe(beforeQ3.leads.created + 2);
    expect(afterQ3.kpis.newLeads.value).toBe(beforeQ3.kpis.newLeads.value + 2);
    expect(afterQ4.kpis.newLeads.value).toBe(beforeQ4.kpis.newLeads.value);
    expect(afterQ3.leads.won).toBe(beforeQ3.leads.won);
    expect(afterQ3.leads.lost).toBe(beforeQ3.leads.lost);
    expect(afterQ4.leads.created).toBe(beforeQ4.leads.created);
    expect(afterQ4.leads.won).toBe(beforeQ4.leads.won + 1);
    expect(afterQ4.leads.converted).toBe(beforeQ4.leads.converted + 1);
    expect(afterQ4.leads.conversionPending).toBe(0);
    expect(afterQ4.leads.lost).toBe(beforeQ4.leads.lost + 1);
    // The deal is an opportunity WON of Q4, created in Q3 (potential of Q3).
    expect(afterQ4.kpis.won.value).toBe(beforeQ4.kpis.won.value + 1);
    expect(afterQ4.kpis.wonValue.value).toBe(beforeQ4.kpis.wonValue.value + 5000);
    expect(afterQ3.kpis.potential.value).toBe(beforeQ3.kpis.potential.value + 5000);
    // Ratios come from the shared helper; active leads never count as lost.
    expect(afterQ4.leads).toMatchObject(
      leadOutcomeMetrics({
        created: afterQ4.leads.created,
        won: afterQ4.leads.won,
        lost: afterQ4.leads.lost,
      }),
    );
    // History is not reset by later activity: the lead's created date stays in Q3.
    expect(crm.leads.getLead(ctxA, lead.id).createdAt).toBe(inQ3.now.toISOString());
  });
});

describe('Lead → Task regression (the "freeze" report)', () => {
  // The freeze came from the demo's database layer (see demo-database-store.test.ts);
  // these keep every task/link combination working on the server.
  const tomorrow10 = '2026-10-06T08:00:00.000Z'; // 10:00 in Zagreb

  it('A–C: standalone, customer and opportunity tasks still work', () => {
    const standalone = crm.tasks.createTask(ctxA, {
      title: 'Pripremiti prezentaciju',
      dueDate: '2026-12-31',
    });
    expect(standalone).toMatchObject({ companyId: null, leadId: null, opportunityId: null });
    const customer = crm.customers.createCustomer(ctxA, {
      companyName: 'FERO-TERM',
      oib: '12345678901',
      city: 'Osijek',
      contactName: 'Marko',
    });
    expect(
      crm.tasks.createTask(ctxA, { title: 'Poziv', companyId: customer.id, dueDate: '2026-12-31' })
        .companyId,
    ).toBe(customer.id);
    const { opportunity } = crm.opportunities.createOpportunity(ctxA, {
      companyId: customer.id,
      title: 'Vending',
    });
    expect(
      crm.tasks.createTask(ctxA, {
        title: 'Follow-up',
        opportunityId: opportunity.id,
        dueDate: '2026-12-31',
      }),
    ).toMatchObject({ opportunityId: opportunity.id, companyId: customer.id });
  });

  it('D–F: a lead task needs no customer, with or without a calendar slot', () => {
    const lead = marko();
    const dated = crm.tasks.createTask(ctxA, {
      title: 'Nazvati',
      leadId: lead.id,
      dueDate: '2026-12-31',
    });
    const scheduled = crm.tasks.createTask(ctxA, {
      title: 'Follow-up Marko',
      type: 'follow_up',
      leadId: lead.id,
      scheduledStartAt: tomorrow10,
    });
    for (const task of [dated, scheduled]) {
      expect(task).toMatchObject({ leadId: lead.id, companyId: null, contactId: null });
    }
    expect(
      crm.leads
        .getLead(ctxA, lead.id)
        .tasks.map((t) => t.id)
        .sort(),
    ).toEqual([dated.id, scheduled.id].sort());
  });

  it('G: a lead of another organization is refused', () => {
    const foreign = crm.leads.createLead(ctxB, { name: 'Tuđi' });
    rejects(
      () => crm.tasks.createTask(ctxA, { title: 'X', leadId: foreign.id, dueDate: '2026-12-31' }),
      {
        leadId: MESSAGES.unavailable,
      },
    );
  });

  it('J: a scheduled lead task is in the Sales Calendar of its day', () => {
    const lead = marko();
    const task = crm.tasks.createTask(ctxA, {
      title: 'Follow-up Marko',
      leadId: lead.id,
      scheduledStartAt: tomorrow10,
    });
    const day = crm.calendar.getCalendarTasks(
      ctxA,
      new Date('2026-10-05T22:00:00Z'),
      new Date('2026-10-06T22:00:00Z'),
    );
    expect(day.map((t) => t.id)).toContain(task.id);
    expect(day.find((t) => t.id === task.id)).toMatchObject({
      leadName: 'Marko Horvat · ABC d.o.o.',
    });
  });
});
