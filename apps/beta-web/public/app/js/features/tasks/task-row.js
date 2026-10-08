// One task in a list (Tasks screen, customer profile): completion checkbox,
// title, when/what/who line, status badge, chevron to the task detail.
import { labelOf, TASK_TYPES } from '../../core/constants.js';
import { formatDue, formatSchedule } from '../../core/format.js';
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';

export function taskStatusBadge(task) {
  if (task.status === 'completed')
    return h(
      'span',
      { class: 'rv-badge rv-badge--green' },
      icon('check', 'rv-icon rv-icon--xs'),
      'Dovršeno',
    );
  if (task.status === 'cancelled')
    return h('span', { class: 'rv-badge rv-badge--neutral' }, 'Otkazano');
  if (task.overdue) return h('span', { class: 'rv-badge rv-badge--red' }, 'Kasni');
  if (task.priority === 'high') return h('span', { class: 'rv-badge rv-badge--red' }, 'Visoko');
  return null;
}

export const taskTypeIcon = (type) =>
  TASK_TYPES.find((t) => t.value === type)?.icon ?? 'check-square';

/** "Sastanak · Danas, 09:00–10:00 · Adria Tech d.o.o." */
export function taskMeta(task, { withCustomer = true } = {}) {
  return [
    labelOf(TASK_TYPES, task.type),
    formatSchedule(task) || formatDue(task),
    withCustomer ? (task.customerName ?? (task.leadName ? `Lead: ${task.leadName}` : null)) : null,
    task.contactName,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * @param {object} task  TaskView from the API
 * @param {{ onToggle: (task) => Promise<void>, returnTo?: string, withCustomer?: boolean }} options
 */
export function taskRow(task, { onToggle, returnTo, withCustomer = true }) {
  const done = task.status === 'completed';
  const check = h(
    'button',
    {
      type: 'button',
      class: 'rv-task__check',
      'aria-pressed': String(done),
      'aria-label': `${done ? 'Vrati u otvoreno' : 'Označi kao dovršeno'}: ${task.title}`,
      disabled: task.status === 'cancelled',
    },
    icon('check'),
  );
  check.addEventListener('click', async () => {
    check.disabled = true;
    try {
      await onToggle(task);
    } finally {
      check.disabled = false;
    }
  });
  const href = `/tasks/${encodeURIComponent(task.id)}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
  return h(
    'li',
    { class: `rv-task${done ? ' is-done' : ''}`, dataset: { taskId: task.id } },
    check,
    h(
      'a',
      { class: 'rv-task__link', href },
      h(
        'span',
        { class: 'rv-task__text' },
        h('span', { class: 'rv-task__title' }, task.title),
        h('span', { class: 'rv-task__meta' }, taskMeta(task, { withCustomer })),
      ),
      taskStatusBadge(task),
      icon('chevron-right', 'rv-icon rv-list__chevron'),
    ),
  );
}
