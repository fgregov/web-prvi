// Follow-up Engine (ADR-0008): upload validation, offer + document + link,
// share tokens, sending, waiting bands, engagement events, bots, revocation,
// tenant isolation, and the HTTP surface (sessions, headers, limits).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERIOD_MESSAGES } from '../public/app/js/core/period.js';
import { MESSAGES } from '../public/app/js/core/validation.js';
import { createMemoryDocumentStore } from '../src/crm/document-store.ts';
import { classifyRequest, clientFamily } from '../src/crm/engagement.ts';
import { CrmNotFoundError, CrmValidationError } from '../src/crm/errors.ts';
import { basicPdfCheck, createCrmServices, type CrmServices } from '../src/crm/index.ts';
import { inspectPdfWithPdfJs } from '../src/crm/pdf-inspect.ts';
import { createMemoryRepository, emptyData, normalizeData } from '../src/crm/repository.ts';
import { deriveShareKey, hashToken, TOKEN_PATTERN } from '../src/crm/share-token.ts';
import type { CrmContext, CrmData } from '../src/crm/types.ts';
import {
  cookiePair,
  login,
  PASSWORD,
  startTestServer,
  USERNAME,
  type TestServer,
} from './helpers.ts';
import { makePdf } from './pdf-fixture.ts';

const TZ = 'Europe/Zagreb';
const NOW = new Date('2026-10-13T08:00:00Z'); // Tuesday 13 Oct 2026, 10:00 in Zagreb
const ctxA: CrmContext = {
  organizationId: 'org-a',
  user: { id: 'user-a', displayName: 'Ana' },
  timeZone: TZ,
  now: NOW,
};
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

let crm: CrmServices;
let documents: ReturnType<typeof createMemoryDocumentStore>;
let fero: string;
let bmw: string;
let feroDeal: string;
let bmwDeal: string;
let feroContact: string;

function rejects(fn: () => unknown, errors: Record<string, string>) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CrmValidationError);
    expect((error as CrmValidationError).errors).toMatchObject(errors);
    return;
  }
  throw new Error('expected a validation error');
}
async function rejectsAsync(promise: Promise<unknown>, errors: Record<string, string>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CrmValidationError);
  expect((error as CrmValidationError).errors).toMatchObject(errors);
}

const upload = (
  ctx = ctxA,
  bytes = makePdf('Ponuda FERO-TERM'),
  fileName = 'Ponuda_Feroterm_2026.pdf',
) => crm.followUp.stageUpload(ctx, { bytes, fileName, contentType: 'application/pdf' });

async function newOffer(fields: Record<string, unknown> = {}, ctx = ctxA) {
  const staged = await upload(ctx);
  return crm.followUp.createOffer(ctx, {
    uploadId: staged.uploadId,
    title: 'Vending aparat — poslovna ponuda',
    companyId: fero,
    ...fields,
  });
}

beforeEach(() => {
  documents = createMemoryDocumentStore();
  crm = createCrmServices(createMemoryRepository(emptyData()), {
    demoContent: false,
    followUp: {
      documents,
      inspectPdf: inspectPdfWithPdfJs,
      shareKey: deriveShareKey('test-secret-'.repeat(4)),
    },
  });
  const make = (ctx: CrmContext, companyName: string, oib: string) => {
    const c = crm.customers.createCustomer(at('2026-09-01T08:00:00Z', ctx), {
      companyName,
      oib,
      city: 'Rijeka',
      contactName: `Kontakt ${companyName}`,
    });
    const deal = crm.opportunities.createOpportunity(at('2026-09-02T08:00:00Z', ctx), {
      companyId: c.id,
      title: `Prilika ${companyName}`,
    }).opportunity;
    return { id: c.id, deal: deal.id, contact: c.primaryContactId as string };
  };
  const f = make(ctxA, 'FERO-TERM d.o.o.', '60417283915');
  const b = make(ctxA, 'BMW TOMIĆ & CO', '11122233344');
  make(ctxB, 'Tuđi kupac d.o.o.', '99988877766');
  fero = f.id;
  feroDeal = f.deal;
  feroContact = f.contact;
  bmw = b.id;
  bmwDeal = b.deal;
});

