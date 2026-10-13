// MOBILNE OBAVIJESTI: per-user preferences and the seven event types, each
// delivered exactly once, prospectively, only while switched on.
import { createECDH } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCrmServices, type CrmServices } from '../src/crm/index.ts';
import { STALE_MS } from '../src/crm/notification-service.ts';
import { inspectPdfWithPdfJs } from '../src/crm/pdf-inspect.ts';
import { createMemoryDocumentStore } from '../src/crm/document-store.ts';
import { createMemoryRepository, emptyData, normalizeData } from '../src/crm/repository.ts';
import { deriveShareKey } from '../src/crm/share-token.ts';
import type { CrmContext } from '../src/crm/types.ts';
import { createReminderScheduler } from '../src/notifications/reminder-scheduler.ts';
import type { PushSender } from '../src/notifications/web-push.ts';
import { makePdf } from './pdf-fixture.ts';

/** A browser's push keys (P-256 public key, 16-byte auth secret). */
function device() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: Buffer.from('0123456789abcdef').toString('base64url'),
  };
}

const TZ = 'Europe/Zagreb';
const ctxA: CrmContext = {
  organizationId: 'org-a',
  user: { id: 'user-a', displayName: 'Ana' },
  timeZone: TZ,
  now: new Date('2026-10-05T07:00:00Z'),
};
const colleague: CrmContext = { ...ctxA, user: { id: 'user-c', displayName: 'Cvita' } };
const ctxB: CrmContext = {
  ...ctxA,
  organizationId: 'org-b',
  user: { id: 'user-b', displayName: 'Bo' },
};
const at = (iso: string, base = ctxA): CrmContext => ({ ...base, now: new Date(iso) });
const HUMAN = {
  method: 'GET',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  purpose: null,
};
const silent = { info() {}, warn() {}, error() {} };

let crm: CrmServices;
let clock: Date;
let sent: Array<{ endpoint: string; payload: Record<string, unknown> }>;
let fero: string;
let feroDeal: string;

function scheduler(configured = true) {
  const sender: PushSender = {
    configured,
    publicKey: configured ? 'BPub' : null,
    async send(d, payload) {
      sent.push({ endpoint: d.endpoint, payload: payload as Record<string, unknown> });
      return { ok: true };
    },
  };
  return createReminderScheduler({ services: crm, sender, logger: silent, now: () => clock });
}
const subscribe = (ctx: CrmContext, n: number) =>
  crm.pushSubscriptions.subscribe(ctx, {
    endpoint: `https://push.example/${ctx.user.id}-${n}`,
    keys: { p256dh: device().p256dh, auth: device().auth },
  });
const deliveries = () => crm.repo.data().notificationDeliveries;
const enable = (ctx: CrmContext, ...types: string[]) =>
  crm.notifications.update(ctx, {
    preferences: Object.fromEntries(types.map((t) => [t, true])),
  });

async function sharedOffer(ctx: CrmContext, title = 'Vending aparat') {
  const staged = await crm.followUp.stageUpload(ctx, {
    bytes: makePdf('Ponuda'),
    fileName: 'Ponuda.pdf',
    contentType: 'application/pdf',
  });
  return crm.followUp.createOffer(ctx, {
    uploadId: staged.uploadId,
    title,
    companyId: fero,
    opportunityId: feroDeal,
  });
}

beforeEach(() => {
  crm = createCrmServices(createMemoryRepository(emptyData()), {
    demoContent: false,
    followUp: {
      documents: createMemoryDocumentStore(),
      inspectPdf: inspectPdfWithPdfJs,
      shareKey: deriveShareKey('test-secret-'.repeat(4)),
    },
  });
  clock = ctxA.now;
  sent = [];
  const c = crm.customers.createCustomer(at('2026-09-01T08:00:00Z'), {
    companyName: 'FERO-TERM d.o.o.',
    oib: '60417283915',
    city: 'Osijek',
    contactName: 'Marko',
  });
  fero = c.id;
  feroDeal = crm.opportunities.createOpportunity(at('2026-09-02T08:00:00Z'), {
    companyId: fero,
    title: 'Vending projekt',
    value: '12000',
  }).opportunity.id;
});

