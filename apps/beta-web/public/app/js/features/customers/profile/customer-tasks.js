// Zadaci: the customer's open and completed tasks, completed in place.
import { taskRow } from '../../tasks/task-row.js';
import { h } from '../../../ui/dom.js';
import { emptyState, profileSection } from './section.js';

export function customerTasks(profile, actions) {
  const open = profile.tasks.filter((t) => t.status === 'open');
  const done = profile.tasks.filter((t) => t.status === 'completed');
  const row = (task) =>
    taskRow(task, {
      onToggle: actions.toggleTask,
      returnTo: actions.returnTo,
      withCustomer: false,
    });

  return profileSection({
    id: 'zadaci',
    title: 'Zadaci',
    iconName: 'check-square',
    count: open.length,
    action: { label: 'Novi zadatak', onClick: actions.task },
    children: profile.tasks.length
      ? [
          h('h3', { class: 'rv-subtitle' }, `Otvoreni (${open.length})`),
          open.length
            ? h('ul', { class: 'rv-tasks', role: 'list' }, open.map(row))
            : h('p', { class: 'rv-muted' }, 'Nema otvorenih zadataka.'),
          done.length
            ? [
                h('h3', { class: 'rv-subtitle' }, `Dovršeni (${done.length})`),
                h('ul', { class: 'rv-tasks', role: 'list' }, done.map(row)),
              ]
            : null,
        ]
      : emptyState('Nema zadataka.', { label: 'Novi zadatak', onClick: actions.task }),
  });
}
