import { describe, expect, it } from 'vitest';
import { DEMO_CUSTOMER } from '../public/app/js/core/constants.js';
import { createCrmStore, ValidationError } from '../public/app/js/core/store.js';

const actor = { id: 'beta-fgregov', displayName: 'Frane Gregov' };

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function setup() {
  const storage = memoryStorage();
  let t = Date.UTC(2026, 9, 5, 12, 32, 0);
  let n = 0;
  const options = {
    storage,
    now: () => new Date((t += 1000)),
    uuid: () => `id_${String(++n).padStart(3, '0')}`,
  };
  return { storage, options, store: createCrmStore(options) };
}

describe('createCustomer', () => {
  it('creates TVRTKA 1 d.o.o with its primary contact and a "Kupac kreiran" activity', () => {
    const { store } = setup();
    const customer = store.createCustomer({ ...DEMO_CUSTOMER }, actor);

    expect(customer).toMatchObject({
      companyName: 'TVRTKA 1 d.o.o',
      oib: '5874164198',
      address: 'Ulica 1',
      postalCode: '51000',
      city: 'Rijeka',
      status: 'active',
      type: 'customer',
      ownerId: 'beta-fgregov',
    });
    expect(customer.id).toMatch(/^id_/);

    const profile = store.getProfile(customer.id)!;
    expect(profile.primaryContact).toMatchObject({
      firstName: 'Alen',
      lastName: 'Horvat',
      role: 'Odgovorna osoba',
      isPrimary: true,
    });
    expect(profile.activities).toHaveLength(1);
    expect(profile.activities[0]).toMatchObject({
      type: 'customer_created',
      title: 'Kupac kreiran',
      description: 'TVRTKA 1 d.o.o dodana u CRM.',
    });
  });

  it("stores company e-mail/phone and the contact person's function, e-mail and phone", () => {
    const { store } = setup();
    const { id } = store.createCustomer(
      {
        ...DEMO_CUSTOMER,
        email: 'info@tvrtka1.hr',
        phone: '+385 51 000 000',
        contactRole: 'Direktor',
        contactEmail: 'alen@tvrtka1.hr',
        contactPhone: '+385 91 000 000',
      },
      actor,
    );
    const profile = store.getProfile(id)!;
    expect(profile).toMatchObject({ email: 'info@tvrtka1.hr', phone: '+385 51 000 000' });
    expect(profile.primaryContact).toMatchObject({
      role: 'Direktor',
      email: 'alen@tvrtka1.hr',
      phone: '+385 91 000 000',
    });
    expect(() =>
      store.createCustomer({ ...DEMO_CUSTOMER, oib: '1', contactEmail: 'nije-email' }, actor),
    ).toThrow(ValidationError);
  });

  it('persists across store instances (page navigation / reload)', () => {
    const { store, options } = setup();
    const { id } = store.createCustomer({ ...DEMO_CUSTOMER }, actor);
    const reopened = createCrmStore(options);
    expect(reopened.getProfile(id)?.companyName).toBe('TVRTKA 1 d.o.o');
  });

  it('rejects missing required fields and non-digit OIB', () => {
    const { store } = setup();
    try {
      store.createCustomer({ companyName: ' ', oib: '58A', city: '', contactName: '' }, actor);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(Object.keys((error as ValidationError).errors).sort()).toEqual([
        'city',
        'companyName',
        'contactName',
        'oib',
      ]);
      expect((error as ValidationError).errors.oib).toBe('OIB smije sadržavati samo znamenke.');
    }
    expect(store.listCustomers()).toHaveLength(0);
  });

  it('refuses a second customer with the same OIB', () => {
    const { store } = setup();
    store.createCustomer({ ...DEMO_CUSTOMER }, actor);
    expect(() => store.createCustomer({ ...DEMO_CUSTOMER, companyName: 'Kopija' }, actor)).toThrow(
      ValidationError,
    );
  });
});

describe('customer follow-up actions', () => {
  it('links meeting, opportunity and task to the customer and logs them newest first', () => {
    const { store } = setup();
    const { id } = store.createCustomer({ ...DEMO_CUSTOMER }, actor);
    const profileBefore = store.getProfile(id)!;

    const meeting = store.scheduleMeeting(
      {
        customerId: id,
        contactId: profileBefore.primaryContact!.id,
        title: 'Prezentacija',
        date: '2026-10-05',
        time: '15:00',
        durationMinutes: '60',
        mode: 'in_person',
        location: 'Ulica 1, 51000 Rijeka',
        notes: '',
      },
      actor,
    );
    const opportunity = store.createOpportunity(
      {
        customerId: id,
        title: 'Opremanje ureda',
        value: '12000',
        stage: 'new',
        probability: '10',
        expectedCloseDate: '2026-11-04',
        notes: '',
      },
      actor,
    );
    const task = store.createTask(
      { customerId: id, title: 'Poslati ponudu', dueDate: '2026-10-06', priority: 'high' },
      actor,
    );
    store.toggleTask(task.id, actor);

    const profile = store.getProfile(id)!;
    expect(profile.meetings.map((m: { id: string }) => m.id)).toEqual([meeting.id]);
    expect(profile.opportunities[0]).toMatchObject({
      id: opportunity.id,
      customerId: id,
      value: 12000,
      stage: 'new',
      status: 'open',
    });
    expect(profile.tasks[0]).toMatchObject({ status: 'completed' });
    expect(profile.activities.map((a: { type: string }) => a.type)).toEqual([
      'task_completed',
      'task_created',
      'opportunity_created',
      'meeting_scheduled',
      'customer_created',
    ]);

    expect(store.listMeetings()[0]).toMatchObject({
      customerName: 'TVRTKA 1 d.o.o',
      title: 'Prezentacija',
    });
    expect(store.listOpportunities()[0]).toMatchObject({ customerName: 'TVRTKA 1 d.o.o' });
  });

  it('adds new opportunities on top of the dashboard pipeline totals', () => {
    const { store } = setup();
    const { id } = store.createCustomer({ ...DEMO_CUSTOMER }, actor);
    expect(store.pipelineTotals()[0]).toMatchObject({ value: 'new', total: 42, created: 0 });
    store.createOpportunity({ customerId: id, title: 'Opremanje ureda', stage: 'new' }, actor);
    expect(store.pipelineTotals()[0]).toMatchObject({ total: 43, created: 1 });
  });

  it('rejects actions for unknown customers and invalid input', () => {
    const { store } = setup();
    expect(() => store.createOpportunity({ customerId: 'nope', title: 'X' }, actor)).toThrow(
      ValidationError,
    );
    const { id } = store.createCustomer({ ...DEMO_CUSTOMER }, actor);
    expect(() =>
      store.scheduleMeeting(
        { customerId: id, title: '', date: '', time: '', durationMinutes: '60' },
        actor,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      store.createOpportunity({ customerId: id, title: 'X', probability: '120' }, actor),
    ).toThrow(ValidationError);
  });

  it('generates unique ids and can reset the demo data', () => {
    const { store } = setup();
    const a = store.createCustomer({ ...DEMO_CUSTOMER }, actor);
    const b = store.createCustomer(
      { ...DEMO_CUSTOMER, companyName: 'TVRTKA 2 d.o.o', oib: '12345678901' },
      actor,
    );
    expect(a.id).not.toBe(b.id);
    store.reset();
    expect(store.listCustomers()).toEqual([]);
  });
});