describe('Preferences: per user, persisted, validated', () => {
  it('all seven are off for a new user; each switches on its own', () => {
    const fresh = crm.notifications.preferences(ctxA);
    expect(Object.values(fresh.preferences)).toEqual(Array(7).fill(false));
    expect(Object.keys(fresh.preferences)).toEqual([
      'offer_viewed',
      'reminder_due',
      'task_deadline',
      'opportunity_deadline',
      'feedback_low',
      'feedback_medium',
      'feedback_high',
    ]);
    const after = crm.notifications.update(ctxA, {
      preferences: { offer_viewed: true, opportunity_deadline: false },
    });
    expect(after.preferences).toMatchObject({ offer_viewed: true, opportunity_deadline: false });
    expect(Object.values(after.preferences).filter(Boolean)).toHaveLength(1);
  });

  it('a toggle is an upsert (no duplicates); enabledAt from the server clock, kept when off', () => {
    crm.notifications.update(at('2026-10-05T08:00:00Z'), { preferences: { feedback_high: true } });
    crm.notifications.update(at('2026-10-05T09:00:00Z'), { preferences: { feedback_high: true } });
    crm.notifications.update(at('2026-10-05T10:00:00Z'), { preferences: { feedback_high: false } });
    const rows = crm.repo.data().notificationPreferences.filter((p) => p.type === 'feedback_high');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ enabled: false, enabledAt: '2026-10-05T08:00:00.000Z' });
    crm.notifications.update(at('2026-10-05T11:00:00Z'), { preferences: { feedback_high: true } });
    expect(rows[0]).toMatchObject({ enabled: true, enabledAt: '2026-10-05T11:00:00.000Z' });
  });

  it('two salespeople of one organization choose independently; another organization sees nothing', () => {
    enable(ctxA, 'offer_viewed', 'task_deadline', 'feedback_high');
    enable(colleague, 'task_deadline');
    expect(crm.notifications.preferences(ctxA).preferences).toMatchObject({
      offer_viewed: true,
      task_deadline: true,
      feedback_high: true,
    });
    expect(crm.notifications.preferences(colleague).preferences).toMatchObject({
      offer_viewed: false,
      task_deadline: true,
      feedback_high: false,
    });
    expect(Object.values(crm.notifications.preferences(ctxB).preferences)).toEqual(
      Array(7).fill(false),
    );
  });

  it('refuses unknown types, non-boolean values and a malformed time; saves a valid time', () => {
    const refuses = (input: Record<string, unknown>, field: string) => {
      expect(() => crm.notifications.update(ctxA, input)).toThrow();
      try {
        crm.notifications.update(ctxA, input);
      } catch (error) {
        expect((error as { errors: Record<string, string> }).errors).toHaveProperty(field);
      }
    };
    refuses({ preferences: { push_everything: true } }, 'preferences');
    refuses({ preferences: { offer_viewed: 'yes' } }, 'offer_viewed');
    refuses({ deadlineTime: '25:00' }, 'deadlineTime');
    refuses({ deadlineTime: '8h' }, 'deadlineTime');
    expect(crm.repo.data().notificationPreferences).toHaveLength(0);
    expect(crm.notifications.update(ctxA, { deadlineTime: '08:00' }).deadlineTime).toBe('08:00');
    expect(crm.notifications.update(ctxA, { deadlineTime: null }).deadlineTime).toBeNull();
  });

  it('older data: a user with reminders still to fire keeps "Podsjetnik" on; nobody else', () => {
    const before = emptyData() as Partial<ReturnType<typeof emptyData>>;
    delete before.notificationPreferences;
    const reminder = (user: string, status: string) => ({
      id: `r-${user}-${status}`,
      organizationId: 'org-a',
      recipientUserId: user,
      status,
    });
    const data = normalizeData({
      ...before,
      reminders: [
        reminder('user-a', 'pending'),
        reminder('user-a', 'pending'),
        reminder('user-c', 'sent'),
      ] as never,
    });
    expect(data.notificationPreferences.map((p) => [p.userId, p.type, p.enabled])).toEqual([
      ['user-a', 'reminder_due', true],
    ]);
    // Saved data is not seeded again.
    expect(normalizeData({ ...data, notificationPreferences: [] }).notificationPreferences).toEqual(
      [],
    );
  });
});

