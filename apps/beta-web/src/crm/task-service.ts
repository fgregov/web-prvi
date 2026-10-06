// TaskService: tasks are independent records. Customer, contact and opportunity
// are optional links, validated against the caller's organization and against
// each other. The Sales Calendar is a view over scheduled tasks
// (CalendarService), so there is no second calendar record to keep in sync.
import {
  dueState,
  effectiveDueFromColumns,
  selectNextAction,
  taskDueFromColumns,
  type DueState,
  type TaskPriority,
  type TaskType,
} from '@renvara/domain';
import { labelOf, TASK_TYPES } from '../../public/app/js/core/constants.js';
import { hasErrors, MESSAGES, validateTask } from '../../public/app/js/core/validation.js';
import { CrmValidationError, type FieldErrors } from './errors.ts';
import type { CrmRepository } from './repository.ts';
import {
  addActivity,
  contactName,
  findInOrg,
  inOrg,
  newId,
  opt,
  requireInOrg,
  str,
  type Body,
} from './scope.ts';
import { calendarDateInZone, dayRange, startOfDayInZone } from './time.ts';
import type { CrmContext, CrmData, RecordSource, Task } from './types.ts';

export interface TaskView extends Task {
  customerName: string | null;
  contactName: string | null;
  opportunityTitle: string | null;
  /** Calendar day of scheduledStartAt in the organization timezone. */
  scheduledDate: string | null;
  dueState: DueState;
  /** Open and past its deadline (due_at < now, or the due day has ended). */
  overdue: boolean;
}

export interface TaskFilter {
  status?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  type?: string | null;
  priority?: string | null;
}

export interface TaskSections {
  today: TaskView[];
  upcoming: TaskView[];
  unscheduled: TaskView[];
  completed: TaskView[];
}

export type PriorityReason = 'high' | 'overdue' | 'today' | 'done';

const COMPLETED_LIMIT = 100;
const PRIORITIES_LIMIT = 5;

const due = (task: Task) => taskDueFromColumns(task.dueDate, task.dueAt);

/** Earliest moment the task is about: its calendar slot or its deadline. Null when undated. */
export function effectiveTime(task: Task, timeZone: string): number | null {
  const candidates: number[] = [];
  if (task.scheduledStartAt) candidates.push(Date.parse(task.scheduledStartAt));
  if (task.dueAt) candidates.push(Date.parse(task.dueAt));
  if (task.dueDate) candidates.push(startOfDayInZone(task.dueDate, timeZone).getTime());
  return candidates.length ? Math.min(...candidates) : null;
}

const byTime = (timeZone: string) => (a: Task, b: Task) =>
  (effectiveTime(a, timeZone) ?? Infinity) - (effectiveTime(b, timeZone) ?? Infinity) ||
  a.createdAt.localeCompare(b.createdAt);

