// CalendarService: the Sales Calendar is a read view over tasks that have a
// scheduledStartAt. Completed tasks stay in it (history); cancelled ones do not.
import { isCalendarDate } from '../../public/app/js/core/validation.js';
import { CrmValidationError } from './errors.ts';
import type { CrmRepository } from './repository.ts';
import { inOrg } from './scope.ts';
import { effectiveTime, type TaskService, type TaskView } from './task-service.ts';
import { dayRange } from './time.ts';
import type { CrmContext } from './types.ts';

/** Longest range one request may ask for: a quarter view and more, but bounded. */
export const MAX_RANGE_DAYS = 400;

export function createCalendarService(repo: CrmRepository, tasks: TaskService) {
  return {
    /**
     * Tasks whose calendar slot overlaps [start, end). Explicit UTC instants, so
     * "today", a week, a quarter or a past range are all the same query.
     */
    getCalendarTasks(ctx: CrmContext, start: Date, end: Date): TaskView[] {
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        throw new CrmValidationError({ range: 'Neispravan raspon datuma.' });
      }
      if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86_400_000) {
        throw new CrmValidationError({ range: `Najviše ${MAX_RANGE_DAYS} dana odjednom.` });
      }
      const from = start.getTime();
      const to = end.getTime();
      return inOrg(repo.data().tasks, ctx)
        .filter((t) => {
          if (!t.scheduledStartAt || t.status === 'cancelled') return false;
          const s = Date.parse(t.scheduledStartAt);
          const e = t.scheduledEndAt ? Date.parse(t.scheduledEndAt) : s;
          return s < to && (e > from || s >= from);
        })
        .sort(
          (a, b) =>
            Number(b.allDay) - Number(a.allDay) ||
            (effectiveTime(a, ctx.timeZone) ?? 0) - (effectiveTime(b, ctx.timeZone) ?? 0) ||
            a.createdAt.localeCompare(b.createdAt),
        )
        .map((t) => tasks.view(ctx, t));
    },

    /** One calendar day in the organization's timezone ("YYYY-MM-DD"). */
    getDay(ctx: CrmContext, date: string): TaskView[] {
      if (!isCalendarDate(date)) throw new CrmValidationError({ range: 'Neispravan datum.' });
      const { start, end } = dayRange(date, ctx.timeZone);
      return this.getCalendarTasks(ctx, start, end);
    },
  };
}

export type CalendarService = ReturnType<typeof createCalendarService>;
