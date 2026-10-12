// OfferService: sales offers sent within an opportunity, and the FEEDBACK
// OVERVIEW built from them. An offer waits for feedback from the moment it is
// recorded as sent until the customer's answer is recorded (or its deal is
// won or lost). Nothing else counts: no drafts, no uploads, no tasks, no
// viewed PDFs. Answered offers are kept with their dates.
import { byUrgency, offerWaitingDays, waitingBand, type WaitingBand } from '@renvara/domain';
import { addDays, isDateKey, validateRange } from '../../public/app/js/core/period.js';
import { hasErrors, MESSAGES, validateOffer } from '../../public/app/js/core/validation.js';
import { CrmValidationError } from './errors.ts';
import type { CrmRepository } from './repository.ts';
import { addActivity, findInOrg, inOrg, newId, requireInOrg, str, type Body } from './scope.ts';
import { calendarDateInZone, startOfDayInZone, zonedDateTime } from './time.ts';
import type { CrmContext, CrmData, Customer, Offer, Opportunity } from './types.ts';

export interface FeedbackItem {
  offerId: string;
  title: string;
  opportunityId: string;
  opportunityTitle: string;
  companyId: string;
  customerName: string;
  /** For a quick call from the overview, when the deal has a contact with a phone. */
  contactPhone: string | null;
  sentAt: string;
  waitingDays: number;
  band: WaitingBand;
}

/**
 * Offers waiting for feedback as of `asOf`: sent by then, not answered or
 * withdrawn by then, and their deal not yet closed by then. A past period is
 * therefore reconstructed from the recorded dates, never from today's state.
 */
export function feedbackItems(data: CrmData, ctx: CrmContext, asOf: Date): FeedbackItem[] {
  const at = asOf.getTime();
  const after = (iso: string | null | undefined) => !iso || Date.parse(iso) > at;
  const items: FeedbackItem[] = [];
  for (const offer of inOrg(data.offers, ctx)) {
    if (offer.status === 'draft' || !offer.sentAt || Date.parse(offer.sentAt) > at) continue;
    if (!after(offer.answeredAt) || !after(offer.withdrawnAt)) continue;
    const opportunity = findInOrg(data.opportunities, ctx, offer.opportunityId);
    if (!opportunity || !after(opportunity.closedAt)) continue;
    const customer = findInOrg(data.customers, ctx, opportunity.companyId);
    const contact = findInOrg(
      data.contacts,
      ctx,
      opportunity.contactId ?? customer?.primaryContactId,
    );
    const waitingDays = offerWaitingDays(new Date(offer.sentAt), asOf, ctx.timeZone);
    items.push({
      offerId: offer.id,
      title: offer.title,
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      companyId: opportunity.companyId,
      customerName: customer?.companyName ?? '',
      contactPhone: contact?.phone || customer?.phone || null,
      sentAt: offer.sentAt,
      waitingDays,
      band: waitingBand(waitingDays),
    });
  }
  return items.sort(byUrgency);
}

/**
 * Where an offer stood at an instant, from its recorded dates only:
 * withdrawn / answered by then, not yet sent then (`draft`), its deal already
 * won or lost then (`closed`: no feedback awaited any more), else `waiting`.
 */
export type OfferStanding = 'waiting' | 'draft' | 'answered' | 'withdrawn' | 'closed';
export const OFFER_FILTERS = ['all', 'waiting', 'answered', 'draft'] as const;
export type OfferFilter = (typeof OFFER_FILTERS)[number];

export function offerStanding(offer: Offer, opportunity: Opportunity | undefined, at: number) {
  const by = (iso: string | null | undefined) => Boolean(iso) && Date.parse(iso!) <= at;
  // A status without its date (never written so, but kept safe) counts from the start.
  if (by(offer.withdrawnAt) || (offer.status === 'withdrawn' && !offer.withdrawnAt)) {
    return 'withdrawn';
  }
  if (by(offer.answeredAt) || (offer.status === 'answered' && !offer.answeredAt)) return 'answered';
  if (offer.status === 'draft' || !by(offer.sentAt)) return 'draft';
  if (opportunity && opportunity.status !== 'active' && by(opportunity.closedAt)) return 'closed';
  return 'waiting';
}

