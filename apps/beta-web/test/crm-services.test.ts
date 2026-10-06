// CRM services: task model, relation rules, tenant isolation, Sales Calendar,
// priorities and next actions. Runs against the in-memory repository.
import { beforeEach, describe, expect, it } from 'vitest';
import { MESSAGES } from '../public/app/js/core/validation.js';
import { CrmNotFoundError, CrmValidationError } from '../src/crm/errors.ts';
import { createCrmServices, type CrmServices } from '../src/crm/index.ts';
import { createMemoryRepository, emptyData } from '../src/crm/repository.ts';
import { seedDemoData } from '../src/crm/seed.ts';
import { dayRange, zonedDateTime } from '../src/crm/time.ts';
import type { CrmContext } from '../src/crm/types.ts';

const TZ = 'Europe/Zagreb';
// Monday 5 Oct 2026, 11:00 in Zagreb (UTC+2).
const NOW = new Date('2026-10-05T09:00:00Z');
const TODAY = '2026-10-05';
const ctxA: CrmContext = {
  organizationId: 'org-a',
  user: { id: 'user-a', displayName: 'Ana A.' },
  timeZone: TZ,
  now: NOW,
};
const ctxB: CrmContext = {
  ...ctxA,
  organizationId: 'org-b',
  user: { id: 'user-b', displayName: 'B' },
};
const at = (time: string, day = TODAY) => zonedDateTime(day, time, TZ).toISOString();

let crm: CrmServices;
let fero: { id: string; contactId: string; oppId: string };
let adria: { id: string; contactId: string; oppId: string };

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

beforeEach(() => {
  crm = createCrmServices(createMemoryRepository(emptyData()));
  const customer = (ctx: CrmContext, companyName: string, oib: string, contactName: string) => {
    const c = crm.customers.createCustomer(ctx, { companyName, oib, city: 'Zagreb', contactName });
    const { opportunity } = crm.opportunities.createOpportunity(ctx, {
      companyId: c.id,
      title: `Prilika ${companyName}`,
    });
    return { id: c.id, contactId: c.primaryContactId as string, oppId: opportunity.id };
  };
  fero = customer(ctxA, 'FERO-TERM d.o.o.', '60417283915', 'Marko Lukač');
  adria = customer(ctxA, 'Adria Tech d.o.o.', '48291736501', 'Ivana Kovač');
});