describe('01 Pregled ponude: qualifying views only, engagement kept', () => {
  it("a customer view notifies the offer's salesperson once per 30 minutes; previews and scanners never", async () => {
    enable(ctxA, 'offer_viewed');
    const { offerId, token } = await sharedOffer(at('2026-10-05T07:30:00Z'));
    const view = (session: string, when: string, internal = false, signals = HUMAN) =>
      crm.followUp.recordView(token, { sessionId: session }, signals, new Date(when), internal);
    expect(await view('session-aaaaaaaaaaaa1', '2026-10-05T08:00:00Z', true)).toBe('internal');
    await view('session-aaaaaaaaaaaa2', '2026-10-05T08:01:00Z', false, {
      ...HUMAN,
      userAgent: 'Mozilla/5.0 (compatible; Barracuda Sentinel)',
    });
    expect(deliveries()).toHaveLength(0);
    expect(await view('session-aaaaaaaaaaaa3', '2026-10-05T08:02:00Z')).toBe('recorded');
    expect(await view('session-aaaaaaaaaaaa4', '2026-10-05T08:20:00Z')).toBe('recorded');
    expect(deliveries()).toHaveLength(1);
    expect(deliveries()[0]).toMatchObject({
      recipientUserId: 'user-a',
      type: 'offer_viewed',
      title: 'RENVARA — Ponuda pregledana',
      body: 'Zabilježen je novi pregled ponude za FERO-TERM d.o.o.: Vending aparat',
      url: `/follow-up/${offerId}`,
      status: 'pending',
    });
    expect(JSON.stringify(deliveries())).not.toContain(token);
    expect(await view('session-aaaaaaaaaaaa5', '2026-10-05T08:40:00Z')).toBe('recorded');
    expect(deliveries()).toHaveLength(2);
    // Every qualifying view is still counted.
    expect(crm.followUp.engagement(ctxA, offerId).viewCount).toBe(3);
  });

  it('switched off: no notification, the view is still recorded', async () => {
    const { offerId, token } = await sharedOffer(at('2026-10-05T07:30:00Z'));
    await crm.followUp.recordView(
      token,
      { sessionId: 'session-bbbbbbbbbbbb1' },
      HUMAN,
      new Date('2026-10-05T08:00:00Z'),
      false,
    );
    expect(deliveries()).toHaveLength(0);
    expect(crm.followUp.engagement(ctxA, offerId).viewCount).toBe(1);
  });

  it('the in-browser demo queues nothing (it cannot deliver)', async () => {
    const demo = createCrmServices(createMemoryRepository(emptyData()), {
      demoContent: false,
      notificationDelivery: false,
    });
    demo.notifications.update(ctxA, { preferences: { task_deadline: true } });
    demo.tasks.createTask(ctxA, { title: 'X', dueAt: '2026-10-05T07:30:00Z' });
    expect(demo.notifications.collectDue(new Date('2026-10-05T07:31:00Z'))).toBe(0);
    expect(demo.notifications.preferences(ctxA).preferences.task_deadline).toBe(true);
  });
});

