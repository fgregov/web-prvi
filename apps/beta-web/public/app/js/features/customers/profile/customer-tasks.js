// Zadaci: the customer's open and completed tasks (the count is all of them),
// completed in place.
import { taskRow } from '../../tasks/task-row.js';
import { h } from '../../../ui/dom.js';
import { accordionSection, emptyState } from './section.js';

export function customerTasks(profile, actions, open) {
  const pending = profile.tasks.filter((t) => t.status === 'open');
  const done = profile.tasks.filter((t) => t.status === 'completed');
  const row = (task) =>
    taskRow(task, {
      onToggle: actions.toggleTask,
      returnTo: actions.returnTo,
      withCustomer: false,
    });

  return accordionSection({
    id: 'zadaci',
    title: 'Zadaci',
    iconName: 'check-square',
    count: profile.tasks.length,
    open,
    children: profile.tasks.length
      ? [
          h('h3', { class: 'rv-subtitle' }, `Otvoreni (${pending.length})`),
          pending.length
            ? h('ul', { class: 'rv-tasks', role: 'list' }, pending.map(row))
            : h('p', { class: 'rv-muted' }, 'Nema otvorenih zadataka.'),
          done.length
            ? [
                h('h3', { class: 'rv-subtitle' }, `Dovršeni (${done.length})`),
                h('ul', { class: 'rv-tasks', role: 'list' }, done.map(row)),
              ]
            : null,
        ]
      : emptyState('Nema evidentiranih zadataka.'),
  });
}
