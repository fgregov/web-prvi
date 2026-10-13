// NotificationService: MOBILNE OBAVIJESTI. Each member switches seven event
// types on or off for themselves (all off for a new user); the server turns the
// events of those types into push notifications:
//
//   offer_viewed          a qualifying view of a shared offer (follow-up-service)
//   reminder_due          an explicit reminder (the reminder system, unchanged)
//   task_deadline         an open task reaches its deadline ("Rok")
//   opportunity_deadline  an active opportunity reaches its expected close date
//   feedback_low/medium/high  a sent offer still waiting enters 1D / 5D / 10D
//
// Every notification is one delivery record with an idempotency key (one event
// = one notification, whatever the scheduler runs, retries or restarts do).
// Notifications are prospective: an event from before the type was switched on
// is never sent, and an event the server finds more than STALE_MS late is
// skipped instead of arriving out of context. No time is ever assumed: a
// deadline with a date only is notified at the time the user chose for that,
// or not at all. The lock-screen text never carries amounts, notes, contacts
// or link tokens.
import {
  BAND_START_DAY,
  bandEntryAt,
  NOTIFICATION_TYPES,
  offerWaitingDays,
  waitingBand,
  type NotificationType,
  type WaitingBand,
} from '@renvara/domain';
import { CrmValidationError } from './errors.ts';
import { offerStanding } from './offer-service.ts';
import { MAX_ATTEMPTS, RETRY_AFTER_MS, STALE_PROCESSING_MS } from './reminder-service.ts';
import type { CrmRepository } from './repository.ts';
import { findInOrg, leadLabel, newId, type Body } from './scope.ts';
import { zonedDateTime } from './time.ts';
import type {
  CrmContext,
  CrmData,
  NotificationDelivery,
  NotificationSettings,
  Offer,
  OfferEvent,
  Opportunity,
  Task,
} from './types.ts';

/** An event found later than this (server down) is skipped, not delivered out of context. */
export const STALE_MS = 24 * 60 * 60 * 1000;
/** Views of one offer: at most one notification per recipient in this window. */
export const VIEW_COOLDOWN_MS = 30 * 60 * 1000;

const FEEDBACK_TYPE: Record<WaitingBand, NotificationType> = {
  yellow: 'feedback_low',
  red: 'feedback_medium',
  black: 'feedback_high',
};
const FEEDBACK_TITLE: Record<WaitingBand, string> = {
  yellow: 'RENVARA — Feedback Overview',
  red: 'RENVARA — Follow-up prioritet',
  black: 'RENVARA — Visoki follow-up prioritet',
};
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** What the device shows (sw.js). */
export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
const dayWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'dan' : 'dana');

type Org = { organizationId: string };