describe('03 Rok zadatka and 04 Rok prilike', () => {
  it('an open task is notified once at its deadline; a completed one never', async () => {
    enable(ctxA, 'task_deadline');
    subscribe(ctxA, 1);
    const run = scheduler();
    const task = crm.tasks.createTask(ctxA, {
      title: 'Poslati ponudu FERO-TERM',
      dueAt: '2026-10-05T12:00:00Z',
    });
    const done = crm.tasks.createTask(ctxA, { title: 'Gotovo', dueAt: '2026-10-05T12:00:00Z' });
    crm.tasks.completeTask(at('2026-10-05T11:00:00Z'), done.id);
    clock = new Date('2026-10-05T11:59:00Z');
    await run.tick();
    expect(sent).toHaveLength(0);
    clock = new Date('2026-10-05T12:00:20Z');
    await run.tick();
    clock = new Date('2026-10-05T12:00:50Z');
    await run.tick();
    expect(sent.map((s) => s.payload)).toEqual([
      {
        title: 'RENVARA — Rok zadatka',
        body: 'Vrijeme je za izvršenje zadatka: Poslati ponudu FERO-TERM',
        url: `/tasks/${task.id}`,
        tag: `task_deadline-${task.id}`,
      },
    ]);
    expect(deliveries()[0]).toMatchObject({ status: 'sent', devicesAccepted: 1 });
  });

  it('a date-only deadline needs the chosen time: none without it, that time with it', async () => {
    enable(ctxA, 'task_deadline');
    subscribe(ctxA, 1);
    const run = scheduler();
    crm.tasks.createTask(ctxA, { title: 'Samo datum', dueDate: '2026-10-06' });
    clock = new Date('2026-10-06T10:00:00Z');
    await run.tick();
    expect(sent).toHaveLength(0); // no time was ever assumed
    crm.notifications.update(at('2026-10-06T10:00:00Z'), { deadlineTime: '14:00' });
    clock = new Date('2026-10-06T11:59:00Z'); // 13:59 in Zagreb
    await run.tick();
    expect(sent).toHaveLength(0);
    clock = new Date('2026-10-06T12:00:10Z'); // 14:00 in Zagreb
    await run.tick();
    expect(sent.map((s) => s.payload.body)).toEqual([
      'Vrijeme je za izvršenje zadatka: Samo datum',
    ]);
  });

  it('completing the task before a queued notification goes out cancels it', async () => {
    enable(ctxA, 'task_deadline');
    const task = crm.tasks.createTask(ctxA, { title: 'X', dueAt: '2026-10-05T12:00:00Z' });
    crm.notifications.collectDue(new Date('2026-10-05T12:00:05Z'));
    expect(deliveries()).toHaveLength(1);
    crm.tasks.completeTask(at('2026-10-05T12:00:10Z'), task.id);
    expect(crm.notifications.claimDue(new Date('2026-10-05T12:00:20Z'))).toHaveLength(0);
    expect(deliveries()[0]).toMatchObject({ status: 'cancelled', lastError: 'no_longer_due' });
  });

  it('an active opportunity on its expected close date at the chosen time; won before: none', async () => {
    enable(ctxA, 'opportunity_deadline');
    crm.notifications.update(ctxA, { deadlineTime: '09:00' });
    subscribe(ctxA, 1);
    const run = scheduler();
    const deal = crm.opportunities.createOpportunity(ctxA, {
      companyId: fero,
      title: 'Vending projekt 2',
      expectedCloseDate: '2026-10-07',
    }).opportunity;
    const won = crm.opportunities.createOpportunity(ctxA, {
      companyId: fero,
      title: 'Već dobivena',
      expectedCloseDate: '2026-10-07',
    }).opportunity;
    crm.opportunities.closeOpportunity(at('2026-10-06T10:00:00Z'), won.id, { outcome: 'won' });
    clock = new Date('2026-10-07T07:00:30Z'); // 09:00 in Zagreb
    await run.tick();
    expect(sent.map((s) => s.payload)).toEqual([
      {
        title: 'RENVARA — Rok prilike',
        body: 'Dosegnut je rok za priliku: Vending projekt 2 (očekivani datum zatvaranja)',
        url: `/customers/${fero}#prilike`,
        tag: `opportunity_deadline-${deal.id}`,
      },
    ]);
  });
});

describe('05–07 Feedback Overview bands (1–4D, 5–9D, 10D+)', () => {
  async function sentOffer(when: string) {
    const offer = await sharedOffer(at(when));
    crm.followUp.markSent(at(when), offer.offerId, {});
    return offer;
  }
  /** One scheduler run at noon (Zagreb) every day for `days` days, from the sending day. */
  async function daily(run: ReturnType<typeof scheduler>, from: string, days: number) {
    for (let i = 0; i < days; i += 1) {
      clock = new Date(Date.parse(from) + i * 86_400_000);
      await run.tick();
    }
  }

  it('TEST G: only medium and high on → one at 5D, one at 10D, nothing at 1D or in between', async () => {
    enable(ctxA, 'feedback_medium', 'feedback_high');
    subscribe(ctxA, 1);
    const run = scheduler();
    const { offerId } = await sentOffer('2026-10-05T07:30:00Z');
    clock = new Date('2026-10-05T07:31:00Z');
    await run.tick();
    await daily(run, '2026-10-06T10:00:00Z', 12); // 2D … 13D
    expect(sent.map((s) => [s.payload.title, s.payload.body])).toEqual([
      ['RENVARA — Follow-up prioritet', 'FERO-TERM d.o.o. čeka odgovor na ponudu već 5 dana.'],
      [
        'RENVARA — Visoki follow-up prioritet',
        'Ponuda za FERO-TERM d.o.o. čeka odgovor 10 dana. Potreban follow-up.',
      ],
    ]);
    expect(sent.every((s) => s.payload.url === `/follow-up/${offerId}`)).toBe(true);
    expect(deliveries().map((d) => d.occurredAt)).toEqual([
      '2026-10-09T07:30:00.000Z',
      '2026-10-14T07:30:00.000Z',
    ]);
  });

  it('TEST N: all three on → 1D, 5D, 10D once each; never repeated inside a band', async () => {
    enable(ctxA, 'feedback_low', 'feedback_medium', 'feedback_high');
    subscribe(ctxA, 1);
    const run = scheduler();
    await sentOffer('2026-10-05T07:30:00Z');
    clock = new Date('2026-10-05T07:30:20Z');
    await run.tick();
    await daily(run, '2026-10-06T07:31:00Z', 14);
    expect(sent.map((s) => s.payload.body)).toEqual([
      'Ponuda za FERO-TERM d.o.o. čeka odgovor 1 dan.',
      'FERO-TERM d.o.o. čeka odgovor na ponudu već 5 dana.',
      'Ponuda za FERO-TERM d.o.o. čeka odgovor 10 dana. Potreban follow-up.',
    ]);
  });

  it('answered before 10D: no high notification; a draft never notifies', async () => {
    enable(ctxA, 'feedback_low', 'feedback_medium', 'feedback_high');
    subscribe(ctxA, 1);
    const run = scheduler();
    const { offerId } = await sentOffer('2026-10-05T07:30:00Z');
    await sharedOffer(at('2026-10-05T07:40:00Z'), 'Nacrt');
    clock = new Date('2026-10-05T07:30:20Z');
    await run.tick();
    await daily(run, '2026-10-06T10:00:00Z', 4); // to 5D
    crm.followUp.markAnswered(at('2026-10-10T10:00:00Z'), offerId);
    await daily(run, '2026-10-10T11:00:00Z', 6); // 6D … 11D
    expect(sent.map((s) => s.payload.title)).toEqual([
      'RENVARA — Feedback Overview',
      'RENVARA — Follow-up prioritet',
    ]);
  });
});

