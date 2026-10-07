// Demo data for the BETA: the companies, meetings and priorities the approved
// dashboard showed as static rows, now real records dated relative to "today"
// in the organization's timezone. Built through the services, so seeded data
// obeys the same rules as data entered in the app. Part of it lies in the
// previous quarter (created, held, won and lost back then), so the Home
// dashboard's historical view has real records to show.
import { quarterOf, quarterPeriod, shiftQuarter } from '../../public/app/js/core/period.js';
import { createCrmServices } from './index.ts';
import { createMemoryRepository, emptyData } from './repository.ts';
import { addDays, calendarDateInZone, zonedDateTime } from './time.ts';
import type { CrmContext, CrmData } from './types.ts';

export function seedDemoData(ctx: CrmContext): CrmData {
  const repo = createMemoryRepository(emptyData());
  const crm = createCrmServices(repo);
  const today = calendarDateInZone(ctx.now, ctx.timeZone);
  const at = (day: string, time: string) => zonedDateTime(day, time, ctx.timeZone).toISOString();
  /** The same context at an earlier moment: records made "back then". */
  const then = (day: string, time = '09:00'): CrmContext => ({
    ...ctx,
    now: zonedDateTime(day, time, ctx.timeZone),
  });
  const prev = shiftQuarter(quarterOf(today), -1);
  const lastQuarter = quarterPeriod(prev.year, prev.quarter).startDate;
  const lq = (days: number) => addDays(lastQuarter, days); // a day in the previous quarter

  const customer = (input: Record<string, string>, on?: string) =>
    crm.customers.createCustomer(on ? then(on) : ctx, {
      status: 'active',
      type: 'customer',
      ...input,
    });

  const adria = customer(
    {
      companyName: 'Adria Tech d.o.o.',
      oib: '48291736501',
      address: 'Radnička cesta 80',
      postalCode: '10000',
      city: 'Zagreb',
      email: 'info@adriatech.hr',
      contactName: 'Ivana Kovač',
      contactRole: 'Direktorica nabave',
      contactEmail: 'ivana.kovac@adriatech.hr',
    },
    addDays(lastQuarter, -20),
  );
  const initium = customer(
    {
      companyName: 'Initium d.o.o.',
      oib: '73015529846',
      address: 'Put Supavla 1',
      postalCode: '21000',
      city: 'Split',
      contactName: 'Marko Horvat',
      contactRole: 'Direktor',
      contactPhone: '+385 91 234 5678',
    },
    lq(3),
  );
  const nova = customer(
    {
      companyName: 'Nova d.o.o.',
      oib: '15938274660',
      address: 'Korzo 12',
      postalCode: '51000',
      city: 'Rijeka',
      contactName: 'Petra Novak',
      contactRole: 'Voditeljica prodaje',
    },
    lq(10),
  );
  const feroTerm = customer({
    companyName: 'FERO-TERM d.o.o.',
    oib: '60417283915',
    address: 'Industrijska zona 7',
    postalCode: '31000',
    city: 'Osijek',
    email: 'prodaja@fero-term.hr',
    contactName: 'Marko Lukač',
    contactRole: 'Voditelj nabave',
    contactEmail: 'marko.lukac@fero-term.hr',
  });

  const opportunity = (input: Record<string, unknown>, on?: string) => {
    const { opportunity } = crm.opportunities.createOpportunity(on ? then(on) : ctx, input);
    const row = repo.data().opportunities.find((o) => o.id === opportunity.id);
    if (row) row.seeded = true; // already counted in the dashboard's static pipeline numbers
    return opportunity;
  };
  const adriaDeal = opportunity(
    {
      companyId: adria.id,
      contactId: adria.primaryContactId,
      title: 'CRM licence – 25 korisnika',
      value: '18500',
      stage: 'offer_sent',
      expectedCloseDate: addDays(today, 21),
    },
    lq(20),
  );
  const initiumDeal = opportunity(
    {
      companyId: initium.id,
      contactId: initium.primaryContactId,
      title: 'Implementacija – faza 2',
      value: '42000',
      stage: 'negotiation',
      expectedCloseDate: addDays(today, 30),
    },
    lq(30),
  );
  const novaDeal = opportunity({
    companyId: nova.id,
    title: 'Pilot projekt',
    value: '9800',
    stage: 'in_progress',
  });
  // Deliberately without a next action: shows the "needs attention" state.
  opportunity({
    companyId: feroTerm.id,
    title: 'Oprema za skladište',
    value: '12000',
    stage: 'new',
  });

  const task = (input: Record<string, unknown>) => crm.tasks.createTask(ctx, input);

  // Today's Sales Calendar (the dashboard's "Danas" rows).
  task({
    title: 'Sastanak s Adria Tech',
    type: 'meeting',
    description: 'Demo proizvoda',
    companyId: adria.id,
    contactId: adria.primaryContactId,
    opportunityId: adriaDeal.id,
    scheduledStartAt: at(today, '09:00'),
    scheduledEndAt: at(today, '10:00'),
  });
  task({
    title: 'Poziv – Marko Horvat (Initium)',
    type: 'call',
    description: 'Praćenje ponude',
    companyId: initium.id,
    contactId: initium.primaryContactId,
    opportunityId: initiumDeal.id,
    scheduledStartAt: at(today, '11:00'),
  });
  task({
    title: 'Sastanak s Nova d.o.o.',
    type: 'meeting',
    description: 'Pregled potreba',
    companyId: nova.id,
    opportunityId: novaDeal.id,
    scheduledStartAt: at(today, '14:00'),
    scheduledEndAt: at(today, '15:00'),
  });
  task({
    title: 'Interni sync',
    type: 'general',
    description: 'Tjedni pregled',
    scheduledStartAt: at(today, '16:00'),
    scheduledEndAt: at(today, '16:30'),
  });

  // Priorities.
  task({
    title: 'Poslati ponudu za Adria Tech',
    type: 'send_offer',
    priority: 'high',
    companyId: adria.id,
    opportunityId: adriaDeal.id,
    dueDate: today,
  });
  const prepared = task({
    title: 'Pripremiti prezentaciju za Nova d.o.o.',
    type: 'general',
    companyId: nova.id,
    dueDate: today,
  });
  crm.tasks.completeTask(ctx, prepared.id);
  task({
    title: 'Kontaktirati Marka Horvata (Initium)',
    type: 'call',
    companyId: initium.id,
    contactId: initium.primaryContactId,
    dueDate: today,
  });

  // History, upcoming and undated work.
  const intro = task({
    title: 'Uvodni sastanak – FERO-TERM',
    type: 'meeting',
    companyId: feroTerm.id,
    contactId: feroTerm.primaryContactId,
    scheduledStartAt: at(addDays(today, -1), '15:00'),
    scheduledEndAt: at(addDays(today, -1), '16:00'),
  });
  crm.tasks.completeTask(ctx, intro.id);
  task({
    title: 'Follow-up Initium – ugovor',
    type: 'follow_up',
    companyId: initium.id,
    opportunityId: initiumDeal.id,
    scheduledStartAt: at(addDays(today, 1), '10:00'),
  });
  task({ title: 'Ažurirati cjenik za 2027.', type: 'general', priority: 'low' });

  // ---- The previous quarter: what was held, closed and left undone back then.
  const pastTask = (on: string, time: string, input: Record<string, unknown>) =>
    crm.tasks.createTask(then(addDays(on, -3), time), input).id;
  const done = (id: string, on: string, time: string) => crm.tasks.completeTask(then(on, time), id);
  done(
    pastTask(lq(8), '10:00', {
      title: 'Sastanak s Adria Tech',
      type: 'meeting',
      description: 'Prezentacija rješenja',
      companyId: adria.id,
      contactId: adria.primaryContactId,
      scheduledStartAt: at(lq(8), '10:00'),
      scheduledEndAt: at(lq(8), '11:00'),
    }),
    lq(8),
    '11:05',
  );
  done(
    pastTask(lq(15), '11:00', {
      title: 'Demo proizvoda – Nova d.o.o.',
      type: 'meeting',
      companyId: nova.id,
      contactId: nova.primaryContactId,
      scheduledStartAt: at(lq(15), '11:00'),
      scheduledEndAt: at(lq(15), '12:00'),
    }),
    lq(15),
    '12:10',
  );
  done(
    pastTask(lq(40), '09:00', {
      title: 'Pripremiti ponudu za Initium',
      type: 'send_offer',
      companyId: initium.id,
      opportunityId: initiumDeal.id,
      dueDate: lq(40),
    }),
    lq(39),
    '16:20',
  );
  done(
    pastTask(lq(52), '09:30', {
      title: 'Follow-up Initium – ponuda',
      type: 'follow_up',
      companyId: initium.id,
      contactId: initium.primaryContactId,
      opportunityId: initiumDeal.id,
      scheduledStartAt: at(lq(52), '09:30'),
    }),
    lq(52),
    '09:50',
  );
  const notDone = pastTask(lq(60), '14:00', {
    title: 'Kontaktirati Initium – reference',
    type: 'call',
    companyId: initium.id,
    dueDate: lq(60),
  });
  crm.tasks.cancelTask(then(lq(62)), notDone);
  opportunity(
    {
      companyId: adria.id,
      contactId: adria.primaryContactId,
      title: 'Servisni ugovor 2026',
      value: '8400',
      stage: 'closing',
      status: 'won',
    },
    lq(45),
  );
  opportunity(
    {
      companyId: nova.id,
      title: 'Proširenje licenci',
      value: '6000',
      stage: 'negotiation',
      status: 'lost',
    },
    lq(70),
  );

  return repo.data();
}