describe('TaskService · independent tasks and scheduling', () => {
  it('creates a task without customer, contact, opportunity or date (TEST A)', () => {
    const task = crm.tasks.createTask(ctxA, { title: 'Pripremiti kvartalni izvještaj' });
    expect(task).toMatchObject({
      companyId: null,
      contactId: null,
      opportunityId: null,
      type: 'general',
      priority: 'normal',
      status: 'open',
      source: 'user',
      scheduledStartAt: null,
      dueDate: null,
      dueAt: null,
      organizationId: 'org-a',
      assignedUserId: 'user-a',
    });
    expect(crm.tasks.sections(ctxA).unscheduled.map((t) => t.id)).toEqual([task.id]);
    expect(crm.calendar.getDay(ctxA, TODAY)).toEqual([]);
  });

  it('putting the same task in the calendar today at 16:00 shows it there (TEST B)', () => {
    const task = crm.tasks.createTask(ctxA, { title: 'Samostalni zadatak' });
    crm.tasks.updateTask(ctxA, task.id, {
      title: 'Samostalni zadatak',
      scheduledStartAt: at('16:00'),
      scheduledEndAt: at('17:00'),
    });
    const day = crm.calendar.getDay(ctxA, TODAY);
    expect(day.map((t) => [t.title, t.scheduledStartAt])).toEqual([
      ['Samostalni zadatak', '2026-10-05T14:00:00.000Z'],
    ]);
    expect(crm.tasks.sections(ctxA).today.map((t) => t.id)).toEqual([task.id]);
    expect(crm.repo.data().tasks).toHaveLength(1); // no separate calendar record
  });

  it('FOLLOW_UP with customer and contact at 11:00 lands in the calendar and timeline (TEST C)', () => {
    const task = crm.tasks.createTask(ctxA, {
      title: 'Follow-up FERO-TERM',
      type: 'follow_up',
      companyId: fero.id,
      contactId: fero.contactId,
      scheduledStartAt: at('11:00'),
      description: 'Provjeriti status ponude.',
    });
    expect(task).toMatchObject({ customerName: 'FERO-TERM d.o.o.', contactName: 'Marko Lukač' });
    expect(crm.calendar.getDay(ctxA, TODAY).map((t) => t.title)).toEqual(['Follow-up FERO-TERM']);
    const profile = crm.customers.getProfile(ctxA, fero.id);
    expect(profile.activities[0]).toMatchObject({ type: 'task_scheduled', relatedId: task.id });
  });

  it('date-only calendar entries start at midnight in the organization timezone', () => {
    const task = crm.tasks.createTask(ctxA, {
      title: 'Sajam',
      allDay: true,
      scheduledDate: '2026-10-07',
    });
    expect(task.scheduledStartAt).toBe('2026-10-06T22:00:00.000Z');
    expect(task.scheduledDate).toBe('2026-10-07');
    expect(crm.calendar.getDay(ctxA, '2026-10-07').map((t) => t.id)).toEqual([task.id]);
    expect(crm.calendar.getDay(ctxA, '2026-10-06')).toEqual([]);
  });

  it('validates with the specified Croatian messages', () => {
    rejects(
      () => crm.tasks.createTask(ctxA, { title: '   ' }),
      { title: MESSAGES.taskTitleRequired },
      MESSAGES.taskTitleRequired,
    );
    rejects(
      () =>
        crm.tasks.createTask(ctxA, {
          title: 'X',
          scheduledStartAt: at('16:00'),
          scheduledEndAt: at('15:00'),
        }),
      { scheduledEndAt: MESSAGES.endBeforeStart },
    );
    rejects(() => crm.tasks.createTask(ctxA, { title: 'X', scheduledEndAt: at('15:00') }), {
      scheduledStartAt: 'Unesite vrijeme početka.',
    });
    rejects(() => crm.tasks.createTask(ctxA, { title: 'X', dueDate: TODAY, dueAt: at('12:00') }), {
      dueDate: 'Rok je datum ili točno vrijeme, ne oboje.',
    });
    rejects(() => crm.tasks.createTask(ctxA, { title: 'X', type: 'kanban' }), {
      type: 'Odaberite vrstu zadatka.',
    });
  });
});

describe('TaskService · relations (TEST G)', () => {
  it('derives the customer from the opportunity or the contact', () => {
    expect(crm.tasks.createTask(ctxA, { title: 'X', opportunityId: fero.oppId }).companyId).toBe(
      fero.id,
    );
    expect(crm.tasks.createTask(ctxA, { title: 'X', contactId: adria.contactId }).companyId).toBe(
      adria.id,
    );
  });

  it('rejects a contact or opportunity of a different customer', () => {
    rejects(
      () =>
        crm.tasks.createTask(ctxA, { title: 'X', companyId: adria.id, contactId: fero.contactId }),
      {
        contactId: MESSAGES.contactNotOfCustomer,
      },
    );
    rejects(
      () =>
        crm.tasks.createTask(ctxA, { title: 'X', companyId: adria.id, opportunityId: fero.oppId }),
      {
        opportunityId: MESSAGES.opportunityNotOfCustomer,
      },
    );
    rejects(
      () =>
        crm.tasks.createTask(ctxA, {
          title: 'X',
          opportunityId: fero.oppId,
          contactId: adria.contactId,
        }),
      { contactId: MESSAGES.contactNotOfCustomer },
    );
    expect(crm.repo.data().tasks).toHaveLength(0);
  });

  it('rejects unknown ids and ids of another organization with the same message', () => {
    const other = crm.customers.createCustomer(ctxB, {
      companyName: 'Tuđa tvrtka',
      oib: '11111111111',
      city: 'Split',
      contactName: 'Netko',
    });
    for (const input of [
      { companyId: 'nope' },
      { companyId: other.id },
      { contactId: other.primaryContactId },
      { opportunityId: 'nope' },
    ]) {
      rejects(() => crm.tasks.createTask(ctxA, { title: 'X', ...input }), {}, MESSAGES.unavailable);
    }
    rejects(() => crm.tasks.createTask(ctxA, { title: 'X', companyId: '../etc' }), {
      companyId: MESSAGES.unavailable,
    });
  });

  it('isolates organizations on every read and write', () => {
    const task = crm.tasks.createTask(ctxA, { title: 'Samo za A', scheduledStartAt: at('10:00') });
    expect(() => crm.tasks.getTask(ctxB, task.id)).toThrow(CrmNotFoundError);
    expect(() => crm.tasks.completeTask(ctxB, task.id)).toThrow(CrmNotFoundError);
    expect(() => crm.tasks.updateTask(ctxB, task.id, { title: 'Y' })).toThrow(CrmNotFoundError);
    expect(() => crm.customers.getProfile(ctxB, fero.id)).toThrow(CrmNotFoundError);
    expect(crm.tasks.listTasks(ctxB)).toEqual([]);
    expect(crm.calendar.getDay(ctxB, TODAY)).toEqual([]);
    expect(crm.customers.listCustomers(ctxB)).toEqual([]);
  });
});