describe('Prospective, deduplicated, isolated', () => {
  it('switching a type on does not send what happened before; a late server skips stale events', async () => {
    subscribe(ctxA, 1);
    const run = scheduler();
    crm.tasks.createTask(ctxA, { title: 'Ranije', dueAt: '2026-10-05T08:00:00Z' });
    clock = new Date('2026-10-05T09:00:00Z');
    enable(at('2026-10-05T09:00:00Z'), 'task_deadline');
    await run.tick();
    expect(sent).toHaveLength(0);
    crm.tasks.createTask(ctxA, { title: 'Davno', dueAt: '2026-10-05T10:00:00Z' });
    clock = new Date(Date.parse('2026-10-05T10:00:00Z') + STALE_MS + 60_000);
    await run.tick();
    expect(sent).toHaveLength(0);
  });

  it('a preference switched off before sending cancels the queued notification', async () => {
    enable(ctxA, 'task_deadline');
    subscribe(ctxA, 1);
    const run = scheduler();
    crm.tasks.createTask(ctxA, { title: 'X', dueAt: '2026-10-05T12:00:00Z' });
    crm.notifications.collectDue(new Date('2026-10-05T12:00:05Z'));
    crm.notifications.update(at('2026-10-05T12:00:06Z'), { preferences: { task_deadline: false } });
    clock = new Date('2026-10-05T12:00:20Z');
    await run.tick();
    expect(sent).toHaveLength(0);
    expect(deliveries()[0]!.status).toBe('cancelled');
  });

  it('no device or no push keys: recorded as not delivered, never "sent"', async () => {
    enable(ctxA, 'task_deadline');
    crm.tasks.createTask(ctxA, { title: 'X', dueAt: '2026-10-05T12:00:00Z' });
    clock = new Date('2026-10-05T12:00:10Z');
    await scheduler().tick();
    expect(deliveries()[0]).toMatchObject({
      status: 'failed',
      lastError: 'no_device',
      acceptedAt: null,
    });
    crm.tasks.createTask(ctxA, { title: 'Y', dueAt: '2026-10-05T12:01:00Z' });
    subscribe(ctxA, 1);
    clock = new Date('2026-10-05T12:01:10Z');
    await scheduler(false).tick();
    expect(deliveries()[1]).toMatchObject({ status: 'failed', lastError: 'push_not_configured' });
    expect(sent).toHaveLength(0);
  });

  it("only the recipient's own devices in the record's organization", async () => {
    enable(ctxA, 'task_deadline');
    enable(colleague, 'task_deadline');
    subscribe(ctxA, 1);
    subscribe(colleague, 1);
    subscribe({ ...ctxB, user: ctxA.user }, 9); // same person, another organization
    const run = scheduler();
    crm.tasks.createTask(ctxA, { title: 'Anin zadatak', dueAt: '2026-10-05T12:00:00Z' });
    clock = new Date('2026-10-05T12:00:10Z');
    await run.tick();
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/user-a-1']);
  });
});
