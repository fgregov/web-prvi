// ReminderService: optional push reminders for a task, lead or opportunity at
// a chosen date and time. A reminder belongs to one organization, one record
// and one recipient (the user who set it). The server's scheduler delivers it
// (src/notifications/reminder-scheduler.ts): pending → processing → sent, or
// failed after retries; moving it reschedules the same reminder, removing it
// cancels it. Saving a reminder never claims delivery: that needs a device
// subscribed to push notifications.
import { MESSAGES, reminderError } from '../../public/app/js/core/validation.js';
import { CrmValidationError } from './errors.ts';
import { pendingReminder, reminderView, type ReminderField } from './reminders.ts';
import type { CrmRepository } from './repository.ts';
import { findInOrg, newId } from './scope.ts';
import type { CrmContext, CrmData, Reminder, ReminderTarget } from './types.ts';

const FIELD: Record<ReminderTarget['kind'], ReminderField> = {
  task: 'taskId',
  lead: 'leadId',
  opportunity: 'opportunityId',
};
/** Delivery attempts before a reminder counts as failed. */
export const MAX_ATTEMPTS = 3;
/** Wait before the 2nd and 3rd attempt. */
export const RETRY_AFTER_MS = [60_000, 5 * 60_000] as const;
/** A claim this old was interrupted (a restart mid-delivery): it goes back to pending. */
export const STALE_PROCESSING_MS = 5 * 60_000;

/** What the device shows. Short, no notes or amounts on the lock screen. */
export interface ReminderPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === '';

