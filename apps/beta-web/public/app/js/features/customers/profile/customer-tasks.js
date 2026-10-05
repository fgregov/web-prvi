// Zadaci: open and completed tasks, toggled in place.
import { labelOf, TASK_PRIORITIES } from '../../../core/constants.js';
import { formatDay, todayKey } from '../../../core/format.js';
import { h } from '../../../ui/dom.js';
import { icon } from '../../../ui/icons.js';
import { emptyState, profileSection } from './section.js';

export function customerTasks(profile, { onCreate, onToggle }) {
  const open = profile.tasks.filter((t) => t.status === 'open');
  const done = profile.tasks.filter((t) => t.status === 'completed');

  const item = (task) => {
    const completed = task.status === 'completed';
    const overdue = !completed && task.dueDate && task.dueDate < todayKey();
    return h(
      'li',
      { class: `rv-task${completed ? ' is-done' : ''}` },
      h(
        'button',
        {
          type: 'button',
          class: 'rv-task__check',
          'aria-pressed': String(completed),
          'aria-label': `${completed ? 'Označi kao otvoreno' : 'Označi kao završeno'}: ${task.title}`,
          onClick: () => onToggle(task.id),
        },
        icon('check'),
      ),
      h(
        'div',
        { class: 'rv-task__text' },
        h('span', { class: 'rv-task__title' }, task.title),
        h(
          'span',
          { class: 'rv-task__meta' },
          [
            task.dueDate ? `Rok: ${formatDay(task.dueDate)}` : 'Bez roka',
            `Prioritet: ${labelOf(TASK_PRIORITIES, task.priority)}`,
          ].join(' · '),
        ),
      ),
      completed
        ? h('span', { class: 'rv-badge rv-badge--green' }, 'Završeno')
        : overdue
          ? h('span', { class: 'rv-badge rv-badge--red' }, 'Kasni')
          : null,
    );
  };

  return profileSection({
    id: 'zadaci',
    title: 'Zadaci',
    iconName: 'check-square',
    count: open.length,
    action: { label: 'Novi zadatak', onClick: onCreate },
    children: profile.tasks.length
      ? [
          h('h3', { class: 'rv-subtitle' }, `Otvoreni (${open.length})`),
          open.length
            ? h('ul', { class: 'rv-tasks', role: 'list' }, open.map(item))
            : h('p', { class: 'rv-muted' }, 'Nema otvorenih zadataka.'),
          done.length
            ? [
                h('h3', { class: 'rv-subtitle' }, `Završeni (${done.length})`),
                h('ul', { class: 'rv-tasks', role: 'list' }, done.map(item)),
              ]
            : null,
        ]
      : emptyState('Nema zadataka.', { label: 'Novi zadatak', onClick: onCreate }),
  });
}