describe('TaskService · lifecycle (TEST F)', () => {
  it('completes, reopens and cancels; completed tasks stay in the calendar as history', () => {
    const task = crm.tasks.createTask(ctxA, {
      title: 'Poziv',
      companyId: fero.id,
      scheduledStartAt: at('09:00'),
    });
    const done = crm.tasks.completeTask(ctxA, task.id);
    expect(done).toMatchObject({ status: 'completed', completedAt: NOW.toISOString() });
    expect(crm.tasks.completeTask(ctxA, task.id).completedAt).toBe(NOW.toISOString()); // idempotent
    expect(crm.calendar.getDay(ctxA, TODAY).map((t) => t.status)).toEqual(['completed']);
    expect(crm.tasks.sections(ctxA).completed.map((t) => t.id)).toEqual([task.id]);

    expect(crm.tasks.reopenTask(ctxA, task.id)).toMatchObject({
      status: 'open',
      completedAt: null,
    });
    expect(crm.tasks.cancelTask(ctxA, task.id)).toMatchObject({ status: 'cancelled' });
    expect(crm.calendar.getDay(ctxA, TODAY)).toEqual([]);
    rejects(() => crm.tasks.completeTask(ctxA, task.id), {
      status: 'Otkazani zadatak nije moguće dovršiti.',
    });
    expect(crm.repo.data().tasks).toHaveLength(1); // never deleted

    const types = crm.customers.getProfile(ctxA, fero.id).activities.map((a) => a.type);
    expect(types.slice(0, 3)).toEqual(['task_cancelled', 'task_reopened', 'task_completed']);
  });

  it('overdue means open and past its deadline', () => {
    const later = (ctx: CrmContext, hours: number) => ({
      ...ctx,
      now: new Date(NOW.getTime() + hours * 3_600_000),
    });
    const exact = crm.tasks.createTask(ctxA, { title: 'Exact', dueAt: at('12:00') });
    const dated = crm.tasks.createTask(ctxA, { title: 'Dated', dueDate: TODAY });
    expect(crm.tasks.getTask(ctxA, exact.id).overdue).toBe(false);
    expect(crm.tasks.getTask(later(ctxA, 2), exact.id).overdue).toBe(true);
    expect(crm.tasks.getTask(later(ctxA, 12), dated.id).overdue).toBe(false); // 23:00, same day
    expect(crm.tasks.getTask(later(ctxA, 14), dated.id).overdue).toBe(true); // next day in Zagreb
    crm.tasks.completeTask(ctxA, exact.id);
    expect(crm.tasks.getTask(later(ctxA, 2), exact.id).overdue).toBe(false);
  });
});

describe('Priorities and sections', () => {
  it('orders open HIGH first, then overdue, then due today; completed today last', () => {
    const today = crm.tasks.createTask(ctxA, { title: 'Danas', dueDate: TODAY });
    const overdue = crm.tasks.createTask(ctxA, { title: 'Kasni', dueDate: '2026-10-02' });
    const high = crm.tasks.createTask(ctxA, { title: 'Visoko', priority: 'high' });
    const done = crm.tasks.createTask(ctxA, { title: 'Gotovo', dueDate: TODAY });
    crm.tasks.completeTask(ctxA, done.id);
    crm.tasks.createTask(ctxA, { title: 'Kasnije', dueDate: '2026-10-20' });
    crm.tasks.createTask(ctxA, { title: 'Sastanak', scheduledStartAt: at('15:00') }); // calendar only
    expect(crm.tasks.priorities(ctxA).map((t) => [t.title, t.reason])).toEqual([
      [high.title, 'high'],
      [overdue.title, 'overdue'],
      [today.title, 'today'],
      [done.title, 'done'],
    ]);
  });

  it('sorts the Tasks screen into DANAS, NADOLAZEĆE, BEZ DATUMA, DOVRŠENO', () => {
    crm.tasks.createTask(ctxA, { title: 'Jučer', scheduledStartAt: at('10:00', '2026-10-04') });
    crm.tasks.createTask(ctxA, { title: 'Danas 15', scheduledStartAt: at('15:00') });
    crm.tasks.createTask(ctxA, { title: 'Sutra', dueDate: '2026-10-06' });
    crm.tasks.createTask(ctxA, { title: 'Bez datuma' });
    const s = crm.tasks.sections(ctxA);
    expect(s.today.map((t) => t.title)).toEqual(['Jučer', 'Danas 15']);
    expect(s.upcoming.map((t) => t.title)).toEqual(['Sutra']);
    expect(s.unscheduled.map((t) => t.title)).toEqual(['Bez datuma']);
  });
});