describe('Upload (TEST A, H)', () => {
  it('accepts a valid PDF: staged privately with name, size and pages', async () => {
    const staged = await upload(ctxA, makePdf('Strana 1', 'Strana 2'));
    expect(staged).toMatchObject({ fileName: 'Ponuda_Feroterm_2026.pdf', pageCount: 2 });
    expect(staged.sizeBytes).toBeGreaterThan(100);
    expect(documents.size()).toBe(1);
  });

  it('refuses other types, empty, oversized, fake and broken PDFs (no offer, no link)', async () => {
    const stage = (bytes: Uint8Array, contentType = 'application/pdf') =>
      crm.followUp.stageUpload(ctxA, { bytes, fileName: 'x.pdf', contentType });
    await rejectsAsync(
      stage(makePdf(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      {
        document: MESSAGES.documentUnsupported,
      },
    );
    await rejectsAsync(stage(new Uint8Array()), { document: MESSAGES.documentEmpty });
    await rejectsAsync(stage(new TextEncoder().encode('PK\u0003\u0004 not a pdf')), {
      document: MESSAGES.documentInvalid,
    });
    await rejectsAsync(stage(new TextEncoder().encode('%PDF-1.4\ngarbage only\n%%EOF')), {
      document: MESSAGES.documentInvalid,
    });
    const small = createCrmServices(createMemoryRepository(emptyData()), {
      followUp: { maxBytes: 1000 },
    });
    await expect(
      small.followUp.stageUpload(ctxA, {
        bytes: makePdf('x'.repeat(2000)),
        fileName: 'x.pdf',
        contentType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ errors: { document: MESSAGES.documentTooLarge } });
    expect(documents.size()).toBe(0);
    expect(crm.repo.data().offers).toHaveLength(0);
    expect(crm.repo.data().offerShareLinks).toHaveLength(0);
  });

  it('a password-protected PDF is refused by the structural check', async () => {
    const enc = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj << /Type /Page >> endobj\ntrailer << /Encrypt 5 0 R >>\n%%EOF',
    );
    await expect(basicPdfCheck(enc)).rejects.toThrow(MESSAGES.documentEncrypted);
  });

  it('the display name is sanitized (no path, no control characters, ends in .pdf)', async () => {
    const staged = await upload(ctxA, makePdf(), '../../etc/<Ponuda>\u0007 "FERO".pdf');
    expect(staged.fileName).toBe('Ponuda FERO.pdf');
    const plain = await upload(ctxA, makePdf(), 'Ponuda bez nastavka');
    expect(plain.fileName).toBe('Ponuda bez nastavka.pdf');
  });
});

describe('Offer, document and link (TEST A, B)', () => {
  it('creates a draft offer for the existing customer with its document and one link', async () => {
    const customersBefore = crm.repo.data().customers.length;
    const { offerId, token } = await newOffer({ note: 'Interna bilješka' });
    const data = crm.repo.data();
    expect(data.customers).toHaveLength(customersBefore); // no duplicate customer
    const offer = data.offers.find((o) => o.id === offerId)!;
    expect(offer).toMatchObject({
      companyId: fero,
      opportunityId: null,
      status: 'draft',
      sentAt: null,
      note: 'Interna bilješka',
    });
    const doc = data.offerDocuments.find((d) => d.offerId === offerId)!;
    expect(doc.storageKey).toBe(`org-a/${offerId}/${doc.id}.pdf`);
    expect(await documents.get(doc.storageKey)).not.toBeNull();
    expect(documents.size()).toBe(1); // moved out of staging
    expect(TOKEN_PATTERN.test(token)).toBe(true);
    const link = data.offerShareLinks.find((l) => l.offerId === offerId)!;
    expect(link.tokenHash).toBe(await hashToken(token));
    expect(JSON.stringify(data)).not.toContain(token); // stored hashed and sealed only
    const detail = await crm.followUp.detail(ctxA, offerId);
    expect(detail.link).toMatchObject({ status: 'active', path: `/o/${token}` });
    expect(Date.parse(detail.link!.expiresAt) - NOW.getTime()).toBe(90 * 864e5);
    expect(detail.document).toMatchObject({ fileName: 'Ponuda_Feroterm_2026.pdf', pageCount: 1 });
  });

  it('an upload is used once, by its own user and organization', async () => {
    const staged = await upload(ctxA);
    const input = { uploadId: staged.uploadId, title: 'Ponuda', companyId: fero };
    await rejectsAsync(
      crm.followUp.createOffer({ ...ctxA, user: { id: 'other', displayName: 'X' } }, input),
      {
        document: MESSAGES.documentUploadFailed,
      },
    );
    await crm.followUp.createOffer(ctxA, input);
    await rejectsAsync(crm.followUp.createOffer(ctxA, input), {
      document: MESSAGES.documentUploadFailed,
    });
    expect(crm.repo.data().offers).toHaveLength(1);
  });

  it('opportunity and contact must belong to the chosen customer (server-side)', async () => {
    const staged = await upload(ctxA);
    const base = { uploadId: staged.uploadId, title: 'Ponuda', companyId: fero };
    await rejectsAsync(crm.followUp.createOffer(ctxA, { ...base, opportunityId: bmwDeal }), {
      opportunityId: MESSAGES.opportunityNotOfCustomer,
    });
    const bmwContact = crm.repo.data().contacts.find((c) => c.companyId === bmw)!.id;
    await rejectsAsync(crm.followUp.createOffer(ctxA, { ...base, contactId: bmwContact }), {
      contactId: MESSAGES.contactNotOfCustomer,
    });
    await rejectsAsync(crm.followUp.createOffer(ctxA, { ...base, title: '' }), {
      title: 'Obavezno polje.',
    });
    await rejectsAsync(crm.followUp.createOffer(ctxA, { title: 'x', companyId: fero }), {
      document: MESSAGES.documentRequired,
    });
    // The staged file survives a refused form: the user fixes the form and saves.
    const ok = await crm.followUp.createOffer(ctxA, {
      ...base,
      opportunityId: feroDeal,
      contactId: feroContact,
    });
    expect(crm.repo.data().offers.find((o) => o.id === ok.offerId)).toMatchObject({
      opportunityId: feroDeal,
      contactId: feroContact,
    });
  });

  it("another organization's customer is unavailable, not usable", async () => {
    const other = crm.repo.data().customers.find((c) => c.organizationId === 'org-b')!;
    const staged = await upload(ctxA);
    await rejectsAsync(
      crm.followUp.createOffer(ctxA, {
        uploadId: staged.uploadId,
        title: 'x',
        companyId: other.id,
      }),
      {
        companyId: MESSAGES.unavailable,
      },
    );
  });
});

describe('Sending and waiting (TEST E, F)', () => {
  it('no wait before "Označi kao poslano"; then from the recorded sending time', async () => {
    const { offerId } = await newOffer();
    let item = crm.followUp.list(ctxA).items.find((i) => i.offerId === offerId)!;
    expect(item).toMatchObject({ standing: 'draft', waitingDays: null, band: null });
    expect(crm.offers.feedback(ctxA).some((f) => f.offerId === offerId)).toBe(false);
    // Sent by e-mail three days ago (day 1 = the sending day → 4D).
    crm.followUp.markSent(ctxA, offerId, { sentAt: '2026-10-10T07:30:00.000Z' });
    item = crm.followUp.list(ctxA).items.find((i) => i.offerId === offerId)!;
    expect(item).toMatchObject({
      standing: 'waiting',
      waitingDays: 4,
      band: 'yellow',
      sentAt: '2026-10-10T07:30:00.000Z',
    });
    const feedback = crm.offers.feedback(ctxA).find((f) => f.offerId === offerId)!;
    expect(feedback).toMatchObject({
      waitingDays: 4,
      hasDocument: true,
      opportunityId: null,
      companyId: fero,
    });
    rejects(() => crm.followUp.markSent(ctxA, offerId, {}), { status: MESSAGES.offerAlreadySent });
  });

  it('refuses a sending time in the future or over a year ago', async () => {
    const { offerId } = await newOffer();
    rejects(() => crm.followUp.markSent(ctxA, offerId, { sentAt: '2026-10-14T08:00:00Z' }), {
      sentAt: MESSAGES.sentInFuture,
    });
    rejects(() => crm.followUp.markSent(ctxA, offerId, { sentAt: '2025-10-01T08:00:00Z' }), {
      sentAt: MESSAGES.sentTooOld,
    });
    rejects(() => crm.followUp.markSent(ctxA, offerId, { sentAt: 'jučer' }), {
      sentAt: 'Neispravan datum ili vrijeme.',
    });
  });

  it('bands 1D, 4D yellow · 5D, 9D red · 10D black (sending day = day 1, Zagreb days)', async () => {
    const { offerId } = await newOffer();
    crm.followUp.markSent(ctxA, offerId, { sentAt: '2026-10-13T06:00:00Z' });
    for (const [day, waiting, band] of [
      ['2026-10-13T20:00:00Z', 1, 'yellow'],
      ['2026-10-16T20:00:00Z', 4, 'yellow'],
      ['2026-10-17T08:00:00Z', 5, 'red'],
      ['2026-10-21T08:00:00Z', 9, 'red'],
      ['2026-10-22T08:00:00Z', 10, 'black'],
    ] as const) {
      expect(crm.followUp.list(at(day)).items[0]).toMatchObject({ waitingDays: waiting, band });
    }
  });

  it('answered: resolved, no longer waiting; the filters split the list', async () => {
    const a = await newOffer();
    const b = await newOffer({ companyId: bmw, title: 'Dodatna oprema' });
    await newOffer({ title: 'Nacrt' });
    crm.followUp.markSent(ctxA, a.offerId, {});
    crm.followUp.markSent(ctxA, b.offerId, {});
    crm.followUp.markAnswered(ctxA, b.offerId);
    const { counts, items } = crm.followUp.list(ctxA);
    expect(counts).toEqual({ all: 3, waiting: 1, viewed: 0, resolved: 1 });
    expect(items.map((i) => i.standing)).toEqual(['waiting', 'draft', 'answered']);
    expect(crm.followUp.list(ctxA, 'resolved').items[0]!.offerId).toBe(b.offerId);
    rejects(() => crm.followUp.list(ctxA, 'nešto'), { filter: 'Neispravan filtar.' });
  });
});

describe('Period: offers created in it; the running period keeps earlier unresolved ones', () => {
  const Q3 = { from: '2026-07-01', to: '2026-09-30' };
  const Q4 = { from: '2026-10-01', to: '2026-12-31' };
  const SEPT = at('2026-09-20T08:00:00Z');

  /** September: one waiting, one answered, one draft; October (today): one draft. */
  async function quarters() {
    const waiting = await newOffer({ title: 'Rujan · čeka' }, SEPT);
    crm.followUp.markSent(SEPT, waiting.offerId, {});
    const answered = await newOffer({ title: 'Rujan · odgovoreno' }, SEPT);
    crm.followUp.markSent(SEPT, answered.offerId, {});
    crm.followUp.markAnswered(at('2026-09-25T08:00:00Z'), answered.offerId);
    const draft = await newOffer({ title: 'Rujan · nacrt' }, SEPT);
    const october = await newOffer({ title: 'Listopad · nacrt' });
    return { waiting, answered, draft, october };
  }
  const titles = (r: { items: { title: string }[] }) => r.items.map((i) => i.title);

  it('a past quarter: only the offers created in it, each as it stands today', async () => {
    const { waiting } = await quarters();
    const everything = crm.followUp.list(ctxA);
    const q3 = crm.followUp.list(ctxA, 'all', Q3);
    expect(titles(q3)).toEqual(['Rujan · čeka', 'Rujan · nacrt', 'Rujan · odgovoreno']);
    expect(q3.period).toEqual({ ...Q3, includesToday: false, earlierUnresolved: 0 });
    expect(q3.counts).toEqual({ all: 3, waiting: 1, viewed: 0, resolved: 1 });
    // Same item as without a period: the wait runs from the real sending day to today.
    const item = q3.items.find((i) => i.offerId === waiting.offerId);
    expect(item).toEqual(everything.items.find((i) => i.offerId === waiting.offerId));
    expect(item).toMatchObject({ standing: 'waiting', waitingDays: 24, band: 'black' });
  });

  it('the running quarter: its offers plus the earlier unresolved ones; the waiting view is unchanged', async () => {
    await quarters();
    const q4 = crm.followUp.list(ctxA, 'all', Q4);
    expect(titles(q4)).toEqual(['Rujan · čeka', 'Listopad · nacrt', 'Rujan · nacrt']);
    expect(q4.period).toEqual({ ...Q4, includesToday: true, earlierUnresolved: 2 });
    expect(q4.counts).toEqual({ all: 3, waiting: 1, viewed: 0, resolved: 0 });
    const ids = (r: { items: { offerId: string }[] }) => r.items.map((i) => i.offerId);
    expect(ids(crm.followUp.list(ctxA, 'waiting', Q4))).toEqual(
      ids(crm.followUp.list(ctxA, 'waiting')),
    );
    // A custom range up to today behaves the same; one in the past keeps nothing extra.
    expect(crm.followUp.list(ctxA, 'all', { from: '2026-10-10', to: '2026-10-13' }).period).toEqual(
      {
        from: '2026-10-10',
        to: '2026-10-13',
        includesToday: true,
        earlierUnresolved: 2,
      },
    );
    expect(
      titles(crm.followUp.list(ctxA, 'all', { from: '2026-10-01', to: '2026-10-12' })),
    ).toEqual([]);
  });

  it('day boundaries in the organization timezone; no period = every offer; nothing is changed', async () => {
    // 1 Oct 00:30 in Zagreb is still 30 Sep in UTC.
    const night = await newOffer({ title: 'Ponoć' }, at('2026-09-30T22:30:00Z'));
    expect(
      titles(crm.followUp.list(ctxA, 'all', { from: '2026-10-01', to: '2026-10-01' })),
    ).toEqual(['Ponoć']);
    expect(crm.followUp.list(ctxA, 'all', { from: '2026-09-30', to: '2026-09-30' }).items).toEqual(
      [],
    );
    await quarters();
    const before = crm.followUp.list(ctxA);
    expect(before.period).toBeNull();
    expect(before.items).toHaveLength(5);
    crm.followUp.list(ctxA, 'all', Q3);
    crm.followUp.list(ctxA, 'resolved', Q4);
    expect(crm.followUp.list(ctxA)).toEqual(before);
    expect(crm.followUp.list(ctxA).items.some((i) => i.offerId === night.offerId)).toBe(true);
  });

  it('refuses an invalid period like the other period views', () => {
    rejects(() => crm.followUp.list(ctxA, 'all', { from: '2026-12-31', to: '2026-10-01' }), {
      range: PERIOD_MESSAGES.endBeforeStart,
    });
    rejects(() => crm.followUp.list(ctxA, 'all', { from: '2026-10-01' }), {
      range: PERIOD_MESSAGES.missingDates,
    });
    rejects(() => crm.followUp.list(ctxA, 'all', { from: '2026-02-30', to: '2026-03-01' }), {
      range: PERIOD_MESSAGES.missingDates,
    });
  });
});

describe('Public link: access, views, bots (TEST C, D, G)', () => {
  it('info shows only the title and file; the document is the uploaded PDF', async () => {
    const { offerId, token } = await newOffer({ note: 'TAJNO: popust do 20 %' });
    const info = await crm.followUp.publicInfo(token, NOW);
    expect(info).toEqual({
      title: 'Vending aparat — poslovna ponuda',
      fileName: 'Ponuda_Feroterm_2026.pdf',
      pageCount: 1,
      sizeBytes: expect.any(Number),
    });
    expect(JSON.stringify(info)).not.toMatch(/TAJNO|FERO|org-a|user-a/);
    const file = await crm.followUp.publicDocument(token, NOW);
    const doc = crm.repo.data().offerDocuments.find((d) => d.offerId === offerId)!;
    expect(file!.bytes).toEqual(await documents.get(doc.storageKey));
  });

  it('wrong, altered or other-length tokens give nothing', async () => {
    const { token } = await newOffer();
    const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
    for (const bad of [flipped, token.slice(0, 42), `${token}x`, '1', '../../etc/passwd']) {
      expect(await crm.followUp.publicInfo(bad, NOW)).toBeNull();
      expect(await crm.followUp.publicDocument(bad, NOW)).toBeNull();
    }
  });

  it('link_access and document_view are separate; scanners, prefetch, HEAD and automation are flagged', async () => {
    const { offerId, token } = await newOffer();
    const later = (s: number) => new Date(NOW.getTime() + s * 1000);
    await crm.followUp.recordAccess(token, HUMAN, later(1), false);
    await crm.followUp.recordAccess(
      token,
      { ...HUMAN, userAgent: 'Mozilla/5.0 (compatible; Proofpoint URL Defense)' },
      later(10),
      false,
    );
    await crm.followUp.recordAccess(token, { ...HUMAN, method: 'HEAD' }, later(20), false);
    await crm.followUp.recordAccess(token, { ...HUMAN, purpose: 'prefetch' }, later(30), false);
    await crm.followUp.recordAccess(token, HUMAN, later(31), false); // 1 s after the previous: rapid
    let e = crm.followUp.engagement(ctxA, offerId);
    expect(e).toMatchObject({ rawAccessCount: 5, accessCount: 1, viewCount: 0, uniqueSessions: 0 });
    expect(e.suspectedBotCount).toBe(4);

    const s1 = 'session-aaaaaaaaaaaaaaaa';
    const s2 = 'session-bbbbbbbbbbbbbbbb';
    expect(await crm.followUp.recordView(token, { sessionId: s1 }, HUMAN, later(60), false)).toBe(
      'recorded',
    );
    expect(await crm.followUp.recordView(token, { sessionId: s1 }, HUMAN, later(120), false)).toBe(
      'duplicate',
    );
    expect(await crm.followUp.recordView(token, { sessionId: s2 }, HUMAN, later(180), false)).toBe(
      'recorded',
    );
    expect(
      await crm.followUp.recordView(token, { sessionId: s1 }, HUMAN, later(60 + 31 * 60), false),
    ).toBe('recorded');
    expect(
      await crm.followUp.recordView(
        token,
        { sessionId: 'session-cccccccccccccccc', automation: true },
        HUMAN,
        later(400),
        false,
      ),
    ).toBe('recorded');
    expect(await crm.followUp.recordView(token, { sessionId: 'x' }, HUMAN, later(500), false)).toBe(
      'invalid',
    );
    e = crm.followUp.engagement(ctxA, offerId);
    expect(e).toMatchObject({ viewCount: 3, uniqueSessions: 2, suspectedBotCount: 5 });
    expect(e.lastViewAt).toBe(later(60 + 31 * 60).toISOString());
    // The first qualifying view goes on the customer timeline, once.
    const viewed = crm.repo.data().activities.filter((a) => a.type === 'offer_viewed');
    expect(viewed).toHaveLength(1);
    expect(viewed[0]).toMatchObject({
      companyId: fero,
      actorId: null,
      title: 'Pregled ponude zabilježen',
    });
    // Stored events carry a coarse client family only.
    const events = crm.repo.data().offerEvents;
    expect(events.every((ev) => !JSON.stringify(ev).includes('Mozilla'))).toBe(true);
    expect(events[0]!.client).toBe('Safari · iOS');
  });

  it('a signed-in Renvara user (salesperson) is never counted', async () => {
    const { offerId, token } = await newOffer();
    expect(await crm.followUp.recordAccess(token, HUMAN, NOW, true)).toBe(true);
    expect(
      await crm.followUp.recordView(
        token,
        { sessionId: 'session-aaaaaaaaaaaaaaaa' },
        HUMAN,
        NOW,
        true,
      ),
    ).toBe('internal');
    expect(crm.followUp.engagement(ctxA, offerId)).toMatchObject({
      rawAccessCount: 0,
      viewCount: 0,
    });
  });

  it('a view does not reset or stop the wait (an answer does)', async () => {
    const { offerId, token } = await newOffer();
    crm.followUp.markSent(ctxA, offerId, { sentAt: '2026-10-08T08:00:00Z' });
    await crm.followUp.recordView(
      token,
      { sessionId: 'session-aaaaaaaaaaaaaaaa' },
      HUMAN,
      NOW,
      false,
    );
    const item = crm.followUp.list(ctxA, 'viewed').items[0]!;
    expect(item).toMatchObject({ offerId, waitingDays: 6, band: 'red', standing: 'waiting' });
    expect(item.engagement.viewCount).toBe(1);
  });

  it('revoked and expired links stop working; a new link works, the old one stays dead', async () => {
    const { offerId, token } = await newOffer();
    const other = await newOffer({ title: 'Druga ponuda' });
    crm.followUp.revokeLink(ctxA, offerId);
    expect(await crm.followUp.publicInfo(token, NOW)).toBeNull();
    expect(await crm.followUp.recordAccess(token, HUMAN, NOW, false)).toBe(false);
    expect(await crm.followUp.publicInfo(other.token, NOW)).not.toBeNull(); // unrelated offer unaffected
    expect((await crm.followUp.detail(ctxA, offerId)).link).toMatchObject({
      status: 'revoked',
      path: null,
    });
    expect(crm.repo.data().offers.find((o) => o.id === offerId)!.status).toBe('draft'); // offer unchanged
    const { token: fresh } = await crm.followUp.issueLink(ctxA, offerId);
    expect(fresh).not.toBe(token);
    expect(await crm.followUp.publicInfo(fresh, NOW)).not.toBeNull();
    expect(await crm.followUp.publicInfo(token, NOW)).toBeNull();
    await rejectsAsync(crm.followUp.issueLink(ctxA, offerId), { link: MESSAGES.linkActive });
    // 90 days later the link has expired.
    const expired = new Date(NOW.getTime() + 91 * 864e5);
    expect(await crm.followUp.publicInfo(fresh, expired)).toBeNull();
  });
});

describe('Tenant isolation (TEST I)', () => {
  it('another organization cannot read, send, answer, revoke or download an offer', async () => {
    const { offerId } = await newOffer();
    await expect(crm.followUp.detail(ctxB, offerId)).rejects.toBeInstanceOf(CrmNotFoundError);
    await expect(crm.followUp.readDocument(ctxB, offerId)).rejects.toBeInstanceOf(CrmNotFoundError);
    expect(() => crm.followUp.markSent(ctxB, offerId, {})).toThrow(CrmNotFoundError);
    expect(() => crm.followUp.revokeLink(ctxB, offerId)).toThrow(CrmNotFoundError);
    expect(() => crm.followUp.engagement(ctxB, offerId)).toThrow(CrmNotFoundError);
    expect(crm.followUp.list(ctxB).items).toHaveLength(0);
  });
});

describe('Classification and compatibility', () => {
  it('classifies requests conservatively and names client families coarsely', () => {
    expect(classifyRequest(HUMAN)).toEqual({ suspectedBot: false, reason: null });
    expect(
      classifyRequest({
        ...HUMAN,
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/131.0',
      }).reason,
    ).toBe('scanner_user_agent');
    expect(classifyRequest({ ...HUMAN, userAgent: null }).reason).toBe('no_user_agent');
    expect(classifyRequest({ ...HUMAN, automation: true }).reason).toBe('automation');
    expect(
      clientFamily(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome · Android');
    expect(
      clientFamily(
        'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0',
      ),
    ).toBe('Edge · Windows');
  });

  it('offers saved before the Follow-up Engine get their customer from their opportunity', () => {
    const legacy = {
      ...emptyData(),
      opportunities: [{ id: 'opp-1', organizationId: 'org-a', companyId: 'cust-1' }],
      offers: [
        {
          id: 'off-1',
          organizationId: 'org-a',
          opportunityId: 'opp-1',
          title: 'Stara',
          status: 'sent',
        },
      ],
    } as unknown as CrmData;
    expect(normalizeData(legacy).offers[0]).toMatchObject({
      companyId: 'cust-1',
      opportunityId: 'opp-1',
      contactId: null,
      note: '',
    });
  });
});

describe("Lead-first sales: an offer within a lead's deal (ADR-0009)", () => {
  it('upload, link and views without a customer; the conversion gives the same offer its customer', async () => {
    const customersBefore = crm.repo.data().customers.length;
    const lead = crm.leads.createLead(ctxA, { name: 'Marko Lukač', companyName: 'Pekara Lukač' });
    const { opportunity } = crm.opportunities.createOpportunity(ctxA, {
      leadId: lead.id,
      title: 'Vending aparat',
      value: '5000',
    });
    // A lead offer needs one of the lead's deals; another lead's deal is refused.
    const other = crm.leads.createLead(ctxA, { name: 'Drugi lead' });
    await rejectsAsync(
      newOffer({ companyId: null, leadId: other.id, opportunityId: opportunity.id }),
      {
        opportunityId: MESSAGES.opportunityNotOfLead,
      },
    );
    await rejectsAsync(newOffer({ companyId: null, leadId: lead.id }), {
      opportunityId: 'Odaberite priliku leada.',
    });
    const created = await newOffer({
      companyId: null,
      leadId: lead.id,
      opportunityId: opportunity.id,
    });
    const offer = await crm.followUp.detail(ctxA, created.offerId);
    expect(offer).toMatchObject({
      companyId: null,
      customerName: '',
      leadId: lead.id,
      leadName: 'Marko Lukač · Pekara Lukač',
      opportunityId: opportunity.id,
      link: { status: 'active' },
    });
    expect(crm.repo.data().customers).toHaveLength(customersBefore); // no customer invented

    crm.followUp.markSent(ctxA, created.offerId, {});
    expect(await crm.followUp.recordAccess(created.token, HUMAN, NOW, false)).toBe(true);
    expect(
      await crm.followUp.recordView(
        created.token,
        { sessionId: 'session-aaaaaaaaaaaaaaaa' },
        HUMAN,
        NOW,
        false,
      ),
    ).toBe('recorded');
    const timeline = crm.leads.getLead(ctxA, lead.id).activities.map((a) => a.type);
    expect(timeline).toEqual(expect.arrayContaining(['offer_sent', 'offer_viewed']));
    expect(crm.followUp.list(ctxA, 'waiting').items.map((i) => i.leadName)).toEqual([
      'Marko Lukač · Pekara Lukač',
    ]);

    crm.opportunities.closeOpportunity(ctxA, opportunity.id, { outcome: 'won' });
    const { customerId } = crm.leads.convertLead(ctxA, lead.id, {
      conversionMode: 'CREATE_CUSTOMER',
      customer: { companyName: 'Pekara Lukač d.o.o.', oib: '44444444444', city: 'Osijek' },
    });
    const after = await crm.followUp.detail(ctxA, created.offerId);
    expect(after).toMatchObject({
      offerId: created.offerId, // the same offer, its link and its views
      companyId: customerId,
      customerName: 'Pekara Lukač d.o.o.',
      leadId: lead.id,
      link: { status: 'active' },
      engagement: { viewCount: 1 },
    });
  });

  it('leads WON before ADR-0009 were won at their conversion; nothing else is invented', () => {
    const legacy = {
      ...emptyData(),
      leads: [
        {
          id: 'l-1',
          organizationId: 'org-a',
          status: 'won',
          convertedAt: '2026-08-01T10:00:00.000Z',
          convertedCustomerId: 'c-1',
        },
        { id: 'l-2', organizationId: 'org-a', status: 'active', convertedAt: null },
      ],
      opportunities: [{ id: 'o-1', organizationId: 'org-a', companyId: 'c-1' }],
    } as unknown as CrmData;
    const data = normalizeData(legacy);
    expect(data.leads[0]).toMatchObject({
      wonAt: '2026-08-01T10:00:00.000Z',
      wonBasis: 'conversion',
    });
    expect(data.leads[1]).toMatchObject({ wonAt: null, wonBasis: null });
    expect(data.opportunities[0]).toMatchObject({ companyId: 'c-1', leadId: null });
    expect(data.opportunities).toHaveLength(1);
  });

  it('Ponude and the Home feedback list name the lead of an offer without a customer', () => {
    const lead = crm.leads.createLead(ctxA, { name: 'Hotel Lavanda' });
    const { opportunity } = crm.opportunities.createOpportunity(ctxA, {
      leadId: lead.id,
      title: 'Aparati za 3 lokacije',
    });
    crm.offers.recordSent(ctxA, { opportunityId: opportunity.id, title: 'Ponuda Lavanda' });
    const item = crm.offers.feedback(ctxA).find((i) => i.title === 'Ponuda Lavanda');
    expect(item).toMatchObject({
      companyId: null,
      leadId: lead.id,
      leadName: 'Hotel Lavanda',
      waitingDays: 1,
      band: 'yellow',
    });
  });
});

describe('HTTP: /api/follow-up and /o/{token}', () => {
  let server: TestServer;
  let cookie: string;
  const NOW_HTTP = new Date('2026-10-05T09:00:00Z');
  beforeEach(async () => {
    crm = createCrmServices(createMemoryRepository(emptyData()), {
      demoContent: false,
      followUp: {
        documents: createMemoryDocumentStore(),
        inspectPdf: inspectPdfWithPdfJs,
        maxBytes: 50_000,
      },
    });
    fero = crm.customers.createCustomer(
      { ...ctxA, organizationId: 'org-beta', now: NOW_HTTP },
      {
        companyName: 'FERO-TERM d.o.o.',
        oib: '60417283915',
        city: 'Osijek',
        contactName: 'Marko',
      },
    ).id;
    server = await startTestServer(undefined, {
      crm: { services: crm, organizationId: 'org-beta', timeZone: TZ, now: () => NOW_HTTP },
    });
    cookie = cookiePair(await login(server.url, USERNAME, PASSWORD));
  });
  afterEach(async () => {
    await server.close();
  });
  const post = (
    path: string,
    body: string | Uint8Array,
    headers: Record<string, string>,
    withCookie = true,
  ) =>
    fetch(`${server.url}${path}`, {
      method: 'POST',
      headers: { ...(withCookie ? { Cookie: cookie } : {}), ...headers },
      body,
    });

  async function shareOffer() {
    const up = await post('/api/follow-up/uploads', makePdf('Ponuda'), {
      'Content-Type': 'application/pdf',
      'X-File-Name': encodeURIComponent('Ponuda_Feroterm.pdf'),
    });
    expect(up.status).toBe(201);
    const { upload: staged } = (await up.json()) as { upload: { uploadId: string } };
    const created = await post(
      '/api/follow-up/offers',
      JSON.stringify({ uploadId: staged.uploadId, title: 'Vending aparat', companyId: fero }),
      { 'Content-Type': 'application/json' },
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { offer: { offerId: string; shareUrl: string } };
    expect(body.offer.shareUrl).toMatch(new RegExp(`^${server.url}/o/[A-Za-z0-9_-]{43}$`));
    return body.offer;
  }

  it('the list takes the selected period (from/to); an invalid one is 422', async () => {
    const get = (query: string) =>
      fetch(`${server.url}/api/follow-up/offers${query}`, { headers: { Cookie: cookie } });
    const quarter = await get('?filter=all&from=2026-10-01&to=2026-12-31');
    expect(quarter.status).toBe(200);
    expect(((await quarter.json()) as { period: unknown }).period).toEqual({
      from: '2026-10-01',
      to: '2026-12-31',
      includesToday: true,
      earlierUnresolved: 0,
    });
    const reversed = await get('?from=2026-12-31&to=2026-10-01');
    expect(reversed.status).toBe(422);
    expect(((await reversed.json()) as { errors: { range: string } }).errors.range).toBe(
      PERIOD_MESSAGES.endBeforeStart,
    );
    expect((await get('?from=2026-10-01')).status).toBe(422);
    expect(((await (await get('')).json()) as { period: unknown }).period).toBeNull();
  });

  it('needs a session for the internal API; refuses wrong types and oversized uploads', async () => {
    expect((await fetch(`${server.url}/api/follow-up/offers`)).status).toBe(401);
    const noSession = await post(
      '/api/follow-up/uploads',
      makePdf(),
      { 'Content-Type': 'application/pdf' },
      false,
    );
    expect(noSession.status).toBe(401);
    const word = await post('/api/follow-up/uploads', 'x', {
      'Content-Type': 'application/msword',
    });
    expect(word.status).toBe(415);
    expect(((await word.json()) as { message: string }).message).toBe(MESSAGES.documentUnsupported);
    const big = await post('/api/follow-up/uploads', makePdf('x'.repeat(60_000)), {
      'Content-Type': 'application/pdf',
    });
    expect(big.status).toBe(413);
    const crossSite = await post('/api/follow-up/uploads', makePdf(), {
      'Content-Type': 'application/pdf',
      Origin: 'https://evil.example',
    });
    expect(crossSite.status).toBe(403);
  });

  it('end to end: upload → link → viewer page (noindex, no-referrer, CSP) → document → view', async () => {
    const offer = await shareOffer();
    const path = new URL(offer.shareUrl).pathname;
    const page = await fetch(`${server.url}${path}`, {
      headers: { 'User-Agent': HUMAN.userAgent },
    });
    expect(page.status).toBe(200);
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('cache-control')).toContain('no-store');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(await page.text()).toContain('/viewer/viewer.js');

    const doc = await fetch(`${server.url}${path}/document`);
    expect(doc.status).toBe(200);
    expect(doc.headers.get('content-type')).toBe('application/pdf');
    expect(doc.headers.get('content-disposition')).toContain('attachment');
    expect(doc.headers.get('content-security-policy')).toContain('sandbox');
    expect(
      new TextDecoder().decode(new Uint8Array(await doc.arrayBuffer())).startsWith('%PDF-'),
    ).toBe(true);

    const view = await fetch(`${server.url}${path}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': HUMAN.userAgent },
      body: JSON.stringify({ type: 'view', sessionId: 'session-aaaaaaaaaaaaaaaa' }),
    });
    expect(view.status).toBe(200);
    const detail = (await (
      await fetch(`${server.url}/api/follow-up/offers/${offer.offerId}`, {
        headers: { Cookie: cookie },
      })
    ).json()) as {
      offer: { engagement: { rawAccessCount: number; viewCount: number } };
    };
    expect(detail.offer.engagement).toMatchObject({ rawAccessCount: 1, viewCount: 1 });

    // The salesperson's own clicks (with the session cookie) are not recorded.
    await fetch(`${server.url}${path}`, {
      headers: { Cookie: cookie, 'User-Agent': HUMAN.userAgent },
    });
    const after = (await (
      await fetch(`${server.url}/api/follow-up/offers/${offer.offerId}`, {
        headers: { Cookie: cookie },
      })
    ).json()) as typeof detail;
    expect(after.offer.engagement.rawAccessCount).toBe(1);

    // An internal preview of the PDF needs the session.
    expect(
      (await fetch(`${server.url}/api/follow-up/offers/${offer.offerId}/document`)).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${server.url}/api/follow-up/offers/${offer.offerId}/document`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(200);
  });

  it('unknown and revoked links look the same; view events come only from this site', async () => {
    const offer = await shareOffer();
    const path = new URL(offer.shareUrl).pathname;
    const crossSite = await fetch(`${server.url}${path}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ type: 'view', sessionId: 'session-aaaaaaaaaaaaaaaa' }),
    });
    expect(crossSite.status).toBe(403);
    const revoke = await post(`/api/follow-up/offers/${offer.offerId}/link/revoke`, '{}', {
      'Content-Type': 'application/json',
    });
    expect(revoke.status).toBe(200);
    const bogus = `/o/${'A'.repeat(43)}`;
    for (const p of [path, bogus]) {
      const res = await fetch(`${server.url}${p}`);
      expect(res.status).toBe(404);
      const info = await fetch(`${server.url}${p}/info`);
      expect(info.status).toBe(404);
      expect(await info.json()).toEqual({
        success: false,
        message: 'Ova poveznica više nije dostupna.',
      });
      expect((await fetch(`${server.url}${p}/document`)).status).toBe(404);
    }
  });

  it('serves the viewer and pdf.js assets publicly, nothing else of the package', async () => {
    expect((await fetch(`${server.url}/viewer/viewer.js`)).status).toBe(200);
    const worker = await fetch(`${server.url}/viewer/pdfjs/build/pdf.worker.min.mjs`);
    expect(worker.status).toBe(200);
    expect(worker.headers.get('content-type')).toContain('text/javascript');
    // The legacy build (polyfilled for older phones), not the modern one.
    const viewer = await (await fetch(`${server.url}/viewer/pdfjs/build/pdf.min.mjs`)).text();
    expect(viewer).toContain('core-js');
    expect((await fetch(`${server.url}/viewer/pdfjs/package.json`)).status).toBe(404);
    expect((await fetch(`${server.url}/viewer/pdfjs/build/pdf.mjs.map`)).status).toBe(404);
    expect((await fetch(`${server.url}/viewer/..%2F..%2Fsrc%2Fserver.ts`)).status).toBe(404);
  });

  it('rate-limits the public link per client', async () => {
    let last = 0;
    for (let i = 0; i < 125; i += 1)
      last = (await fetch(`${server.url}/o/${'B'.repeat(43)}/info`)).status;
    expect(last).toBe(429);
  });
});
