// OfferService: sales offers sent within an opportunity, and the FEEDBACK
// OVERVIEW built from them. An offer waits for feedback from the moment it is
// recorded as sent until the customer's answer is recorded (or its deal is
// won or lost). Nothing else counts: no drafts, no uploads, no tasks, no
// viewed PDFs. Answered offers are kept with their dates.
import { byUrgency, offerWaitingDays, waitingBand, type WaitingBand } from '@renvara/domain';
import { hasErrors, MESSAGES, validateOffer } from '../../public/app/js/core/validation.js';
import { CrmValidationError } from './errors.ts';
import type { CrmRepository } from './repository.ts';
import { addActivity, findInOrg, inOrg, newId, requireInOrg, str, type Body } from './scope.ts';
import { calendarDateInZone, zonedDateTime } from './time.ts';
import type { CrmContext, CrmData, Offer, Opportunity } from './types.ts';

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
  };
}

export type OfferService = ReturnType<typeof createOfferService>;
