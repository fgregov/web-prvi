// Push reminders: Web Push encryption (RFC 8291 known answer), VAPID (RFC 8292),
// the sender's outcomes, and server-side scheduling: due → sent once, moved,
// cancelled, retried, devices that are gone. Ends with a real HTTP round trip
// to a local push service that decrypts what it receives.
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createCrmApi } from '../src/crm/dispatch.ts';
import { createCrmServices } from '../src/crm/index.ts';
import { createMemoryRepository, emptyData } from '../src/crm/repository.ts';
import type { CrmContext } from '../src/crm/types.ts';
import type { Logger } from '../src/app.ts';
import { createReminderScheduler } from '../src/notifications/reminder-scheduler.ts';
import {
  createWebPushSender,
  encryptPayload,
  generateVapidKeys,
  loadVapidKeys,
  PushConfigError,
  vapidAuthorization,
  type PushSender,
} from '../src/notifications/web-push.ts';

const b64 = (value: string) => Buffer.from(value, 'base64url');

/** RFC 8291 decryption, as the browser does it (independent of encryptPayload). */
function decrypt(body: Buffer, uaPrivate: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, info, 32));
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  expect(plain.at(-1)).toBe(2); // last-record delimiter
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

function device() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = Buffer.from('0123456789abcdef');
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: auth.toString('base64url'),
    privateKey: ecdh.getPrivateKey(),
    authSecret: auth,
  };
}

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

