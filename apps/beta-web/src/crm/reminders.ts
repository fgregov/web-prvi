// Reminder records as seen from the records they belong to: the pending
// reminder of a task, lead or opportunity, and the cancellation rule when that
// record is closed. The scheduling and delivery side is reminder-service.ts.
import type { CrmContext, CrmData, Reminder } from './types.ts';

export type ReminderField = 'taskId' | 'leadId' | 'opportunityId';

/** What a record's view carries about its reminder (for the viewing user). */
export interface ReminderView {
  id: string;
  remindAt: string;
  timeZone: string;
  status: Reminder['status'];
  lastError: string | null;
}

export const reminderView = (r: Reminder): ReminderView => ({
  id: r.id,
  remindAt: r.remindAt,
  timeZone: r.timeZone,
  status: r.status,
  lastError: r.lastError,
});

const isOpen = (r: Reminder) => r.status === 'pending' || r.status === 'processing';

/** The viewing user's reminder of a record that has not fired yet, if any. */
export function pendingReminder(
  data: CrmData,
  ctx: CrmContext,
  field: ReminderField,
  id: string,
): Reminder | null {
  return (
    (data.reminders ?? []).find(
      (r) =>
        r.organizationId === ctx.organizationId &&
        r[field] === id &&
        r.recipientUserId === ctx.user.id &&
        isOpen(r),
    ) ?? null
  );
}

/**
 * The reminder a record shows its viewer: the one still to fire, or else the
 * latest one if it failed (so "not delivered" stays visible until a new
 * reminder is set). Delivered and cancelled reminders are not shown.
 */
export function shownReminder(
  data: CrmData,
  ctx: CrmContext,
  field: ReminderField,
  id: string,
): Reminder | null {
  const open = pendingReminder(data, ctx, field, id);
  if (open) return open;
  let latest: Reminder | null = null; // ties: the one stored last
  for (const r of data.reminders ?? []) {
    if (r.organizationId !== ctx.organizationId || r[field] !== id) continue;
    if (r.recipientUserId !== ctx.user.id) continue;
    if (!latest || r.createdAt >= latest.createdAt) latest = r;
  }
  return latest?.status === 'failed' ? latest : null;
}

/**
 * Cancellation rule: a reminder is about an open record, so completing or
 * cancelling a task, converting or losing a lead, and winning or losing an
 * opportunity cancels its reminders that have not been delivered. (Reopening
 * does not bring them back; set a new one.)
 */
export function cancelReminders(
  data: CrmData,
  ctx: CrmContext,
  field: ReminderField,
  id: string,
): number {
  const now = ctx.now.toISOString();
  let cancelled = 0;
  for (const r of data.reminders ?? []) {
    if (r.organizationId !== ctx.organizationId || r[field] !== id || r.status !== 'pending')
      continue;
    Object.assign(r, { status: 'cancelled', cancelledAt: now, updatedAt: now });
    cancelled += 1;
  }
  return cancelled;
}