export function createReminderService(repo: CrmRepository) {
  function requireTarget(data: CrmData, ctx: CrmContext, target: ReminderTarget) {
    const list =
      target.kind === 'task'
        ? data.tasks
        : target.kind === 'lead'
          ? data.leads
          : data.opportunities;
    const record = findInOrg<{ id: string; organizationId: string }>(list, ctx, target.id);
    if (!record) {
      throw new CrmValidationError({ reminderAt: MESSAGES.unavailable }, MESSAGES.unavailable);
    }
  }

  /** Validates `reminderAt` before anything is written, so a record and its reminder are saved together. */
  function check(ctx: CrmContext, value: unknown) {
    const error = reminderError(value, ctx.now);
    if (error) throw new CrmValidationError({ reminderAt: error }, error);
  }

  /**
   * Sets, moves or (empty value) removes the viewing user's reminder of a
   * record, inside the caller's write. Returns the reminder now in force.
   */
  function applyIn(
    data: CrmData,
    ctx: CrmContext,
    target: ReminderTarget,
    value: unknown,
  ): Reminder | null {
    requireTarget(data, ctx, target);
    check(ctx, value);
    const field = FIELD[target.kind];
    const existing = pendingReminder(data, ctx, field, target.id);
    const now = ctx.now.toISOString();
    if (isEmpty(value)) {
      if (existing?.status === 'pending') {
        Object.assign(existing, { status: 'cancelled', cancelledAt: now, updatedAt: now });
      }
      return null;
    }
    const remindAt = new Date(String(value)).toISOString();
    if (existing?.status === 'pending') {
      // Moving a reminder changes the same record: the old time can no longer fire.
      Object.assign(existing, {
        remindAt,
        timeZone: ctx.timeZone,
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        updatedAt: now,
      });
      return existing;
    }
    // None yet, or one is being delivered right now: the new time is a new reminder.
    const reminder: Reminder = {
      id: newId(),
      organizationId: ctx.organizationId,
      recipientUserId: ctx.user.id,
      createdBy: ctx.user.id,
      taskId: field === 'taskId' ? target.id : null,
      leadId: field === 'leadId' ? target.id : null,
      opportunityId: field === 'opportunityId' ? target.id : null,
      remindAt,
      timeZone: ctx.timeZone,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      deliveredAt: null,
      cancelledAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    data.reminders.push(reminder);
    return reminder;
  }

  const byId = (id: string) => repo.data().reminders.find((r) => r.id === id);

  return {
    check,
    applyIn,

    /** PUT /api/{tasks|leads|opportunities}/{id}/reminder: set, move or (null) remove. */
    setReminder(ctx: CrmContext, target: ReminderTarget, value: unknown) {
      const data = repo.data();
      const reminder = applyIn(data, ctx, target, value);
      repo.commit();
      return reminder ? reminderView(reminder) : null;
    },

    // ---- delivery (the server scheduler; acts across organizations, no user context)

    /** Claims due reminders for delivery (pending → processing), so no other run sends them too. */
    claimDue(now: Date, limit = 50): Reminder[] {
      const data = repo.data();
      const at = now.getTime();
      const due = data.reminders
        .filter(
          (r) =>
            r.status === 'pending' &&
            Date.parse(r.remindAt) <= at &&
            (!r.nextAttemptAt || Date.parse(r.nextAttemptAt) <= at),
        )
        .sort((a, b) => a.remindAt.localeCompare(b.remindAt))
        .slice(0, limit);
      const stamp = now.toISOString();
      for (const r of due) Object.assign(r, { status: 'processing', updatedAt: stamp });
      if (due.length) repo.commit();
      return due.map((r) => ({ ...r }));
    },

    /** After an interrupted run: claims older than STALE_PROCESSING_MS are delivered again. */
    releaseStale(now: Date): number {
      const data = repo.data();
      const stale = data.reminders.filter(
        (r) =>
          r.status === 'processing' &&
          now.getTime() - Date.parse(r.updatedAt) > STALE_PROCESSING_MS,
      );
      for (const r of stale) Object.assign(r, { status: 'pending', updatedAt: now.toISOString() });
      if (stale.length) repo.commit();
      return stale.length;
    },

    markSent(id: string, now: Date) {
      const r = byId(id);
      if (!r || r.status !== 'processing') return;
      const stamp = now.toISOString();
      Object.assign(r, {
        status: 'sent',
        deliveredAt: stamp,
        attempts: r.attempts + 1,
        lastError: null,
        updatedAt: stamp,
      });
      repo.commit();
    },

    /** A failed attempt: retried later while attempts remain and the cause is transient. */
    markFailed(id: string, now: Date, error: string, retryable: boolean) {
      const r = byId(id);
      if (!r || r.status !== 'processing') return;
      const attempts = r.attempts + 1;
      const again = retryable && attempts < MAX_ATTEMPTS;
      const stamp = now.toISOString();
      Object.assign(r, {
        status: again ? 'pending' : 'failed',
        attempts,
        nextAttemptAt: again
          ? new Date(now.getTime() + (RETRY_AFTER_MS[attempts - 1] ?? 300_000)).toISOString()
          : null,
        lastError: error.slice(0, 500),
        updatedAt: stamp,
      });
      repo.commit();
    },

    /** The notification for a reminder, built from its record (null when the record is gone). */
    payload(r: Reminder): ReminderPayload | null {
      const data = repo.data();
      const ctx = { organizationId: r.organizationId };
      const tag = `reminder-${r.id}`;
      if (r.taskId) {
        const task = findInOrg(data.tasks, ctx, r.taskId);
        return task
          ? {
              title: 'RENVARA — Zadatak',
              body: task.title,
              url: `/tasks/${encodeURIComponent(task.id)}`,
              tag,
            }
          : null;
      }
      if (r.leadId) {
        const lead = findInOrg(data.leads, ctx, r.leadId);
        return lead
          ? {
              title: 'RENVARA — Lead',
              body: `Podsjetnik za lead: ${[lead.name, lead.companyName].filter(Boolean).join(' · ')}`,
              url: `/leads/${encodeURIComponent(lead.id)}`,
              tag,
            }
          : null;
      }
      const opportunity = r.opportunityId
        ? findInOrg(data.opportunities, ctx, r.opportunityId)
        : undefined;
      if (!opportunity) return null;
      const customer = findInOrg(data.customers, ctx, opportunity.companyId);
      return {
        title: 'RENVARA — Prilika',
        body: `Podsjetnik za priliku: ${[opportunity.title, customer?.companyName].filter(Boolean).join(' — ')}`,
        url: `/customers/${encodeURIComponent(opportunity.companyId)}#prilike`,
        tag,
      };
    },
  };
}

export type ReminderService = ReturnType<typeof createReminderService>;