describe('Web Push protocol', () => {
  it('encrypts exactly as RFC 8291, Appendix A (known answer)', () => {
    const body = encryptPayload(
      Buffer.from('When I grow up, I want to be a watermelon'),
      {
        p256dh:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      {
        salt: b64('DGv6ra1nlYgDCS1FRnbzlw'),
        serverPrivateKey: b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
      },
    );
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('a device decrypts its payload with its own keys', () => {
    const d = device();
    const body = encryptPayload(Buffer.from('{"title":"RENVARA — Zadatak"}'), d);
    expect(decrypt(body, d.privateKey, d.authSecret)).toBe('{"title":"RENVARA — Zadatak"}');
  });

  it('signs a VAPID token the push service can verify (RFC 8292)', () => {
    const keys = { ...generateVapidKeys(), subject: 'mailto:ops@renvara.test' };
    const header = vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      keys,
      new Date('2026-10-09T10:00:00Z'),
    );
    const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = token!.split('.');
    expect(JSON.parse(b64(c!).toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Date.parse('2026-10-09T22:00:00Z') / 1000,
      sub: 'mailto:ops@renvara.test',
    });
    const pub = b64(keys.publicKey);
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: pub.subarray(1, 33).toString('base64url'),
        y: pub.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(
      verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, b64(s!)),
    ).toBe(true);
  });

  it('VAPID keys: all three or none; never half configured', () => {
    expect(loadVapidKeys({})).toBeNull();
    expect(() => loadVapidKeys({ RENVARA_VAPID_PUBLIC_KEY: 'x' })).toThrow(PushConfigError);
    const keys = generateVapidKeys();
    expect(() =>
      loadVapidKeys({
        RENVARA_VAPID_PUBLIC_KEY: keys.publicKey,
        RENVARA_VAPID_PRIVATE_KEY: keys.privateKey,
        RENVARA_VAPID_SUBJECT: 'ops@renvara.test',
      }),
    ).toThrow(PushConfigError);
  });

  it('maps push service answers: delivered, gone, retry later', async () => {
    const keys = { ...generateVapidKeys(), subject: 'mailto:ops@renvara.test' };
    const d = { ...device(), endpoint: 'https://push.example/x' };
    const answer = (status: number) =>
      createWebPushSender(keys, { fetchImpl: async () => new Response(null, { status }) });
    expect(await answer(201).send(d, { a: 1 })).toEqual({ ok: true });
    expect(await answer(410).send(d, {})).toMatchObject({
      ok: false,
      gone: true,
      retryable: false,
    });
    expect(await answer(503).send(d, {})).toMatchObject({
      ok: false,
      gone: false,
      retryable: true,
    });
    const offline = createWebPushSender(keys, {
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(await offline.send(d, {})).toMatchObject({ ok: false, retryable: true });
    expect(await createWebPushSender(null).send(d, {})).toMatchObject({
      ok: false,
      error: 'push_not_configured',
    });
  });
});

describe('Reminder scheduling', () => {
  const NOW = new Date('2026-10-09T10:00:00Z');
  const ctx: CrmContext = {
    organizationId: 'org-a',
    user: { id: 'u-a', displayName: 'Ana' },
    timeZone: 'Europe/Zagreb',
    now: NOW,
  };

  function setup(outcomes: Array<'ok' | 'gone' | 'retry' | 'fail'> = []) {
    const crm = createCrmServices(createMemoryRepository(emptyData()), { demoContent: false });
    const sent: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];
    let clock = NOW;
    const sender: PushSender = {
      configured: true,
      publicKey: 'BPub',
      async send(d, payload) {
        sent.push({ endpoint: d.endpoint, payload: payload as Record<string, unknown> });
        const outcome = outcomes.shift() ?? 'ok';
        if (outcome === 'ok') return { ok: true };
        return {
          ok: false,
          gone: outcome === 'gone',
          retryable: outcome === 'retry',
          error: `push_${outcome}`,
        };
      },
    };
    const scheduler = createReminderScheduler({
      services: crm,
      sender,
      logger: silent,
      now: () => clock,
    });
    const subscribe = (n: number) =>
      crm.pushSubscriptions.subscribe(ctx, {
        endpoint: `https://push.example/device-${n}`,
        keys: { p256dh: device().p256dh, auth: device().auth },
      });
    return {
      crm,
      sent,
      scheduler,
      subscribe,
      at: (iso: string) => {
        clock = new Date(iso);
      },
    };
  }

  it('delivers a due task reminder to every device, exactly once', async () => {
    const { crm, sent, scheduler, subscribe, at } = setup();
    subscribe(1);
    subscribe(2);
    const task = crm.tasks.createTask(ctx, { title: 'Poslati ponudu' });
    crm.reminders.setReminder(ctx, { kind: 'task', id: task.id }, '2026-10-10T07:00:00Z');
    expect(await scheduler.tick()).toBe(0); // not due yet
    at('2026-10-10T07:00:20Z');
    expect(await scheduler.tick()).toBe(1);
    expect(sent.map((s) => s.endpoint)).toEqual([
      'https://push.example/device-1',
      'https://push.example/device-2',
    ]);
    expect(sent[0]!.payload).toEqual({
      title: 'RENVARA — Zadatak',
      body: 'Poslati ponudu',
      url: `/tasks/${task.id}`,
      tag: expect.stringMatching(/^reminder-/),
    });
    expect(await scheduler.tick()).toBe(0); // no duplicate
    expect(crm.repo.data().reminders[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('lead and opportunity reminders name the record, without notes', async () => {
    const { crm, sent, scheduler, subscribe, at } = setup();
    subscribe(1);
    const lead = crm.leads.createLead(ctx, { name: 'ABC d.o.o.', notes: 'Povjerljivo' });
    const customer = crm.customers.createCustomer(ctx, {
      companyName: 'FERO-TERM',
      oib: '12345678901',
      city: 'Osijek',
      contactName: 'Marko',
    });
    const { opportunity } = crm.opportunities.createOpportunity(ctx, {
      companyId: customer.id,
      title: 'Vending projekt',
    });
    crm.reminders.setReminder(ctx, { kind: 'lead', id: lead.id }, '2026-10-12T09:30:00Z');
    crm.reminders.setReminder(
      ctx,
      { kind: 'opportunity', id: opportunity.id },
      '2026-10-14T12:00:00Z',
    );
    at('2026-10-15T00:00:00Z');
    await scheduler.tick();
    expect(sent.map((s) => s.payload.body)).toEqual([
      'Podsjetnik za lead: ABC d.o.o.',
      'Podsjetnik za priliku: Vending projekt — FERO-TERM',
    ]);
    expect(sent[1]!.payload.url).toBe(`/customers/${customer.id}#prilike`);
    expect(JSON.stringify(sent)).not.toContain('Povjerljivo');
  });

  it('moving a reminder means the old time no longer fires; removing it stops it', async () => {
    const { crm, sent, scheduler, subscribe, at } = setup();
    subscribe(1);
    const task = crm.tasks.createTask(ctx, { title: 'A' });
    const target = { kind: 'task' as const, id: task.id };
    crm.reminders.setReminder(ctx, target, '2026-10-10T07:00:00Z');
    crm.reminders.setReminder(ctx, target, '2026-10-12T07:00:00Z'); // moved
    expect(crm.repo.data().reminders).toHaveLength(1);
    at('2026-10-10T08:00:00Z');
    await scheduler.tick();
    expect(sent).toHaveLength(0);
    crm.reminders.setReminder(ctx, target, null); // removed
    at('2026-10-13T00:00:00Z');
    await scheduler.tick();
    expect(sent).toHaveLength(0);
    expect(crm.repo.data().reminders[0]).toMatchObject({ status: 'cancelled' });
  });

  it('completing a task cancels its reminder', async () => {
    const { crm, sent, scheduler, subscribe, at } = setup();
    subscribe(1);
    const task = crm.tasks.createTask(ctx, { title: 'A' });
    crm.reminders.setReminder(ctx, { kind: 'task', id: task.id }, '2026-10-10T07:00:00Z');
    crm.tasks.completeTask(ctx, task.id);
    at('2026-10-11T00:00:00Z');
    await scheduler.tick();
    expect(sent).toHaveLength(0);
  });

  it('retries a transient failure, then gives up after 3 attempts', async () => {
    const { crm, scheduler, subscribe, at } = setup(['retry', 'retry', 'retry']);
    subscribe(1);
    const task = crm.tasks.createTask(ctx, { title: 'A' });
    crm.reminders.setReminder(ctx, { kind: 'task', id: task.id }, '2026-10-10T07:00:00Z');
    at('2026-10-10T07:00:00Z');
    await scheduler.tick();
    expect(crm.repo.data().reminders[0]).toMatchObject({ status: 'pending', attempts: 1 });
    await scheduler.tick(); // too early for the retry
    expect(crm.repo.data().reminders[0]!.attempts).toBe(1);
    at('2026-10-10T07:01:00Z');
    await scheduler.tick();
    at('2026-10-10T07:06:00Z');
    await scheduler.tick();
    expect(crm.repo.data().reminders[0]).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: 'push_retry',
    });
  });

  it('a device the push service reports gone is switched off', async () => {
    const { crm, scheduler, subscribe, at } = setup(['gone', 'ok']);
    subscribe(1);
    subscribe(2);
    const task = crm.tasks.createTask(ctx, { title: 'A' });
    crm.reminders.setReminder(ctx, { kind: 'task', id: task.id }, '2026-10-10T07:00:00Z');
    at('2026-10-10T07:00:00Z');
    await scheduler.tick();
    expect(crm.repo.data().reminders[0]!.status).toBe('sent');
    expect(crm.pushSubscriptions.devices(ctx)).toBe(1);
  });

  it('without a device or without push keys the reminder fails visibly, never silently "sent"', async () => {
    const { crm, scheduler, at } = setup();
    const task = crm.tasks.createTask(ctx, { title: 'A' });
    crm.reminders.setReminder(ctx, { kind: 'task', id: task.id }, '2026-10-10T07:00:00Z');
    at('2026-10-10T07:00:00Z');
    await scheduler.tick();
    expect(crm.repo.data().reminders[0]).toMatchObject({
      status: 'failed',
      lastError: 'no_device',
    });

    const off = createReminderScheduler({
      services: crm,
      sender: createWebPushSender(null),
      logger: silent,
      now: () => new Date('2026-10-12T00:00:00Z'),
    });
    crm.reminders.setReminder(ctx, { kind: 'task', id: task.id }, '2026-10-11T07:00:00Z');
    await off.tick();
    expect(crm.repo.data().reminders[1]).toMatchObject({
      status: 'failed',
      lastError: 'push_not_configured',
    });
    // The task keeps showing the failure (not an empty "no reminder")...
    expect(crm.tasks.getTask(ctx, task.id).reminder).toMatchObject({
      status: 'failed',
      lastError: 'push_not_configured',
    });
    // ...until a new reminder is set.
    crm.reminders.setReminder(ctx, { kind: 'task', id: task.id }, '2026-10-13T07:00:00Z');
    expect(crm.tasks.getTask(ctx, task.id).reminder).toMatchObject({
      status: 'pending',
      remindAt: '2026-10-13T07:00:00.000Z',
    });
  });

  it('an interrupted delivery is picked up again after a restart', async () => {
    const { crm, sent, scheduler, subscribe, at } = setup();
    subscribe(1);
    const task = crm.tasks.createTask(ctx, { title: 'A' });
    crm.reminders.setReminder(ctx, { kind: 'task', id: task.id }, '2026-10-10T07:00:00Z');
    crm.reminders.claimDue(new Date('2026-10-10T07:00:00Z')); // claimed, then the process died
    at('2026-10-10T07:02:00Z');
    await scheduler.tick();
    expect(sent).toHaveLength(0); // still within the claim
    at('2026-10-10T07:06:00Z');
    await scheduler.tick();
    expect(sent).toHaveLength(1);
  });
});

describe('Reminder API', () => {
  const NOW = new Date('2026-10-09T10:00:00Z');
  const ctx = (organizationId = 'org-a'): CrmContext => ({
    organizationId,
    user: { id: 'u-a', displayName: 'Ana' },
    timeZone: 'Europe/Zagreb',
    now: NOW,
  });
  function api() {
    const crm = createCrmServices(createMemoryRepository(emptyData()), { demoContent: false });
    const routes = createCrmApi(crm);
    const call = (method: string, path: string, body = {}, c = ctx()) => {
      const hit = routes.match(method, path);
      if (hit.kind !== 'ok') throw new Error(`${method} ${path}: ${hit.kind}`);
      return routes.run(hit, c, new URLSearchParams(), body);
    };
    return { crm, call };
  }

  it('saves a task and its reminder together; a bad time saves neither', () => {
    const { crm, call } = api();
    const created = call('POST', '/api/tasks', {
      title: 'Poslati ponudu',
      reminderAt: '2026-10-10T07:00:00.000Z',
    });
    expect(created.status).toBe(201);
    expect(created.body.task).toMatchObject({
      reminder: { remindAt: '2026-10-10T07:00:00.000Z', status: 'pending' },
      scheduledStartAt: null,
      dueDate: null,
    });
    const past = call('POST', '/api/tasks', { title: 'X', reminderAt: '2026-10-09T09:00:00.000Z' });
    expect(past.status).toBe(422);
    expect(past.body.errors).toEqual({ reminderAt: 'Odaberite datum i vrijeme u budućnosti.' });
    expect(crm.repo.data().tasks).toHaveLength(1);
  });

  it('a reminder does not move the meeting it belongs to', () => {
    const { call } = api();
    const task = call('POST', '/api/tasks', {
      title: 'Sastanak',
      type: 'meeting',
      scheduledStartAt: '2026-10-10T12:00:00.000Z',
      scheduledEndAt: '2026-10-10T13:00:00.000Z',
      reminderAt: '2026-10-10T11:30:00.000Z',
    }).body.task as Record<string, unknown>;
    expect(task).toMatchObject({
      scheduledStartAt: '2026-10-10T12:00:00.000Z',
      reminder: { remindAt: '2026-10-10T11:30:00.000Z' },
    });
  });

  it('lead and opportunity reminders; another organization’s record is refused', () => {
    const { crm, call } = api();
    const lead = call('POST', '/api/leads', { name: 'ABC', reminderAt: '2026-10-12T09:30:00.000Z' })
      .body.lead as { id: string; reminder: unknown };
    expect(lead.reminder).toMatchObject({ remindAt: '2026-10-12T09:30:00.000Z' });
    const moved = call('PUT', `/api/leads/${lead.id}/reminder`, {
      reminderAt: '2026-10-13T09:30:00.000Z',
    });
    expect(moved.body.reminder).toMatchObject({ remindAt: '2026-10-13T09:30:00.000Z' });
    expect(
      call('PUT', `/api/leads/${lead.id}/reminder`, { reminderAt: null }).body.reminder,
    ).toBeNull();
    const foreign = call(
      'PUT',
      `/api/leads/${lead.id}/reminder`,
      { reminderAt: '2026-10-13T09:30:00.000Z' },
      ctx('org-b'),
    );
    expect(foreign.status).toBe(422);
    expect(crm.repo.data().reminders.filter((r) => r.status === 'pending')).toHaveLength(0);
  });

  it('push status says whether delivery is possible; devices need valid keys', () => {
    const { call } = api();
    expect(call('GET', '/api/push/status').body).toMatchObject({
      configured: false,
      publicKey: null,
      devices: 0,
    });
    expect(
      call('POST', '/api/push/subscriptions', { endpoint: 'http://evil.example/x', keys: {} })
        .status,
    ).toBe(422);
    const d = device();
    const ok = call('POST', '/api/push/subscriptions', {
      endpoint: 'https://push.example/a',
      keys: { p256dh: d.p256dh, auth: d.auth },
    });
    expect(ok.body).toMatchObject({ devices: 1 });
    expect(call('GET', '/api/push/status', {}, ctx('org-b')).body.devices).toBe(0);
  });
});

describe('Delivery over HTTP to a push service', () => {
  it('the push service receives an encrypted, VAPID-signed notification the device can read', async () => {
    const received: Array<{ headers: IncomingMessage['headers']; body: Buffer }> = [];
    const pushService = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(201).end();
      });
    });
    await new Promise<void>((resolve) => pushService.listen(0, '127.0.0.1', resolve));
    const { port } = pushService.address() as AddressInfo;

    const ctx: CrmContext = {
      organizationId: 'org-a',
      user: { id: 'u-a', displayName: 'Ana' },
      timeZone: 'Europe/Zagreb',
      now: new Date('2026-10-09T10:00:00Z'),
    };
    const crm = createCrmServices(createMemoryRepository(emptyData()), { demoContent: false });
    const d = device();
    crm.pushSubscriptions.subscribe(ctx, {
      endpoint: `http://127.0.0.1:${port}/push/phone`,
      keys: { p256dh: d.p256dh, auth: d.auth },
    });
    const task = crm.tasks.createTask(ctx, { title: 'Poslati ponudu za FERO-TERM' });
    crm.reminders.setReminder(ctx, { kind: 'task', id: task.id }, '2026-10-09T10:05:00Z');

    const keys = { ...generateVapidKeys(), subject: 'mailto:ops@renvara.test' };
    const scheduler = createReminderScheduler({
      services: crm,
      sender: createWebPushSender(keys),
      logger: silent,
      now: () => new Date('2026-10-09T10:05:30Z'),
    });
    await scheduler.tick();
    await new Promise<void>((resolve) => pushService.close(() => resolve()));

    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    expect(headers).toMatchObject({
      'content-encoding': 'aes128gcm',
      ttl: '21600',
      urgency: 'high',
    });
    expect(headers.authorization).toMatch(new RegExp(`^vapid t=[^,]+, k=${keys.publicKey}$`));
    expect(JSON.parse(decrypt(body, d.privateKey, d.authSecret))).toEqual({
      title: 'RENVARA — Zadatak',
      body: 'Poslati ponudu za FERO-TERM',
      url: `/tasks/${task.id}`,
      tag: expect.any(String),
    });
    expect(crm.repo.data().reminders[0]).toMatchObject({ status: 'sent' });
  });
});
