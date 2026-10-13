// FollowUpService: the Follow-up Engine (ADR-0008). A salesperson uploads the
// PDF of an offer made elsewhere (ERP, Word), ties it to a customer (and
// optionally an opportunity and contact), gets a secret link for an e-mail,
// marks the offer as sent, and sees where the customer opened it.
//
// The offer is the same record FEEDBACK OVERVIEW and Ponude read; this service
// adds its document, share links and engagement events. Waiting starts at
// `sentAt` (never at upload or at a view) and keeps the existing bands.
import { offerWaitingDays, waitingBand, type WaitingBand } from '@renvara/domain';
import {
  DEFAULT_MAX_DOCUMENT_BYTES,
  hasErrors,
  MESSAGES,
  validateFollowUpOffer,
} from '../../public/app/js/core/validation.js';
import { documentKey, stagingKey, type DocumentStore } from './document-store.ts';
import {
  classifyRequest,
  clientFamily,
  engagementSummary,
  RAPID_REPEAT_MS,
  VIEW_DEDUP_MS,
  type EngagementSummary,
  type RequestSignals,
} from './engagement.ts';
import { CrmNotFoundError, CrmValidationError } from './errors.ts';
import { offerStanding, type OfferService, type OfferStanding } from './offer-service.ts';
import { createdBounds, type CreatedPeriod } from './opportunity-service.ts';
import type { CrmRepository } from './repository.ts';
import {
  addRecordActivity,
  contactName,
  findInOrg,
  inOrg,
  leadLabel,
  newId,
  opt,
  requireInOrg,
  str,
  type Body,
} from './scope.ts';
import {
  hashToken,
  newShareToken,
  sealToken,
  sha256Hex,
  TOKEN_PATTERN,
  unsealToken,
  type ShareKey,
} from './share-token.ts';
import type {
  CrmContext,
  CrmData,
  Offer,
  OfferDocument,
  OfferEvent,
  OfferShareLink,
  Opportunity,
} from './types.ts';

/** What the PDF check reports; it throws DocumentRejected for a file it refuses. */
export interface PdfInfo {
  readonly pageCount: number;
}

/** A refused upload, with the message to show (MESSAGES.document*). */
export class DocumentRejected extends Error {
  override name = 'DocumentRejected';
}

export interface FollowUpOptions {
  readonly documents: DocumentStore;
  /** Parses the PDF; throws DocumentRejected when it is not a usable PDF. */
  readonly inspectPdf: (bytes: Uint8Array) => Promise<PdfInfo>;
  /** AES-GCM key that seals share tokens (share-token.ts deriveShareKey). */
  readonly shareKey: Promise<ShareKey>;
  readonly maxBytes?: number;
  /** Lifetime of a new share link (days). */
  readonly linkTtlDays?: number;
  /** Engagement events older than this are deleted (days). */
  readonly retentionDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STAGING_TTL_MS = 60 * 60 * 1000;
const STAGED_PER_USER = 10;
const MAX_EVENTS_PER_LINK = 5000;
const SESSION_ID = /^[A-Za-z0-9-]{16,64}$/;

export type LinkStatus = 'active' | 'revoked' | 'expired';
export const FOLLOW_UP_FILTERS = ['all', 'waiting', 'viewed', 'resolved'] as const;
export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number];

const RESOLVED: ReadonlySet<OfferStanding> = new Set(['answered', 'withdrawn', 'closed']);

interface StagedUpload {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly pageCount: number;
  readonly sha256: string;
  readonly expiresAt: number;
}

/** A display file name: no path, no control characters, at most 200 characters, ending in .pdf. */
export function sanitizeFileName(raw: unknown): string {
  const base = String(raw ?? '')
    .split(/[\\/]/)
    .pop()!
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const name = (base || 'ponuda.pdf').slice(0, 200);
  return /\.pdf$/i.test(name) ? name : `${name.replace(/\.+$/, '')}.pdf`;
}

