// /tasks · Zadaci: DANAS, NADOLAZEĆE, BEZ DATUMA, DOVRŠENO. Completed tasks stay as history.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { taskRow } from '../features/tasks/task-row.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';
import { consumeFlash, showToast } from '../ui/toast.js';

renderShell('tasks');
const root = document.getElementById('app');

const SECTIONS = [
  ['today', 'Danas', 'Nema zadataka za danas.'],
  ['upcoming', 'Nadolazeće', 'Nema nadolazećih zadataka.'],
  ['unscheduled', 'Bez datuma', 'Svi zadaci imaju datum.'],
  ['completed', 'Dovršeno', 'Još nema dovršenih zadataka.'],
];

async function toggle(task) {
  try {
    if (task.status === 'completed') {
      await api.reopenTask(task.id);
      showToast('Zadatak je ponovno otvoren.');
    } else {
      await api.completeTask(task.id);
      showToast('Zadatak je dovršen.');
    }
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : 'Pokušajte ponovno.');
  }
  await load();
}

function render(sections) {
  const open = sections.today.length + sections.upcoming.length + sections.unscheduled.length;
  root.replaceChildren(
    h(
      'div',
      { class: 'rv-page-head' },
      h(
        'div',
        {},
        h('h1', { class: 'rv-page-title' }, 'Zadaci'),
        h('p', { class: 'rv-muted' }, `${open} otvorenih`),
      ),
      h(
        'a',
        { class: 'rv-btn rv-btn--primary', href: '/tasks/new?returnTo=/tasks' },
        icon('plus'),
        'Novi zadatak',
      ),
    ),
    ...SECTIONS.map(([key, title, empty]) =>
      h(
        'section',
        { class: 'rv-card rv-task-group', 'aria-labelledby': `group-${key}`, id: `zadaci-${key}` },
        h(
          'h2',
          { class: 'rv-task-group__title', id: `group-${key}` },
          title,
          h('span', { class: 'rv-section__count' }, String(sections[key].length)),
        ),
        sections[key].length
          ? h(
              'ul',
              { class: 'rv-tasks', role: 'list' },
              sections[key].map((task) => taskRow(task, { onToggle: toggle, returnTo: '/tasks' })),
            )
          : h('p', { class: 'rv-muted rv-task-group__empty' }, empty),
      ),
    ),
  );
}

async function load() {
  try {
    render(await api.taskSections());
  } catch (error) {
    root.replaceChildren(
      h('div', { class: 'rv-card rv-empty rv-empty--page' }, h('p', {}, error.message)),
    );
  }
}

onDataChanged(load);
await load();
consumeFlash();