export interface OfferOverviewItem {
  offerId: string;
  title: string;
  /** As of the period's end (now, for the running period). */
  standing: OfferStanding;
  /** Today. Differs from `standing` only when looking at a past period. */
  standingNow: OfferStanding;
  waitingDays: number | null;
  band: WaitingBand | null;
  createdAt: string;
  sentAt: string | null;
  answeredAt: string | null;
  withdrawnAt: string | null;
  opportunityId: string;
  opportunityTitle: string;
  companyId: string;
  customerName: string;
  customerActive: boolean;
}

const STANDING_ORDER: Record<OfferStanding, number> = {
  waiting: 0,
  draft: 1,
  answered: 2,
  closed: 3,
  withdrawn: 4,
};

/**
 * FEEDBACK OVERVIEW / PONUDE: the offers CREATED in [startDate, endDate]
 * (calendar dates in the organization's timezone), each with where it stood
 * at the end of the period (or now, for the running one) and, while it was
 * waiting, the days since it was actually SENT. Waiting offers first, most
 * urgent first; then drafts, answered, closed, withdrawn, newest first.
 */
export function offersOverview(
  data: CrmData,
  ctx: CrmContext,
  range: { startDate: string; endDate: string },
  filter: OfferFilter = 'all',
) {
  const from = startOfDayInZone(range.startDate, ctx.timeZone).getTime();
  const to = startOfDayInZone(addDays(range.endDate, 1), ctx.timeZone).getTime();
  const now = ctx.now.getTime();
  const asOf = new Date(Math.min(to - 1, now));
  // One pass over the related records (no lookup per offer).
  const opportunities = new Map<string, Opportunity>(
    inOrg(data.opportunities, ctx).map((o) => [o.id, o]),
  );
  const customers = new Map<string, Customer>(inOrg(data.customers, ctx).map((c) => [c.id, c]));
  const all: OfferOverviewItem[] = [];
  for (const offer of inOrg(data.offers ?? [], ctx)) {
    const created = Date.parse(offer.createdAt);
    if (created < from || created >= to) continue;
    const opportunity = opportunities.get(offer.opportunityId);
    const customer = opportunity ? customers.get(opportunity.companyId) : undefined;
    const standing = offerStanding(offer, opportunity, asOf.getTime());
    const waitingDays =
      standing === 'waiting' ? offerWaitingDays(new Date(offer.sentAt!), asOf, ctx.timeZone) : null;
    all.push({
      offerId: offer.id,
      title: offer.title,
      standing,
      standingNow: offerStanding(offer, opportunity, now),
      waitingDays,
      band: waitingDays === null ? null : waitingBand(waitingDays),
      createdAt: offer.createdAt,
      sentAt: offer.sentAt,
      answeredAt: offer.answeredAt,
      withdrawnAt: offer.withdrawnAt,
      opportunityId: offer.opportunityId,
      opportunityTitle: opportunity?.title ?? '',
      companyId: opportunity?.companyId ?? '',
      customerName: customer?.companyName ?? '',
      customerActive: customer ? customer.status !== 'inactive' : true,
    });
  }
  const latest = (i: OfferOverviewItem) => i.withdrawnAt ?? i.answeredAt ?? i.sentAt ?? i.createdAt;
  all.sort(
    (a, b) =>
      STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing] ||
      (b.waitingDays ?? 0) - (a.waitingDays ?? 0) ||
      latest(b).localeCompare(latest(a)),
  );
  const count = (f: OfferFilter) =>
    f === 'all' ? all.length : all.filter((i) => i.standing === f).length;
  return {
    period: { ...range, asOf: asOf.toISOString(), isCurrent: now < to },
    counts: {
      all: all.length,
      waiting: count('waiting'),
      answered: count('answered'),
      draft: count('draft'),
    },
    items: filter === 'all' ? all : all.filter((i) => i.standing === filter),
  };
}

/** An offer as an opportunity shows it, with its current wait while unanswered. */
export function offerView(offer: Offer, ctx: CrmContext, opportunity: Opportunity) {
  const waiting = offer.status === 'sent' && opportunity.status === 'active' && offer.sentAt;
  const waitingDays = waiting
    ? offerWaitingDays(new Date(offer.sentAt!), ctx.now, ctx.timeZone)
    : null;
  return { ...offer, waitingDays, band: waitingDays === null ? null : waitingBand(waitingDays) };
}