/** The `%PDF-` header must appear within the first 1024 bytes (PDF 1.7, 7.5.2). */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export const linkStatus = (link: OfferShareLink, now: Date): LinkStatus =>
  link.revokedAt ? 'revoked' : Date.parse(link.expiresAt) <= now.getTime() ? 'expired' : 'active';

export function createFollowUpService(
  repo: CrmRepository,
  offers: OfferService,
  options: FollowUpOptions,
) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
  const linkTtlDays = options.linkTtlDays ?? 90;
  const retentionDays = options.retentionDays ?? 365;
  const staged = new Map<string, StagedUpload>();
  let lastPrune = 0;

  // ------------------------------------------------------------ helpers ---
  /** The offer's newest link (on equal times, the one created last). */
  const latestLink = (data: CrmData, offerId: string, organizationId: string) => {
    let latest: OfferShareLink | undefined;
    for (const l of data.offerShareLinks) {
      if (l.offerId !== offerId || l.organizationId !== organizationId) continue;
      if (!latest || l.createdAt >= latest.createdAt) latest = l;
    }
    return latest;
  };
  const activeDocument = (data: CrmData, offerId: string, organizationId: string) =>
    data.offerDocuments
      .filter((d) => d.offerId === offerId && d.organizationId === organizationId && !d.replacedAt)
      .sort((a, b) => b.version - a.version)[0];
  const eventsOf = (data: CrmData, offerId: string, organizationId: string) =>
    data.offerEvents.filter((e) => e.offerId === offerId && e.organizationId === organizationId);

  async function newLink(
    ctx: CrmContext,
    offer: Offer,
    document: OfferDocument,
  ): Promise<{ link: OfferShareLink; token: string }> {
    const token = newShareToken();
    const now = ctx.now.toISOString();
    const link: OfferShareLink = {
      id: newId(),
      organizationId: ctx.organizationId,
      offerId: offer.id,
      documentId: document.id,
      tokenHash: await hashToken(token),
      tokenSealed: await sealToken(await options.shareKey, token),
      expiresAt: new Date(ctx.now.getTime() + linkTtlDays * DAY_MS).toISOString(),
      revokedAt: null,
      revokedBy: null,
      createdBy: ctx.user.id,
      createdAt: now,
      updatedAt: now,
    };
    return { link, token };
  }

  function pruneStaged(nowMs: number) {
    for (const [id, upload] of staged) {
      if (upload.expiresAt <= nowMs) {
        staged.delete(id);
        options.documents.delete(stagingKey(id)).catch(() => {});
      }
    }
  }

  function pruneEvents(data: CrmData, now: Date) {
    if (now.getTime() - lastPrune < 60 * 60 * 1000) return false;
    lastPrune = now.getTime();
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
    const before = data.offerEvents.length;
    data.offerEvents = data.offerEvents.filter((e) => e.occurredAt >= cutoff);
    return data.offerEvents.length !== before;
  }

  /** Where the offer stands now, its wait, and what the customer's side shows. */
  function itemView(data: CrmData, ctx: CrmContext, offer: Offer) {
    const opportunity = offer.opportunityId
      ? findInOrg(data.opportunities, ctx, offer.opportunityId)
      : undefined;
    const customer = findInOrg(data.customers, ctx, offer.companyId);
    const lead = findInOrg(data.leads, ctx, opportunity?.leadId);
    const standing = offerStanding(offer, opportunity, ctx.now.getTime());
    const waitingDays =
      standing === 'waiting' && offer.sentAt
        ? offerWaitingDays(new Date(offer.sentAt), ctx.now, ctx.timeZone)
        : null;
    const document = activeDocument(data, offer.id, ctx.organizationId);
    const link = latestLink(data, offer.id, ctx.organizationId);
    const engagement = engagementSummary(eventsOf(data, offer.id, ctx.organizationId));
    return {
      offerId: offer.id,
      title: offer.title,
      status: offer.status,
      standing,
      companyId: offer.companyId,
      customerName: customer?.companyName ?? '',
      customerActive: customer ? customer.status !== 'inactive' : true,
      // An offer within a lead's deal before the lead is a customer (ADR-0009).
      leadId: lead?.id ?? null,
      leadName: lead ? leadLabel(lead) : null,
      opportunityId: opportunity?.id ?? null,
      opportunityTitle: opportunity?.title ?? '',
      createdAt: offer.createdAt,
      sentAt: offer.sentAt,
      answeredAt: offer.answeredAt,
      withdrawnAt: offer.withdrawnAt,
      waitingDays,
      band: (waitingDays === null ? null : waitingBand(waitingDays)) as WaitingBand | null,
      hasDocument: Boolean(document),
      fileName: document?.fileName ?? null,
      linkStatus: link ? linkStatus(link, ctx.now) : null,
      engagement,
    };
  }
  type FollowUpItem = ReturnType<typeof itemView>;

  function requireOffer(data: CrmData, ctx: CrmContext, id: string): Offer {
    return requireInOrg(data.offers, ctx, id);
  }

  /**
   * The relations a new offer points at, all in the caller's organization:
   * a customer (optionally one of its deals and contacts), or — ADR-0009 — a
   * lead and one of its deals, before the lead is a customer. A lead's deal
   * that already has its customer gives the offer that customer.
   */
  function checkRelations(data: CrmData, ctx: CrmContext, input: Body) {
    const errors: Record<string, string> = {};
    const companyId = opt(input.companyId);
    const leadId = opt(input.leadId);
    const customer = companyId ? findInOrg(data.customers, ctx, companyId) : undefined;
    const lead = !companyId && leadId ? findInOrg(data.leads, ctx, leadId) : undefined;
    if (companyId && !customer) errors.companyId = MESSAGES.unavailable;
    if (!companyId && leadId && !lead) errors.leadId = MESSAGES.unavailable;
    let opportunity: Opportunity | undefined;
    const opportunityId = opt(input.opportunityId);
    if (opportunityId) {
      opportunity = findInOrg(data.opportunities, ctx, opportunityId);
      if (!opportunity) errors.opportunityId = MESSAGES.unavailable;
      else if (customer && opportunity.companyId !== customer.id) {
        errors.opportunityId = MESSAGES.opportunityNotOfCustomer;
      } else if (lead && opportunity.leadId !== lead.id) {
        errors.opportunityId = MESSAGES.opportunityNotOfLead;
      } else if (opportunity.status !== 'active') {
        errors.opportunityId = MESSAGES.opportunityClosed;
      }
    } else if (lead) {
      errors.opportunityId = 'Odaberite priliku leada.';
    }
    const owner = customer ?? findInOrg(data.customers, ctx, opportunity?.companyId);
    const contactId = opt(input.contactId);
    if (contactId) {
      const contact = findInOrg(data.contacts, ctx, contactId);
      if (!contact) errors.contactId = MESSAGES.unavailable;
      else if (!owner || contact.companyId !== owner.id) {
        errors.contactId = MESSAGES.contactNotOfCustomer;
      }
    }
    if (hasErrors(errors)) {
      throw new CrmValidationError(
        errors,
        Object.values(errors).includes(MESSAGES.unavailable) ? MESSAGES.unavailable : undefined,
      );
    }
    return { customer: owner ?? null, opportunity, contactId };
  }

  /** Resolves a public token to its live link, offer and document; null for anything else. */
  async function resolveToken(token: string, now: Date) {
    if (!TOKEN_PATTERN.test(token)) return null;
    const hash = await hashToken(token);
    const data = repo.data();
    const link = data.offerShareLinks.find((l) => l.tokenHash === hash);
    if (!link || linkStatus(link, now) !== 'active') return null;
    const offer = data.offers.find(
      (o) => o.id === link.offerId && o.organizationId === link.organizationId,
    );
    const document = data.offerDocuments.find(
      (d) => d.id === link.documentId && d.organizationId === link.organizationId,
    );
    if (!offer || !document) return null;
    return { data, link, offer, document };
  }
  type Resolution = NonNullable<Awaited<ReturnType<typeof resolveToken>>>;

  function pushEvent(
    resolution: Resolution,
    type: OfferEvent['type'],
    now: Date,
    sessionId: string | null,
    signals: RequestSignals,
  ) {
    const { data, link } = resolution;
    const ofLink = data.offerEvents.filter((e) => e.shareLinkId === link.id);
    if (ofLink.length >= MAX_EVENTS_PER_LINK) return null; // flood guard
    let { suspectedBot, reason } = classifyRequest(signals);
    if (!suspectedBot && type === 'link_access') {
      const previous = ofLink.filter((e) => e.type === 'link_access').at(-1);
      if (previous && now.getTime() - Date.parse(previous.occurredAt) < RAPID_REPEAT_MS) {
        suspectedBot = true;
        reason = 'rapid_repeat';
      }
    }
    const event: OfferEvent = {
      id: newId(),
      organizationId: link.organizationId,
      offerId: link.offerId,
      shareLinkId: link.id,
      type,
      occurredAt: now.toISOString(),
      sessionId,
      suspectedBot,
      botReason: reason,
      client: clientFamily(signals.userAgent),
    };
    data.offerEvents.push(event);
    return event;
  }

  return {
    maxBytes,

    // ------------------------------------------------- internal (session) ---
    /**
     * Step 1 of "Attach new document": validates and stores the PDF privately,
     * staged for an hour under a server id until the form is saved.
     */
    async stageUpload(
      ctx: CrmContext,
      file: { bytes: Uint8Array; fileName: unknown; contentType: unknown },
    ) {
      const type = String(file.contentType ?? '')
        .split(';')[0]!
        .trim()
        .toLowerCase();
      if (type !== 'application/pdf') {
        throw new CrmValidationError(
          { document: MESSAGES.documentUnsupported },
          MESSAGES.documentUnsupported,
        );
      }
      if (file.bytes.length === 0) {
        throw new CrmValidationError({ document: MESSAGES.documentEmpty }, MESSAGES.documentEmpty);
      }
      if (file.bytes.length > maxBytes) {
        throw new CrmValidationError(
          { document: MESSAGES.documentTooLarge },
          MESSAGES.documentTooLarge,
        );
      }
      if (!hasPdfHeader(file.bytes)) {
        throw new CrmValidationError(
          { document: MESSAGES.documentInvalid },
          MESSAGES.documentInvalid,
        );
      }
      let info: PdfInfo;
      try {
        info = await options.inspectPdf(file.bytes);
      } catch (error) {
        const message =
          error instanceof DocumentRejected ? error.message : MESSAGES.documentInvalid;
        throw new CrmValidationError({ document: message }, message);
      }
      const nowMs = ctx.now.getTime();
      pruneStaged(nowMs);
      const mine = [...staged.values()]
        .filter((u) => u.organizationId === ctx.organizationId && u.userId === ctx.user.id)
        .sort((a, b) => a.expiresAt - b.expiresAt);
      for (const old of mine.slice(0, Math.max(0, mine.length - STAGED_PER_USER + 1))) {
        staged.delete(old.id);
        await options.documents.delete(stagingKey(old.id)).catch(() => {});
      }
      const upload: StagedUpload = {
        id: newId(),
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        fileName: sanitizeFileName(file.fileName),
        sizeBytes: file.bytes.length,
        pageCount: info.pageCount,
        sha256: await sha256Hex(file.bytes),
        expiresAt: nowMs + STAGING_TTL_MS,
      };
      await options.documents.put(stagingKey(upload.id), file.bytes);
      staged.set(upload.id, upload);
      return {
        uploadId: upload.id,
        fileName: upload.fileName,
        sizeBytes: upload.sizeBytes,
        pageCount: upload.pageCount,
        contentType: 'application/pdf',
      };
    },

    /**
     * Step 2, "Spremi i generiraj link": the offer (a draft until marked sent),
     * its document and a share link, in one transaction, with the staged file
     * moved into place. Fails as a whole: never a link without a file.
     */
    async createOffer(ctx: CrmContext, input: Body) {
      const errors = validateFollowUpOffer(input);
      if (hasErrors(errors)) throw new CrmValidationError(errors);
      const data = repo.data();
      const { customer, opportunity, contactId } = checkRelations(data, ctx, input);
      const upload = staged.get(str(input.uploadId));
      if (
        !upload ||
        upload.organizationId !== ctx.organizationId ||
        upload.userId !== ctx.user.id ||
        upload.expiresAt <= ctx.now.getTime()
      ) {
        throw new CrmValidationError(
          { document: MESSAGES.documentUploadFailed },
          MESSAGES.documentUploadFailed,
        );
      }

      const now = ctx.now.toISOString();
      const offer: Offer = {
        id: newId(),
        organizationId: ctx.organizationId,
        companyId: customer?.id ?? null,
        opportunityId: opportunity?.id ?? null,
        contactId: contactId ?? null,
        title: str(input.title),
        status: 'draft',
        sentAt: null,
        answeredAt: null,
        withdrawnAt: null,
        createdBy: ctx.user.id,
        note: str(input.note),
        createdAt: now,
        updatedAt: now,
      };
      const documentId = newId();
      const document: OfferDocument = {
        id: documentId,
        organizationId: ctx.organizationId,
        offerId: offer.id,
        storageKey: documentKey(ctx.organizationId, offer.id, documentId),
        fileName: upload.fileName,
        contentType: 'application/pdf',
        sizeBytes: upload.sizeBytes,
        pageCount: upload.pageCount,
        sha256: upload.sha256,
        version: 1,
        replacedAt: null,
        uploadedBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      };
      let share: { link: OfferShareLink; token: string };
      try {
        share = await newLink(ctx, offer, document);
      } catch {
        throw new CrmValidationError({ link: MESSAGES.linkFailed }, MESSAGES.linkFailed);
      }

      // Claimed before any await: a double tap cannot use the same upload twice.
      staged.delete(upload.id);
      try {
        await options.documents.move(stagingKey(upload.id), document.storageKey);
      } catch {
        throw new CrmValidationError(
          { document: MESSAGES.documentUploadFailed },
          MESSAGES.documentUploadFailed,
        );
      }
      try {
        repo.transaction(() => {
          const live = repo.data();
          live.offers.push(offer);
          live.offerDocuments.push(document);
          live.offerShareLinks.push(share.link);
          repo.commit();
        });
      } catch (error) {
        await options.documents.delete(document.storageKey).catch(() => {});
        throw error;
      }
      return { offerId: offer.id, token: share.token };
    },

    /**
     * The Follow-up Engine overview, unresolved offers first. Without a period:
     * every offer. With one (calendar dates, as on Ponude): the offers CREATED
     * in it; a period that runs up to today also keeps the earlier offers that
     * are still unresolved, so an offer waiting since last quarter stays in
     * reach. Each offer's standing, wait and views are its own, as of now,
     * whatever the period.
     */
    list(ctx: CrmContext, filter: unknown = 'all', period: CreatedPeriod = {}) {
      const wanted = (filter || 'all') as FollowUpFilter;
      if (!FOLLOW_UP_FILTERS.includes(wanted)) {
        throw new CrmValidationError({ filter: 'Neispravan filtar.' });
      }
      const bounds = createdBounds(ctx, period);
      const now = ctx.now.getTime();
      const includesToday = bounds !== null && bounds.from <= now && now < bounds.to;
      const data = repo.data();
      const all: FollowUpItem[] = [];
      let earlierUnresolved = 0;
      for (const offer of inOrg(data.offers, ctx)) {
        const created = Date.parse(offer.createdAt);
        const inPeriod = !bounds || (created >= bounds.from && created < bounds.to);
        const earlier = includesToday && created < bounds.from;
        if (!inPeriod && !earlier) continue;
        const item = itemView(data, ctx, offer);
        if (!inPeriod) {
          if (RESOLVED.has(item.standing)) continue;
          earlierUnresolved += 1;
        }
        all.push(item);
      }
      const matches: Record<FollowUpFilter, (i: FollowUpItem) => boolean> = {
        all: () => true,
        waiting: (i) => i.standing === 'waiting',
        viewed: (i) => !RESOLVED.has(i.standing) && i.engagement.viewCount > 0,
        resolved: (i) => RESOLVED.has(i.standing),
      };
      const rank = (i: FollowUpItem) =>
        i.standing === 'waiting' ? 0 : i.standing === 'draft' ? 1 : 2;
      const latest = (i: FollowUpItem) => i.answeredAt ?? i.withdrawnAt ?? i.sentAt ?? i.createdAt;
      all.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (b.waitingDays ?? 0) - (a.waitingDays ?? 0) ||
          latest(b).localeCompare(latest(a)),
      );
      return {
        period: bounds
          ? { from: String(period.from), to: String(period.to), includesToday, earlierUnresolved }
          : null,
        counts: Object.fromEntries(
          FOLLOW_UP_FILTERS.map((f) => [f, all.filter(matches[f]).length]),
        ) as Record<FollowUpFilter, number>,
        items: all.filter(matches[wanted]),
      };
    },

    /** One offer with its document, link, engagement and history (latest 50 events). */
    async detail(ctx: CrmContext, id: string) {
      const data = repo.data();
      const offer = requireOffer(data, ctx, id);
      const item = itemView(data, ctx, offer);
      const document = activeDocument(data, offer.id, ctx.organizationId);
      const link = latestLink(data, offer.id, ctx.organizationId);
      const token = link ? await unsealToken(await options.shareKey, link.tokenSealed) : null;
      const contact = offer.contactId ? findInOrg(data.contacts, ctx, offer.contactId) : undefined;
      // Sessions as "Sesija 1, 2 …" in the order they first appeared.
      const sessionNo = new Map<string, number>();
      const events = eventsOf(data, offer.id, ctx.organizationId)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        .map((e) => {
          if (e.sessionId && !sessionNo.has(e.sessionId)) {
            sessionNo.set(e.sessionId, sessionNo.size + 1);
          }
          return {
            id: e.id,
            type: e.type,
            occurredAt: e.occurredAt,
            suspectedBot: e.suspectedBot,
            botReason: e.botReason,
            client: e.client,
            session: e.sessionId ? sessionNo.get(e.sessionId)! : null,
          };
        })
        .reverse()
        .slice(0, 50);
      return {
        ...item,
        note: offer.note,
        contactId: contact?.id ?? null,
        contactName: contact ? contactName(contact) : null,
        document: document
          ? {
              id: document.id,
              fileName: document.fileName,
              sizeBytes: document.sizeBytes,
              pageCount: document.pageCount,
              uploadedAt: document.createdAt,
              version: document.version,
            }
          : null,
        link: link
          ? {
              status: linkStatus(link, ctx.now),
              createdAt: link.createdAt,
              expiresAt: link.expiresAt,
              revokedAt: link.revokedAt,
              // The path only while the link works; null if the token cannot be unsealed.
              path: linkStatus(link, ctx.now) === 'active' && token ? `/o/${token}` : null,
            }
          : null,
        events,
      };
    },

    /**
     * "Označi kao poslano": the wait starts here. `sentAt` (ISO) may be earlier
     * than now (e-mail sent before), never in the future or over a year ago.
     * A recorded sending is never overwritten.
     */
    markSent(ctx: CrmContext, id: string, input: Body) {
      const data = repo.data();
      const offer = requireOffer(data, ctx, id);
      if (offer.status !== 'draft') {
        throw new CrmValidationError(
          { status: MESSAGES.offerAlreadySent },
          MESSAGES.offerAlreadySent,
        );
      }
      let sentAt = ctx.now;
      if (input.sentAt !== undefined && input.sentAt !== null && input.sentAt !== '') {
        const parsed = new Date(String(input.sentAt));
        if (typeof input.sentAt !== 'string' || Number.isNaN(parsed.getTime())) {
          throw new CrmValidationError({ sentAt: 'Neispravan datum ili vrijeme.' });
        }
        if (parsed.getTime() > ctx.now.getTime() + 60_000) {
          throw new CrmValidationError({ sentAt: MESSAGES.sentInFuture }, MESSAGES.sentInFuture);
        }
        if (parsed.getTime() < ctx.now.getTime() - 365 * DAY_MS) {
          throw new CrmValidationError({ sentAt: MESSAGES.sentTooOld }, MESSAGES.sentTooOld);
        }
        sentAt = parsed;
      }
      const opportunity = offer.opportunityId
        ? findInOrg(data.opportunities, ctx, offer.opportunityId)
        : undefined;
      if (opportunity && opportunity.status !== 'active') {
        throw new CrmValidationError(
          { opportunityId: MESSAGES.opportunityClosed },
          MESSAGES.opportunityClosed,
        );
      }
      Object.assign(offer, {
        status: 'sent',
        sentAt: sentAt.toISOString(),
        updatedAt: ctx.now.toISOString(),
      });
      addRecordActivity(
        data,
        ctx,
        { companyId: offer.companyId, leadId: opportunity?.leadId },
        'offer_sent',
        opportunity ? `${offer.title} · ${opportunity.title}` : offer.title,
        opportunity?.id ?? offer.id,
      );
      repo.commit();
      return itemView(data, ctx, offer);
    },

    /** "Označi odgovorenim": the customer answered (a view is not an answer). */
    markAnswered(ctx: CrmContext, id: string) {
      offers.markAnswered(ctx, id);
      const data = repo.data();
      return itemView(data, ctx, requireOffer(data, ctx, id));
    },

    /** "Opozovi link": the link stops working at once. The offer itself is unchanged. */
    revokeLink(ctx: CrmContext, id: string) {
      const data = repo.data();
      const offer = requireOffer(data, ctx, id);
      const link = latestLink(data, offer.id, ctx.organizationId);
      if (!link || linkStatus(link, ctx.now) !== 'active') throw new CrmNotFoundError();
      Object.assign(link, {
        revokedAt: ctx.now.toISOString(),
        revokedBy: ctx.user.id,
        updatedAt: ctx.now.toISOString(),
      });
      repo.commit();
      return itemView(data, ctx, offer);
    },

    /** "Generiraj novi link": after a link was revoked or expired (the old one stays dead). */
    async issueLink(ctx: CrmContext, id: string) {
      const data = repo.data();
      const offer = requireOffer(data, ctx, id);
      const document = activeDocument(data, offer.id, ctx.organizationId);
      if (!document) throw new CrmNotFoundError();
      const current = latestLink(data, offer.id, ctx.organizationId);
      if (current && linkStatus(current, ctx.now) === 'active') {
        throw new CrmValidationError({ link: MESSAGES.linkActive }, MESSAGES.linkActive);
      }
      const share = await newLink(ctx, offer, document);
      repo.data().offerShareLinks.push(share.link);
      repo.commit();
      return { token: share.token };
    },

    /** The PDF for the salesperson's own preview (never counted as a customer view). */
    async readDocument(ctx: CrmContext, id: string) {
      const data = repo.data();
      const offer = requireOffer(data, ctx, id);
      const document = activeDocument(data, offer.id, ctx.organizationId);
      if (!document) throw new CrmNotFoundError();
      const bytes = await options.documents.get(document.storageKey);
      if (!bytes) throw new CrmNotFoundError();
      return { bytes, fileName: document.fileName };
    },

    // --------------------------------------------- public (bearer token) ---
    /**
     * The viewer page was requested. Recorded as `link_access` (scanners
     * included, flagged when they look automated) unless `internal` (a signed-in
     * Renvara user: the salesperson's own clicks are not customer engagement).
     */
    async recordAccess(token: string, signals: RequestSignals, now: Date, internal: boolean) {
      const resolution = await resolveToken(token, now);
      if (!resolution) return false;
      if (internal) return true;
      pushEvent(resolution, 'link_access', now, null, signals);
      pruneEvents(resolution.data, now);
      repo.commit();
      return true;
    },

    /** What the viewer may show: the title and the file. Nothing internal. */
    async publicInfo(token: string, now: Date) {
      const resolution = await resolveToken(token, now);
      if (!resolution) return null;
      return {
        title: resolution.offer.title,
        fileName: resolution.document.fileName,
        pageCount: resolution.document.pageCount,
        sizeBytes: resolution.document.sizeBytes,
      };
    },

    async publicDocument(token: string, now: Date) {
      const resolution = await resolveToken(token, now);
      if (!resolution) return null;
      const bytes = await options.documents.get(resolution.document.storageKey);
      return bytes ? { bytes, fileName: resolution.document.fileName } : null;
    },

    /**
     * The viewer rendered the PDF in a visible tab: `document_view`, at most
     * once per viewing session per 30 minutes. The first qualifying view of an
     * offer also goes on the customer's timeline ("Pregled ponude zabilježen").
     */
    async recordView(
      token: string,
      input: { sessionId: unknown; automation?: unknown },
      signals: RequestSignals,
      now: Date,
      internal: boolean,
    ): Promise<'recorded' | 'duplicate' | 'internal' | 'invalid' | null> {
      if (typeof input.sessionId !== 'string' || !SESSION_ID.test(input.sessionId)) {
        return 'invalid';
      }
      const resolution = await resolveToken(token, now);
      if (!resolution) return null;
      if (internal) return 'internal';
      const { data, link, offer } = resolution;
      const sessionId = input.sessionId;
      const recent = data.offerEvents.some(
        (e) =>
          e.shareLinkId === link.id &&
          e.type === 'document_view' &&
          e.sessionId === sessionId &&
          now.getTime() - Date.parse(e.occurredAt) < VIEW_DEDUP_MS,
      );
      if (recent) return 'duplicate';
      const firstView = !data.offerEvents.some(
        (e) => e.offerId === offer.id && e.type === 'document_view' && !e.suspectedBot,
      );
      const event = pushEvent(resolution, 'document_view', now, sessionId, {
        ...signals,
        automation: input.automation === true,
      });
      if (event && !event.suspectedBot && firstView) {
        const deal = offer.opportunityId
          ? data.opportunities.find(
              (o) => o.id === offer.opportunityId && o.organizationId === link.organizationId,
            )
          : undefined;
        const activity = addRecordActivity(
          data,
          {
            organizationId: link.organizationId,
            user: { id: '', displayName: '' },
            timeZone: 'UTC',
            now,
          },
          { companyId: offer.companyId, leadId: deal?.leadId },
          'offer_viewed',
          offer.title,
          offer.id,
        );
        // Not done by a Renvara user.
        activity.actorId = null;
        activity.actorName = null;
      }
      repo.commit();
      return event ? 'recorded' : 'duplicate';
    },

    /** Engagement of one offer (tests, other modules). */
    engagement(ctx: CrmContext, id: string): EngagementSummary {
      const data = repo.data();
      const offer = requireOffer(data, ctx, id);
      return engagementSummary(eventsOf(data, offer.id, ctx.organizationId));
    },
  };
}

export type FollowUpService = ReturnType<typeof createFollowUpService>;