describe('CalendarService', () => {
  it('queries explicit ranges: a quarter works, open-ended or huge ranges do not', () => {
    crm.tasks.createTask(ctxA, { title: 'Q4', scheduledStartAt: at('10:00', '2026-11-20') });
    const q4 = crm.calendar.getCalendarTasks(
      ctxA,
      dayRange('2026-10-01', TZ).start,
      dayRange('2026-12-31', TZ).end,
    );
    expect(q4.map((t) => t.title)).toEqual(['Q4']);
    expect(() =>
      crm.calendar.getCalendarTasks(ctxA, new Date('2026-01-01'), new Date('2028-01-01')),
    ).toThrow(CrmValidationError);
    expect(() => crm.calendar.getCalendarTasks(ctxA, NOW, NOW)).toThrow(CrmValidationError);
    expect(() => crm.calendar.getDay(ctxA, '2026-02-31')).toThrow(CrmValidationError);
  });

  it('includes a time range that started before the window', () => {
    crm.tasks.createTask(ctxA, {
      title: 'Preko ponoći',
      scheduledStartAt: at('23:00', '2026-10-04'),
      scheduledEndAt: at('01:00'),
    });
    expect(crm.calendar.getDay(ctxA, TODAY).map((t) => t.title)).toEqual(['Preko ponoći']);
  });

  it('converts wall-clock times across the DST change', () => {
    expect(zonedDateTime('2026-10-25', '09:00', TZ).toISOString()).toBe('2026-10-25T08:00:00.000Z');
    expect(zonedDateTime('2026-10-24', '09:00', TZ).toISOString()).toBe('2026-10-24T07:00:00.000Z');
  });
});

describe('ContactService (TEST D) and OpportunityService (TEST E)', () => {
  it('creates a contact for an existing customer only', () => {
    const contact = crm.contacts.createContact(ctxA, {
      companyId: fero.id,
      fullName: 'Ana Babić',
      role: 'Komercijalistica',
      email: 'ana@fero-term.hr',
    });
    expect(contact).toMatchObject({
      firstName: 'Ana',
      lastName: 'Babić',
      companyId: fero.id,
      isPrimary: false,
    });
    rejects(() => crm.contacts.createContact(ctxA, { fullName: 'X' }), {
      companyId: MESSAGES.customerRequired,
    });
    rejects(() => crm.contacts.createContact(ctxB, { companyId: fero.id, fullName: 'X' }), {
      companyId: MESSAGES.unavailable,
    });
    rejects(
      () => crm.contacts.createContact(ctxA, { companyId: fero.id, fullName: 'X', email: 'x@' }),
      {
        email: 'Neispravna e-mail adresa.',
      },
    );
  });

  it('flags a new opportunity without a next action, and accepts one in the same request', () => {
    const bare = crm.opportunities.createOpportunity(ctxA, {
      companyId: fero.id,
      title: 'Grijanje hale',
      value: '25000,50',
      stage: 'offer_sent',
    });
    expect(bare.nextActionMissing).toBe(true);
    expect(bare.opportunity).toMatchObject({
      value: 25000.5,
      currency: 'EUR',
      status: 'active',
      needsNextAction: true,
    });

    const task = crm.tasks.createTask(ctxA, {
      title: 'Poslati ponudu',
      opportunityId: bare.opportunity.id,
    });
    expect(crm.opportunities.getOpportunity(ctxA, bare.opportunity.id).nextAction?.id).toBe(
      task.id,
    );

    const withNext = crm.opportunities.createOpportunity(ctxA, {
      companyId: fero.id,
      contactId: fero.contactId,
      title: 'Servis',
      nextActionTitle: 'Nazvati Marka',
      nextActionDueDate: '2026-10-07',
    });
    expect(withNext.nextActionMissing).toBe(false);
    expect(withNext.opportunity.nextAction).toMatchObject({
      title: 'Nazvati Marka',
      dueDate: '2026-10-07',
      type: 'follow_up',
      companyId: fero.id,
      contactId: fero.contactId,
    });
  });

  it('requires an existing customer and a contact of that customer', () => {
    rejects(() => crm.opportunities.createOpportunity(ctxA, { title: 'X' }), {
      companyId: MESSAGES.customerRequired,
    });
    rejects(() => crm.opportunities.createOpportunity(ctxB, { title: 'X', companyId: fero.id }), {
      companyId: MESSAGES.unavailable,
    });
    rejects(
      () =>
        crm.opportunities.createOpportunity(ctxA, {
          title: 'X',
          companyId: fero.id,
          contactId: adria.contactId,
        }),
      { contactId: MESSAGES.contactNotOfCustomer },
    );
    rejects(
      () =>
        crm.opportunities.createOpportunity(ctxA, { title: 'X', companyId: fero.id, value: '-5' }),
      {
        value: 'Unesite iznos (npr. 5000 ili 5000,50).',
      },
    );
  });

  it('next action = earliest open task (deadline first, else calendar slot)', () => {
    crm.tasks.createTask(ctxA, {
      title: 'Kasnije',
      opportunityId: fero.oppId,
      scheduledStartAt: at('16:00'),
    });
    crm.tasks.createTask(ctxA, { title: 'Ranije', opportunityId: fero.oppId, dueAt: at('12:00') });
    crm.tasks.createTask(ctxA, { title: 'Bez datuma', opportunityId: fero.oppId });
    expect(crm.opportunities.getOpportunity(ctxA, fero.oppId).nextAction?.title).toBe('Ranije');
  });
});

