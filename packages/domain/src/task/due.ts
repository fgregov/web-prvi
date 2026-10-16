import {
  calendarDateInZone,
  isCalendarDate,
  startOfDayInZone,
  type CalendarDate,
} from '../time/zoned.ts';

/**
 * When a task is due. Mirrors the two mutually exclusive DB columns:
 *   due_date (date)        → "by Friday": a calendar day in the assignee's zone
 *   due_at   (timestamptz) → "at 14:00": an exact instant
 */
export type TaskDue =
  | { readonly kind: 'none' }
  | { readonly kind: 'date'; readonly date: CalendarDate }
  | { readonly kind: 'instant'; readonly at: Date };

export function taskDueFromColumns(dueDate: string | null, dueAt: string | Date | null): TaskDue {
  if (dueDate !== null && dueAt !== null) {
    throw new RangeError('A task cannot have both due_date and due_at');
  }
  if (dueDate !== null) {
    if (!isCalendarDate(dueDate)) throw new RangeError(`Invalid due_date: ${dueDate}`);
    return { kind: 'date', date: dueDate };
  }
  if (dueAt !== null) return { kind: 'instant', at: new Date(dueAt) };
  return { kind: 'none' };
}

/**
 * The moment that orders a task as a next action: its deadline, else its
 * Sales Calendar slot (tasks.scheduled_start_at). Same rule as the ORDER BY
 * of public.opportunity_overview.
 */
export function effectiveDueFromColumns(
  dueDate: string | null,
  dueAt: string | Date | null,
  scheduledStartAt: string | Date | null,
): TaskDue {
  const due = taskDueFromColumns(dueDate, dueAt);
  if (due.kind !== 'none' || scheduledStartAt === null) return due;
  return { kind: 'instant', at: new Date(scheduledStartAt) };
}

export type DueState = 'no_due' | 'overdue' | 'due_today' | 'upcoming';

/**
 * Evaluates a due value for a specific viewer.
 * - date-only: overdue once that calendar day has ended in `timeZone`.
 * - instant:   overdue once the instant has passed; "today" is judged in `timeZone`.
 */
export function dueState(due: TaskDue, now: Date, timeZone: string): DueState {
  if (due.kind === 'none') return 'no_due';
  const today = calendarDateInZone(now, timeZone);
  if (due.kind === 'date') {
    if (due.date < today) return 'overdue';
    return due.date === today ? 'due_today' : 'upcoming';
  }
  if (due.at.getTime() < now.getTime()) return 'overdue';
  return calendarDateInZone(due.at, timeZone) === today ? 'due_today' : 'upcoming';
}

/**
 * Ordering key identical to public.opportunity_overview: date-only values count
 * from the start of that day in the organization's timezone; no due date sorts
 * last (null).
 */
export function dueSortKey(due: TaskDue, organizationTimeZone: string): number | null {
  switch (due.kind) {
    case 'none':
      return null;
    case 'instant':
      return due.at.getTime();
    case 'date':
      return startOfDayInZone(due.date, organizationTimeZone).getTime();
  }
}
