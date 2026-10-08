// LeadService: leads are their own records (not customers), scoped to one
// organization, never deleted. Conversion (WON) is atomic and reuses the
// customer, contact and opportunity services; LOST is an explicit close.
// Period reporting counts each outcome by its own date.
import { leadOutcomeMetrics } from '@renvara/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../public/app/js/core/validation.js';
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
    rejects(() => crm.tasks.createTask(ctxA, { title: 'X', leadId: foreign.id }), {
      leadId: MESSAGES.unavailable,
    });
    rejects(() => crm.tasks.createTask(ctxA, { title: 'X', leadId: 'not an id' }), {
      leadId: MESSAGES.unavailable,
    });
  });
});

describe('LeadService · conversion', () => {
  const toNewCustomer = {
    conversionMode: 'CREATE_CUSTOMER',
    customer: { companyName: 'ABC d.o.o.', oib: '12345678903', city: 'Zagreb' },
    createContact: true,
    contact: { fullName: 'Marko Horvat', phone: '091 234 5678', role: 'Direktor' },
  };

  it('creates a new customer with a contact, keeps the lead and marks it WON', () => {
    const lead = marko();
    const task = crm.tasks.createTask(ctxA, { title: 'Follow-up Marko', leadId: lead.id });
    const result = crm.leads.convertLead(ctxA, lead.id, toNewCustomer);
    const customer = crm.customers.getCustomer(ctxA, result.customerId);
    expect(customer.companyName).toBe('ABC d.o.o.');
    expect(customer.primaryContactId).toBe(result.contactId);
    expect(result.opportunityId).toBeNull();
    expect(result.lead).toMatchObject({
      status: 'won',
      stage: 'qualified',
      convertedAt: ctxA.now.toISOString(),
      qualifiedAt: ctxA.now.toISOString(),
      convertedCustomerId: result.customerId,
      convertedContactId: result.contactId,
      convertedCustomerName: 'ABC d.o.o.',
      convertedContactName: 'Marko Horvat',
    });
    // Lead and its history stay; its task now also belongs to the customer.
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

  it('can add an opportunity in the same step', () => {
    const lead = marko();
    const result = crm.leads.convertLead(ctxA, lead.id, {
      ...toNewCustomer,
      createOpportunity: true,
      opportunity: { title: 'Grijanje ureda', value: '8000', stage: 'in_progress' },
    });
    const opportunity = crm.repo.data().opportunities.find((o) => o.id === result.opportunityId)!;
    expect(opportunity).toMatchObject({
      organizationId: 'org-a',
      companyId: result.customerId,
      contactId: result.contactId,
      title: 'Grijanje ureda',
      value: 8000,
      stage: 'in_progress',
      status: 'active',
    });
    expect(result.lead.convertedOpportunityTitle).toBe('Grijanje ureda');
  });

  it('a company-only conversion needs no contact', () => {
    const lead = crm.leads.createLead(ctxA, { name: 'Hotel Lavanda' });
    const result = crm.leads.convertLead(ctxA, lead.id, {
      conversionMode: 'CREATE_CUSTOMER',
      customer: { companyName: 'Hotel Lavanda', oib: '11111111111', city: 'Poreč' },
    });
    expect(result.contactId).toBeNull();
    expect(crm.customers.getCustomer(ctxA, result.customerId).primaryContactId).toBeNull();
  });

  it('links to an existing customer without creating a duplicate', () => {
    const abc = crm.customers.createCustomer(ctxA, {
      companyName: 'ABC d.o.o.',
      oib: '12345678903',
      city: 'Zagreb',
      contactName: 'Ivana',
    });
    const lead = marko();
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
    expect(
      crm.contacts.listContacts(ctxA, { companyId: abc.id }).map((c) => c.firstName),
    ).toContain('Marko');
    expect(result.lead.status).toBe('won');
  });

  it('a possible existing customer stops the new one until confirmed', () => {
    crm.customers.createCustomer(ctxA, {
      companyName: 'ABC',
      oib: '99999999999',
      city: 'Split',
      contactName: 'I',
    });
    const lead = marko();
    let conflict: unknown;
    try {
      crm.leads.convertLead(ctxA, lead.id, toNewCustomer);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(CrmConflictError);
    expect((conflict as CrmConflictError).message).toBe(MESSAGES.possibleExistingCustomer);
    expect((conflict as CrmConflictError).details.matches).toHaveLength(1);
    expect(crm.leads.getLead(ctxA, lead.id).status).toBe('active');
    const confirmed = crm.leads.convertLead(ctxA, lead.id, {
      ...toNewCustomer,
      ignoreMatches: true,
    });
    expect(confirmed.lead.status).toBe('won');
    expect(crm.customers.listCustomers(ctxA)).toHaveLength(2);
  });

  it('rejects a customer of another organization', () => {
    const foreign = crm.customers.createCustomer(ctxB, {
      companyName: 'Tuđa',
      oib: '1',
      city: 'X',
      contactName: 'Y',
    });
    const lead = marko();
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

  it('validates the conversion before writing anything', () => {
    const lead = marko();
    rejects(
      () =>
        crm.leads.convertLead(ctxA, lead.id, {
          conversionMode: 'CREATE_CUSTOMER',
          customer: { companyName: '' },
          createContact: true,
          contact: {},
          createOpportunity: true,
          opportunity: {},
        }),
      {
        'customer.companyName': expect.any(String),
        'contact.fullName': expect.any(String),
        'opportunity.title': expect.any(String),
      },
    );
    expect(crm.repo.data().customers).toHaveLength(0);
  });

  it('is atomic: a failure after the customer was created leaves nothing behind', () => {
    const lead = marko();
    const before = structuredClone(crm.repo.data());
    vi.spyOn(crm.opportunities, 'createOpportunity').mockImplementation(() => {
      throw new Error('database unavailable');
    });
    expect(() =>
      crm.leads.convertLead(ctxA, lead.id, {
        ...toNewCustomer,
        createOpportunity: true,
        opportunity: { title: 'Grijanje ureda' },
      }),
    ).toThrow('database unavailable');
    expect(crm.repo.data()).toEqual(before);
    expect(crm.leads.getLead(ctxA, lead.id)).toMatchObject({ status: 'active', convertedAt: null });
    vi.restoreAllMocks();
  });

  it('a converted lead cannot be converted or lost again', () => {
    const lead = marko();
    crm.leads.convertLead(ctxA, lead.id, toNewCustomer);
    rejects(() => crm.leads.convertLead(ctxA, lead.id, { ...toNewCustomer, ignoreMatches: true }), {
      status: MESSAGES.leadClosed,
    });
    rejects(() => crm.leads.markLeadLost(ctxA, lead.id, {}), { status: MESSAGES.leadClosed });
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
  it('a lead created in Q3 and won in Q4 is new in Q3 and won in Q4', () => {
    const q3 = (s: CrmServices) => s.dashboard.getPeriodSummary(ctxA, '2026-07-01', '2026-09-30');
    const q4 = (s: CrmServices) => s.dashboard.getPeriodSummary(ctxA, '2026-10-01', '2026-12-31');
    const beforeQ3 = q3(crm);
    const beforeQ4 = q4(crm);

    const inQ3 = { ...ctxA, now: new Date('2026-09-15T08:00:00Z') };
    const lead = crm.leads.createLead(inQ3, { name: 'Marko Horvat', companyName: 'ABC d.o.o.' });
    const lost = crm.leads.createLead(inQ3, { name: 'Kafić' });
    crm.leads.convertLead(ctxA, lead.id, {
      conversionMode: 'CREATE_CUSTOMER',
      customer: { companyName: 'ABC d.o.o.', oib: '12345678903', city: 'Zagreb' },
    });
    crm.leads.markLeadLost(ctxA, lost.id, { reason: 'price' });

    const afterQ3 = q3(crm);
    const afterQ4 = q4(crm);
    expect(afterQ3.leads.created).toBe(beforeQ3.leads.created + 2);
    expect(afterQ3.kpis.newLeads.value).toBe(beforeQ3.kpis.newLeads.value + 2);
    expect(afterQ3.leads.won).toBe(beforeQ3.leads.won);
    expect(afterQ3.leads.lost).toBe(beforeQ3.leads.lost);
    expect(afterQ4.leads.created).toBe(beforeQ4.leads.created);
    expect(afterQ4.leads.won).toBe(beforeQ4.leads.won + 1);
    expect(afterQ4.leads.lost).toBe(beforeQ4.leads.lost + 1);
    // Opportunity W/L is a different thing and does not move.
    expect(afterQ4.kpis.won.value).toBe(beforeQ4.kpis.won.value);
    // Ratios come from the shared helper; active leads never count as lost.
    expect(afterQ4.leads).toEqual(
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