describe('CustomerService', () => {
  it('searches by name (accent-insensitive) and by OIB prefix', () => {
    expect(crm.customers.listCustomers(ctxA, { q: 'fero' }).map((c) => c.companyName)).toEqual([
      'FERO-TERM d.o.o.',
    ]);
    expect(crm.customers.listCustomers(ctxA, { q: '4829' }).map((c) => c.companyName)).toEqual([
      'Adria Tech d.o.o.',
    ]);
    expect(crm.customers.listCustomers(ctxA, { q: 'LUKAC' })).toEqual([]); // customers, not contacts
    expect(crm.customers.listCustomers(ctxA, { q: 'térm' }).map((c) => c.companyName)).toEqual([
      'FERO-TERM d.o.o.',
    ]);
  });

  it('rejects a duplicate OIB within the organization only', () => {
    rejects(
      () =>
        crm.customers.createCustomer(ctxA, {
          companyName: 'Dupli',
          oib: '60417283915',
          city: 'Rijeka',
          contactName: 'X',
        }),
      { oib: 'Kupac s ovim OIB-om već postoji.' },
    );
    expect(
      crm.customers.createCustomer(ctxB, {
        companyName: 'Dupli',
        oib: '60417283915',
        city: 'Rijeka',
        contactName: 'X',
      }).organizationId,
    ).toBe('org-b');
  });
});

describe('Demo seed', () => {
  it('reproduces the dashboard rows as real, consistent records', () => {
    const data = seedDemoData(ctxA);
    const seeded = createCrmServices(createMemoryRepository(data));
    expect(seeded.calendar.getDay(ctxA, TODAY).map((t) => t.title)).toEqual([
      'Sastanak s Adria Tech',
      'Poziv – Marko Horvat (Initium)',
      'Sastanak s Nova d.o.o.',
      'Interni sync',
    ]);
    expect(seeded.tasks.priorities(ctxA).map((t) => t.title)).toEqual([
      'Poslati ponudu za Adria Tech',
      'Kontaktirati Marka Horvata (Initium)',
      'Pripremiti prezentaciju za Nova d.o.o.',
    ]);
    // Seeded opportunities are already part of the static pipeline numbers.
    expect(seeded.opportunities.pipeline(ctxA).map((s) => s.total)).toEqual([42, 28, 18, 11, 6]);
    expect(seeded.customers.listCustomers(ctxA, { q: 'fero' })[0]?.primaryContactName).toBe(
      'Marko Lukač',
    );
  });
});