export function createTaskService(repo: CrmRepository) {
  function view(data: CrmData, ctx: CrmContext, task: Task): TaskView {
    const customer = findInOrg(data.customers, ctx, task.companyId);
    const contact = findInOrg(data.contacts, ctx, task.contactId);
    const opportunity = findInOrg(data.opportunities, ctx, task.opportunityId);
    const state = dueState(due(task), ctx.now, ctx.timeZone);
    return {
      ...task,
      customerName: customer?.companyName ?? null,
      contactName: contact ? contactName(contact) : null,
      opportunityTitle: opportunity?.title ?? null,
      scheduledDate: task.scheduledStartAt
        ? calendarDateInZone(new Date(task.scheduledStartAt), ctx.timeZone)
        : null,
      dueState: state,
      overdue: task.status === 'open' && state === 'overdue',
    };
  }

  /**
   * Checks every link against the organization and against each other:
   *   unknown id or another organization's id → "Odabrani podatak nije dostupan."
   *   contact / opportunity of a different customer → rejected
   * A missing customer is derived from the opportunity, then from the contact
   * (same rule as private.derive_subject_links in the database).
   */
  function resolveLinks(data: CrmData, ctx: CrmContext, input: Body) {
    const errors: FieldErrors = {};
    let companyId = opt(input.companyId);
    const contactId = opt(input.contactId);
    const opportunityId = opt(input.opportunityId);

    if (companyId && !findInOrg(data.customers, ctx, companyId)) {
      errors.companyId = MESSAGES.unavailable;
    }
    if (opportunityId) {
      const opportunity = findInOrg(data.opportunities, ctx, opportunityId);
      if (!opportunity) errors.opportunityId = MESSAGES.unavailable;
      else if (companyId && opportunity.companyId !== companyId)
        errors.opportunityId = MESSAGES.opportunityNotOfCustomer;
      else companyId = opportunity.companyId;
    }
    if (contactId) {
      const contact = findInOrg(data.contacts, ctx, contactId);
      if (!contact) errors.contactId = MESSAGES.unavailable;
      else if (companyId && contact.companyId !== companyId)
        errors.contactId = MESSAGES.contactNotOfCustomer;
      else companyId ??= contact.companyId;
    }
    if (hasErrors(errors)) {
      const unavailable = Object.values(errors).includes(MESSAGES.unavailable);
      throw new CrmValidationError(errors, unavailable ? MESSAGES.unavailable : undefined);
    }
    return { companyId, contactId, opportunityId };
  }

  /** Editable fields from a request body (wire format), validated and normalised to UTC. */
  function fields(data: CrmData, ctx: CrmContext, input: Body) {
    const errors = validateTask(input);
    if (hasErrors(errors)) {
      throw new CrmValidationError(
        errors,
        errors.title === MESSAGES.taskTitleRequired && Object.keys(errors).length === 1
          ? MESSAGES.taskTitleRequired
          : undefined,
      );
    }
    const links = resolveLinks(data, ctx, input);
    const allDay = input.allDay === true;
    const instant = (value: unknown) => (opt(value) ? new Date(str(value)).toISOString() : null);
    return {
      ...links,
      title: str(input.title),
      description: str(input.description),
      location: str(input.location),
      type: (opt(input.type) ?? 'general') as TaskType,
      priority: (opt(input.priority) ?? 'normal') as TaskPriority,
      allDay,
      scheduledStartAt: allDay
        ? startOfDayInZone(str(input.scheduledDate), ctx.timeZone).toISOString()
        : instant(input.scheduledStartAt),
      scheduledEndAt: allDay ? null : instant(input.scheduledEndAt),
      dueDate: opt(input.dueDate),
      dueAt: instant(input.dueAt),
    };
  }

  function describe(task: Task, ctx: CrmContext): string {
    const type = labelOf(TASK_TYPES, task.type);
    if (!task.scheduledStartAt) return `${task.title} · ${type}`;
    const when = new Intl.DateTimeFormat('hr-HR', {
      timeZone: ctx.timeZone,
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      ...(task.allDay ? {} : { hour: '2-digit', minute: '2-digit' }),
    }).format(new Date(task.scheduledStartAt));
    return `${task.title} · ${type} · ${when}`;
  }

  function createIn(data: CrmData, ctx: CrmContext, input: Body, source: RecordSource): Task {
    const now = ctx.now.toISOString();
    const task: Task = {
      id: newId(),
      organizationId: ctx.organizationId,
      ...fields(data, ctx, input),
      assignedUserId: ctx.user.id,
      createdBy: ctx.user.id,
      status: 'open',
      source,
      completedAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    data.tasks.push(task);
    if (task.companyId) {
      const type =
        task.type === 'meeting' && task.scheduledStartAt
          ? 'meeting_scheduled'
          : task.scheduledStartAt
            ? 'task_scheduled'
            : 'task_created';
      addActivity(data, ctx, task.companyId, type, describe(task, ctx), task.id);
    }
    return task;
  }

  function setStatus(ctx: CrmContext, id: string, next: 'open' | 'completed' | 'cancelled') {
    const data = repo.data();
    const task = requireInOrg(data.tasks, ctx, id);
    if (task.status === next) return view(data, ctx, task); // idempotent (double tap)
    if (next === 'completed' && task.status === 'cancelled') {
      throw new CrmValidationError({ status: 'Otkazani zadatak nije moguće dovršiti.' });
    }
    const now = ctx.now.toISOString();
    task.status = next;
    task.completedAt = next === 'completed' ? now : null;
    task.cancelledAt = next === 'cancelled' ? now : null;
    task.updatedAt = now;
    if (task.companyId) {
      const type = {
        open: 'task_reopened',
        completed: 'task_completed',
        cancelled: 'task_cancelled',
      }[next];
      addActivity(data, ctx, task.companyId, type, task.title, task.id);
    }
    repo.commit();
    return view(data, ctx, task);
  }

  return {
    view: (ctx: CrmContext, task: Task) => view(repo.data(), ctx, task),

    /** Used by OpportunityService to create the first next action in the same write. */
    createIn,

    createTask(ctx: CrmContext, input: Body, source: RecordSource = 'user'): TaskView {
      const data = repo.data();
      const task = createIn(data, ctx, input, source);
      repo.commit();
      return view(data, ctx, task);
    },

    /** Replaces the editable fields (title, type, links, schedule, deadline, priority, note). */
    updateTask(ctx: CrmContext, id: string, input: Body): TaskView {
      const data = repo.data();
      const task = requireInOrg(data.tasks, ctx, id);
      const next = fields(data, ctx, input);
      const wasScheduled = task.scheduledStartAt;
      Object.assign(task, next, { updatedAt: ctx.now.toISOString() });
      if (task.companyId && task.scheduledStartAt && task.scheduledStartAt !== wasScheduled) {
        addActivity(data, ctx, task.companyId, 'task_scheduled', describe(task, ctx), task.id);
      }
      repo.commit();
      return view(data, ctx, task);
    },

    completeTask: (ctx: CrmContext, id: string) => setStatus(ctx, id, 'completed'),
    reopenTask: (ctx: CrmContext, id: string) => setStatus(ctx, id, 'open'),
    cancelTask: (ctx: CrmContext, id: string) => setStatus(ctx, id, 'cancelled'),

    getTask(ctx: CrmContext, id: string): TaskView {
      const data = repo.data();
      return view(data, ctx, requireInOrg(data.tasks, ctx, id));
    },

    listTasks(ctx: CrmContext, filter: TaskFilter = {}): TaskView[] {
      const data = repo.data();
      return inOrg(data.tasks, ctx)
        .filter(
          (t) =>
            (!filter.status || t.status === filter.status) &&
            (!filter.companyId || t.companyId === filter.companyId) &&
            (!filter.contactId || t.contactId === filter.contactId) &&
            (!filter.opportunityId || t.opportunityId === filter.opportunityId) &&
            (!filter.type || t.type === filter.type) &&
            (!filter.priority || t.priority === filter.priority),
        )
        .sort(byTime(ctx.timeZone))
        .map((t) => view(data, ctx, t));
    },

    /**
     * The Tasks screen: DANAS (overdue, due or scheduled today or earlier),
     * NADOLAZEĆE (dated later), BEZ DATUMA, DOVRŠENO (newest first).
     */
    sections(ctx: CrmContext): TaskSections {
      const data = repo.data();
      const today = calendarDateInZone(ctx.now, ctx.timeZone);
      const tomorrowStart = dayRange(today, ctx.timeZone).end.getTime();
      const tasks = inOrg(data.tasks, ctx).sort(byTime(ctx.timeZone));
      const open = tasks.filter((t) => t.status === 'open');
      const result: TaskSections = { today: [], upcoming: [], unscheduled: [], completed: [] };
      for (const task of open) {
        const at = effectiveTime(task, ctx.timeZone);
        const bucket = at === null ? 'unscheduled' : at < tomorrowStart ? 'today' : 'upcoming';
        result[bucket].push(view(data, ctx, task));
      }
      result.completed = tasks
        .filter((t) => t.status === 'completed')
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
        .slice(0, COMPLETED_LIMIT)
        .map((t) => view(data, ctx, t));
      return result;
    },

    /**
     * Home "Prioriteti": open HIGH first, then overdue, then due today;
     * tasks completed today stay listed (ticked) so a completion can be undone.
     */
    priorities(ctx: CrmContext): Array<TaskView & { reason: PriorityReason }> {
      const data = repo.data();
      const today = calendarDateInZone(ctx.now, ctx.timeZone);
      // Deadlines only: today's calendar slots are already the Home "Danas" list.
      const isToday = (t: TaskView) => t.dueState === 'due_today';
      const rank = { high: 0, overdue: 1, today: 2, done: 3 } as const;
      const items: Array<TaskView & { reason: PriorityReason }> = [];
      for (const task of inOrg(data.tasks, ctx)) {
        const v = view(data, ctx, task);
        let reason: PriorityReason | null = null;
        if (task.status === 'open') {
          if (task.priority === 'high') reason = 'high';
          else if (v.overdue) reason = 'overdue';
          else if (isToday(v)) reason = 'today';
        } else if (
          task.status === 'completed' &&
          task.completedAt &&
          calendarDateInZone(new Date(task.completedAt), ctx.timeZone) === today &&
          (task.priority === 'high' || isToday(v) || v.dueState === 'overdue')
        ) {
          reason = 'done';
        }
        if (reason) items.push({ ...v, reason });
      }
      const time = byTime(ctx.timeZone);
      return items
        .sort((a, b) => rank[a.reason] - rank[b.reason] || time(a, b))
        .slice(0, PRIORITIES_LIMIT);
    },

    /** Next action of an opportunity: its earliest open task (ADR-0004). */
    nextActionFor(ctx: CrmContext, opportunityId: string): TaskView | null {
      const data = repo.data();
      const candidates = inOrg(data.tasks, ctx)
        .filter((t) => t.opportunityId === opportunityId)
        .map((t) => ({
          task: t,
          id: t.id,
          type: t.type,
          title: t.title,
          status: t.status,
          // Same ordering as public.opportunity_overview: the deadline, else the calendar slot.
          due: effectiveDueFromColumns(t.dueDate, t.dueAt, t.scheduledStartAt),
          createdAt: new Date(t.createdAt),
        }));
      const next = selectNextAction(candidates, ctx.timeZone);
      return next ? view(data, ctx, next.task) : null;
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