export function createNotificationService(
  repo: CrmRepository,
  { delivery = true }: { delivery?: boolean } = {},
) {
  // ------------------------------------------------------------ lookups ---
  const preferenceOf = (data: CrmData, org: string, user: string, type: NotificationType) =>
    data.notificationPreferences.find(
      (p) => p.organizationId === org && p.userId === user && p.type === type,
    );
  const settingsOf = (data: CrmData, org: string, user: string) =>
    data.notificationSettings.find((s) => s.organizationId === org && s.userId === user);

  /** On now, and already on at `at` (events from before it was switched on are not sent). */
  function wants(data: CrmData, org: string, user: string, type: NotificationType, at: number) {
    const p = preferenceOf(data, org, user, type);
    return Boolean(p?.enabled && p.enabledAt && Date.parse(p.enabledAt) <= at);
  }
  const isOn = (data: CrmData, org: string, user: string, type: NotificationType) =>
    Boolean(preferenceOf(data, org, user, type)?.enabled);

  /** Who an offer's notifications go to: the salesperson who created it, else the deal's owner. */
  function offerRecipient(data: CrmData, offer: Offer): string | null {
    if (offer.createdBy) return offer.createdBy;
    const deal = findInOrg(data.opportunities, offer, offer.opportunityId);
    return deal?.ownerId ?? null;
  }
  /** The customer, or the lead for a lead's deal before conversion. */
  function offerParty(data: CrmData, offer: Offer): string {
    const customer = findInOrg(data.customers, offer, offer.companyId);
    if (customer) return customer.companyName;
    const deal = findInOrg(data.opportunities, offer, offer.opportunityId);
    const lead = findInOrg(data.leads, offer, deal?.leadId);
    return lead ? leadLabel(lead) : 'kupca';
  }
  /** A deal lives on its customer, or on its lead before the lead is a customer. */
  const dealUrl = (o: Opportunity) =>
    o.companyId
      ? `/customers/${encodeURIComponent(o.companyId)}#prilike`
      : `/leads/${encodeURIComponent(o.leadId ?? '')}#prilike`;

  /** A task's deadline instant: dueAt, or dueDate at the user's chosen time (else none). */
  function taskDeadline(settings: NotificationSettings | undefined, task: Task): number | null {
    if (task.dueAt) return Date.parse(task.dueAt);
    if (task.dueDate && settings?.deadlineTime) {
      return zonedDateTime(task.dueDate, settings.deadlineTime, settings.timeZone).getTime();
    }
    return null;
  }
  /** An opportunity's expected close date at the user's chosen time (else none). */
  function opportunityDeadline(
    settings: NotificationSettings | undefined,
    o: Opportunity,
  ): number | null {
    if (!o.expectedCloseDate || !settings?.deadlineTime) return null;
    return zonedDateTime(o.expectedCloseDate, settings.deadlineTime, settings.timeZone).getTime();
  }

  const taskKey = (task: Task, at: number) =>
    `task_deadline:${task.id}:${new Date(at).toISOString()}`;
  const dealKey = (o: Opportunity, at: number) =>
    `opportunity_deadline:${o.id}:${new Date(at).toISOString()}`;
  const bandKey = (band: WaitingBand, offer: Offer) =>
    `${FEEDBACK_TYPE[band]}:${offer.id}:${offer.sentAt}`;

  /** Adds a notification unless this event already has one. */
  function enqueue(
    data: CrmData,
    n: Omit<
      NotificationDelivery,
      | 'id'
      | 'status'
      | 'attempts'
      | 'nextAttemptAt'
      | 'acceptedAt'
      | 'devicesAccepted'
      | 'lastError'
      | 'createdAt'
      | 'updatedAt'
    >,
    now: Date,
  ): boolean {
    const exists = data.notificationDeliveries.some(
      (d) =>
        d.organizationId === n.organizationId &&
        d.recipientUserId === n.recipientUserId &&
        d.idempotencyKey === n.idempotencyKey,
    );
    if (exists) return false;
    const stamp = now.toISOString();
    data.notificationDeliveries.push({
      ...n,
      id: newId(),
      title: clip(n.title, 120),
      body: clip(n.body, 300),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      acceptedAt: null,
      devicesAccepted: 0,
      lastError: null,
      createdAt: stamp,
      updatedAt: stamp,
    });
    return true;
  }

  function view(data: CrmData, ctx: CrmContext) {
    const settings = settingsOf(data, ctx.organizationId, ctx.user.id);
    return {
      preferences: Object.fromEntries(
        NOTIFICATION_TYPES.map((type) => [type, isOn(data, ctx.organizationId, ctx.user.id, type)]),
      ) as Record<NotificationType, boolean>,
      deadlineTime: settings?.deadlineTime ?? null,
    };
  }

  /** Is the event still worth sending (preference still on, record still open, same deadline)? */
  function stillDue(data: CrmData, d: NotificationDelivery, at: number): boolean {
    if (!isOn(data, d.organizationId, d.recipientUserId, d.type)) return false;
    const org: Org = d;
    const settings = settingsOf(data, d.organizationId, d.recipientUserId);
    switch (d.type) {
      case 'task_deadline': {
        const task = findInOrg(data.tasks, org, d.sourceId);
        const due = task && task.status === 'open' ? taskDeadline(settings, task) : null;
        return due !== null && taskKey(task!, due) === d.idempotencyKey;
      }
      case 'opportunity_deadline': {
        const o = findInOrg(data.opportunities, org, d.sourceId);
        const due = o && o.status === 'active' ? opportunityDeadline(settings, o) : null;
        return due !== null && dealKey(o!, due) === d.idempotencyKey;
      }
      case 'feedback_low':
      case 'feedback_medium':
      case 'feedback_high': {
        const offer = findInOrg(data.offers, org, d.sourceId);
        if (!offer) return false;
        const deal = findInOrg(data.opportunities, org, offer.opportunityId);
        return offerStanding(offer, deal, at) === 'waiting';
      }
      default:
        return Boolean(findInOrg(data.offers, org, d.sourceId));
    }
  }

  const byId = (id: string) => repo.data().notificationDeliveries.find((d) => d.id === id);

  return {
    /** Whether this installation delivers at all (the in-browser demo does not). */
    delivery,

    /** GET /api/notifications/preferences: the seven switches and the deadline time. */
    preferences(ctx: CrmContext) {
      return view(repo.data(), ctx);
    },

    /**
     * PATCH /api/notifications/preferences: `{ preferences?: { [type]: boolean },
     * deadlineTime?: "HH:MM" | null }`. Upserts the signed-in member's own rows
     * only; switching a type on stamps enabledAt (the server's clock).
     */
    update(ctx: CrmContext, input: Body) {
      const errors: Record<string, string> = {};
      const changes = input.preferences ?? {};
      if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) {
        errors.preferences = 'Neispravne postavke obavijesti.';
      } else {
        for (const [type, value] of Object.entries(changes)) {
          if (!(NOTIFICATION_TYPES as readonly string[]).includes(type)) {
            errors.preferences = 'Nepoznata vrsta obavijesti.';
          } else if (typeof value !== 'boolean') {
            errors[type] = 'Odaberite uključeno ili isključeno.';
          }
        }
      }
      const hasTime = Object.hasOwn(input, 'deadlineTime');
      const time = input.deadlineTime === '' ? null : input.deadlineTime;
      if (hasTime && time !== null && (typeof time !== 'string' || !TIME.test(time))) {
        errors.deadlineTime = 'Unesite vrijeme u obliku HH:MM.';
      }
      if (Object.keys(errors).length) throw new CrmValidationError(errors);

      const data = repo.data();
      const stamp = ctx.now.toISOString();
      for (const [type, enabled] of Object.entries(changes) as [NotificationType, boolean][]) {
        const existing = preferenceOf(data, ctx.organizationId, ctx.user.id, type);
        if (existing) {
          if (existing.enabled !== enabled) {
            existing.enabled = enabled;
            if (enabled) existing.enabledAt = stamp;
            existing.updatedAt = stamp;
          }
        } else {
          data.notificationPreferences.push({
            id: newId(),
            organizationId: ctx.organizationId,
            userId: ctx.user.id,
            type,
            enabled,
            enabledAt: enabled ? stamp : null,
            createdAt: stamp,
            updatedAt: stamp,
          });
        }
      }
      // The timezone the scheduler counts this member's dates and bands in.
      let settings = settingsOf(data, ctx.organizationId, ctx.user.id);
      if (!settings) {
        settings = {
          id: newId(),
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          deadlineTime: null,
          timeZone: ctx.timeZone,
          createdAt: stamp,
          updatedAt: stamp,
        };
        data.notificationSettings.push(settings);
      }
      settings.timeZone = ctx.timeZone;
      if (hasTime) settings.deadlineTime = time as string | null;
      settings.updatedAt = stamp;
      repo.commit();
      return view(data, ctx);
    },

    /** Reminders keep their own lifecycle; they are delivered only while "Podsjetnik" is on. */
    remindersOn(organizationId: string, userId: string): boolean {
      return isOn(repo.data(), organizationId, userId, 'reminder_due');
    },

    // ---- events ------------------------------------------------------------

    /**
     * A qualifying view of a shared offer was recorded (inside follow-up's
     * write): not a preview, not automated, a valid link. One notification per
     * view, at most one per offer and recipient every VIEW_COOLDOWN_MS. The
     * engagement counters are kept regardless.
     */
    offerViewed(data: CrmData, offer: Offer, event: OfferEvent, now: Date) {
      if (!delivery) return;
      const recipient = offerRecipient(data, offer);
      if (!recipient) return;
      const at = now.getTime();
      if (!wants(data, offer.organizationId, recipient, 'offer_viewed', at)) return;
      const recent = data.notificationDeliveries.some(
        (d) =>
          d.organizationId === offer.organizationId &&
          d.recipientUserId === recipient &&
          d.type === 'offer_viewed' &&
          d.sourceId === offer.id &&
          at - Date.parse(d.occurredAt) < VIEW_COOLDOWN_MS,
      );
      if (recent) return;
      enqueue(
        data,
        {
          organizationId: offer.organizationId,
          recipientUserId: recipient,
          type: 'offer_viewed',
          sourceId: offer.id,
          idempotencyKey: `offer_viewed:${event.id}`,
          occurredAt: event.occurredAt,
          title: 'RENVARA — Ponuda pregledana',
          // A link does not identify who opened it: "a view was recorded", never "X viewed".
          body: `Zabilježen je novi pregled ponude za ${offerParty(data, offer)}: ${offer.title}`,
          url: `/follow-up/${encodeURIComponent(offer.id)}`,
        },
        now,
      );
    },

    /**
     * Deadlines and Feedback Overview bands that became due since the last run
     * (the scheduler calls this every run). Returns how many were added.
     */
    collectDue(now: Date): number {
      if (!delivery) return 0;
      const data = repo.data();
      const at = now.getTime();
      const fresh = (when: number) => when <= at && at - when <= STALE_MS;
      let added = 0;

      for (const task of data.tasks) {
        if (task.status !== 'open') continue;
        const recipient = task.assignedUserId ?? task.createdBy;
        if (!recipient || !isOn(data, task.organizationId, recipient, 'task_deadline')) continue;
        const due = taskDeadline(settingsOf(data, task.organizationId, recipient), task);
        if (due === null || !fresh(due)) continue;
        if (!wants(data, task.organizationId, recipient, 'task_deadline', due)) continue;
        const reached = due <= at - 60_000;
        if (
          enqueue(
            data,
            {
              organizationId: task.organizationId,
              recipientUserId: recipient,
              type: 'task_deadline',
              sourceId: task.id,
              idempotencyKey: taskKey(task, due),
              occurredAt: new Date(due).toISOString(),
              title: 'RENVARA — Rok zadatka',
              body: reached
                ? `Istekao je rok za zadatak: ${task.title}`
                : `Vrijeme je za izvršenje zadatka: ${task.title}`,
              url: `/tasks/${encodeURIComponent(task.id)}`,
            },
            now,
          )
        )
          added += 1;
      }

      for (const o of data.opportunities) {
        if (o.status !== 'active' || !o.ownerId) continue;
        if (!isOn(data, o.organizationId, o.ownerId, 'opportunity_deadline')) continue;
        const due = opportunityDeadline(settingsOf(data, o.organizationId, o.ownerId), o);
        if (due === null || !fresh(due)) continue;
        if (!wants(data, o.organizationId, o.ownerId, 'opportunity_deadline', due)) continue;
        if (
          enqueue(
            data,
            {
              organizationId: o.organizationId,
              recipientUserId: o.ownerId,
              type: 'opportunity_deadline',
              sourceId: o.id,
              idempotencyKey: dealKey(o, due),
              occurredAt: new Date(due).toISOString(),
              title: 'RENVARA — Rok prilike',
              body: `Dosegnut je rok za priliku: ${o.title} (očekivani datum zatvaranja)`,
              url: dealUrl(o),
            },
            now,
          )
        )
          added += 1;
      }

      for (const offer of data.offers) {
        if (!offer.sentAt) continue;
        const recipient = offerRecipient(data, offer);
        if (!recipient) continue;
        const settings = settingsOf(data, offer.organizationId, recipient);
        if (!settings) continue; // never saved a preference: everything is off
        const deal = findInOrg(data.opportunities, offer, offer.opportunityId);
        if (offerStanding(offer, deal, at) !== 'waiting') continue;
        const sent = new Date(offer.sentAt);
        const band = waitingBand(offerWaitingDays(sent, now, settings.timeZone));
        // Only the band the offer is in now: one that was skipped stays skipped.
        const entry = bandEntryAt(sent, band, settings.timeZone).getTime();
        const type = FEEDBACK_TYPE[band];
        if (!fresh(entry) || !wants(data, offer.organizationId, recipient, type, entry)) continue;
        const days = BAND_START_DAY[band];
        const party = offerParty(data, offer);
        const body =
          band === 'yellow'
            ? `Ponuda za ${party} čeka odgovor ${days} ${dayWord(days)}.`
            : band === 'red'
              ? `${party} čeka odgovor na ponudu već ${days} dana.`
              : `Ponuda za ${party} čeka odgovor ${days} dana. Potreban follow-up.`;
        if (
          enqueue(
            data,
            {
              organizationId: offer.organizationId,
              recipientUserId: recipient,
              type,
              sourceId: offer.id,
              idempotencyKey: bandKey(band, offer),
              occurredAt: new Date(entry).toISOString(),
              title: FEEDBACK_TITLE[band],
              body,
              url: `/follow-up/${encodeURIComponent(offer.id)}`,
            },
            now,
          )
        )
          added += 1;
      }
      if (added) repo.commit();
      return added;
    },

    // ---- delivery (the server scheduler; across organizations, no user context)

    /**
     * Claims the pending notifications (pending → processing). One whose
     * preference was switched off, or whose record closed or moved in the
     * meantime, is cancelled instead of sent.
     */
    claimDue(now: Date, limit = 50): NotificationDelivery[] {
      const data = repo.data();
      const at = now.getTime();
      const stamp = now.toISOString();
      const claimed: NotificationDelivery[] = [];
      let changed = false;
      for (const d of data.notificationDeliveries) {
        if (claimed.length >= limit) break;
        if (d.status !== 'pending' || (d.nextAttemptAt && Date.parse(d.nextAttemptAt) > at))
          continue;
        changed = true;
        if (!stillDue(data, d, at)) {
          Object.assign(d, { status: 'cancelled', lastError: 'no_longer_due', updatedAt: stamp });
          continue;
        }
        Object.assign(d, { status: 'processing', updatedAt: stamp });
        claimed.push({ ...d });
      }
      if (changed) repo.commit();
      return claimed;
    },

    /** After an interrupted run: claims older than STALE_PROCESSING_MS are sent again. */
    releaseStale(now: Date): number {
      const stale = repo
        .data()
        .notificationDeliveries.filter(
          (d) =>
            d.status === 'processing' &&
            now.getTime() - Date.parse(d.updatedAt) > STALE_PROCESSING_MS,
        );
      for (const d of stale) Object.assign(d, { status: 'pending', updatedAt: now.toISOString() });
      if (stale.length) repo.commit();
      return stale.length;
    },

    /** The push service accepted it for `devices` devices (not a device receipt). */
    markSent(id: string, now: Date, devices: number) {
      const d = byId(id);
      if (!d || d.status !== 'processing') return;
      const stamp = now.toISOString();
      Object.assign(d, {
        status: 'sent',
        acceptedAt: stamp,
        devicesAccepted: devices,
        attempts: d.attempts + 1,
        lastError: null,
        updatedAt: stamp,
      });
      repo.commit();
    },

    /** A failed attempt: retried later while attempts remain and the cause is transient. */
    markFailed(id: string, now: Date, error: string, retryable: boolean) {
      const d = byId(id);
      if (!d || d.status !== 'processing') return;
      const attempts = d.attempts + 1;
      const again = retryable && attempts < MAX_ATTEMPTS;
      Object.assign(d, {
        status: again ? 'pending' : 'failed',
        attempts,
        nextAttemptAt: again
          ? new Date(now.getTime() + (RETRY_AFTER_MS[attempts - 1] ?? 300_000)).toISOString()
          : null,
        lastError: error.slice(0, 500),
        updatedAt: now.toISOString(),
      });
      repo.commit();
    },

    payload(d: NotificationDelivery): NotificationPayload {
      // One tag per record: a newer notification of the same record replaces the older one.
      return { title: d.title, body: d.body, url: d.url, tag: `${d.type}-${d.sourceId}` };
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