export function createOfferService(repo: CrmRepository) {
  function activeOpportunity(data: CrmData, ctx: CrmContext, id: unknown): Opportunity {
    const opportunity = findInOrg(data.opportunities, ctx, id);
    if (!opportunity) {
      throw new CrmValidationError({ opportunityId: MESSAGES.unavailable }, MESSAGES.unavailable);
    }
    if (opportunity.status !== 'active') {
      throw new CrmValidationError(
        { opportunityId: MESSAGES.opportunityClosed },
        MESSAGES.opportunityClosed,
      );
    }
    return opportunity;
  }

  return {
    /**
     * "Ponuda poslana": records an offer as sent, today or on an earlier day
     * (an earlier day counts from noon, so its calendar date is unambiguous).
     */
    recordSent(ctx: CrmContext, input: Body) {
      const today = calendarDateInZone(ctx.now, ctx.timeZone);
      const errors = validateOffer(input, { today });
      if (hasErrors(errors)) throw new CrmValidationError(errors);
      const data = repo.data();
      const opportunity = activeOpportunity(data, ctx, input.opportunityId);
      const sentDate = str(input.sentDate) || today;
      const sentAt = sentDate === today ? ctx.now : zonedDateTime(sentDate, '12:00', ctx.timeZone);
      const now = ctx.now.toISOString();
      const offer: Offer = {
        id: newId(),
        organizationId: ctx.organizationId,
        opportunityId: opportunity.id,
        title: str(input.title),
        status: 'sent',
        sentAt: sentAt.toISOString(),
        answeredAt: null,
        withdrawnAt: null,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      };
      data.offers.push(offer);
      addActivity(
        data,
        ctx,
        opportunity.companyId,
        'offer_sent',
        `${offer.title} · ${opportunity.title}`,
        opportunity.id,
      );
      repo.commit();
      return offerView(offer, ctx, opportunity);
    },

    /** "Odgovor primljen": the customer answered. The offer and its dates stay. */
    markAnswered(ctx: CrmContext, id: string) {
      const data = repo.data();
      const offer = requireInOrg(data.offers, ctx, id);
      if (offer.status !== 'sent') {
        throw new CrmValidationError(
          { status: MESSAGES.offerNotWaiting },
          MESSAGES.offerNotWaiting,
        );
      }
      const now = ctx.now.toISOString();
      Object.assign(offer, { status: 'answered', answeredAt: now, updatedAt: now });
      const opportunity = requireInOrg(data.opportunities, ctx, offer.opportunityId);
      addActivity(
        data,
        ctx,
        opportunity.companyId,
        'offer_answered',
        `${offer.title} · ${opportunity.title}`,
        opportunity.id,
      );
      repo.commit();
      return offerView(offer, ctx, opportunity);
    },

    listForOpportunity(ctx: CrmContext, opportunityId: string) {
      const data = repo.data();
      const opportunity = requireInOrg(data.opportunities, ctx, opportunityId);
      return inOrg(data.offers, ctx)
        .filter((o) => o.opportunityId === opportunityId)
        .sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt))
        .map((o) => offerView(o, ctx, opportunity));
    },

    /** FEEDBACK OVERVIEW as of an instant (now, or the end of a past period). */
    feedback(ctx: CrmContext, asOf: Date = ctx.now) {
      return feedbackItems(repo.data(), ctx, asOf);
    },

    /** FEEDBACK OVERVIEW / PONUDE for a period: see offersOverview(). */
    overview(ctx: CrmContext, startDate: unknown, endDate: unknown, filter: unknown = 'all') {
      const problem = validateRange(String(startDate ?? ''), String(endDate ?? ''));
      if (problem || !isDateKey(startDate) || !isDateKey(endDate)) {
        throw new CrmValidationError({ range: problem ?? 'Neispravan period.' });
      }
      const status = filter ?? 'all';
      if (!OFFER_FILTERS.includes(status as OfferFilter)) {
        throw new CrmValidationError({ status: 'Neispravan status ponude.' });
      }
      return offersOverview(
        repo.data(),
        ctx,
        { startDate: startDate as string, endDate: endDate as string },
        status as OfferFilter,
      );
    },
  };
}

export type OfferService = ReturnType<typeof createOfferService>;
