// /sales/tasks · Zadaci: DANAS, NADOLAZEĆE, DOVRŠENO as accordions (the Customer
// Detail principle). Every task has a date; completed tasks stay as history.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { taskRow } from '../features/tasks/task-row.js';
import { accordionSection, openSectionsState } from '../ui/accordion.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { mountAppShell } from '../ui/app-shell.js';
import { consumeFlash, showToast } from '../ui/toast.js';

mountAppShell();
const root = document.getElementById('app');

const SECTIONS = [
  ['today', 'Danas', 'calendar', 'Nema zadataka za danas.'],
  ['upcoming', 'Nadolazeće', 'clock', 'Nema nadolazećih zadataka.'],
  ['completed', 'Dovršeno', 'check', 'Još nema dovršenih zadataka.'],
];
// Accordions: all closed on a new visit (except the one a link points at,
// #zadaci-today …); as they were when coming Back, e.g. from a task; kept while
// the page stays open, also when it refreshes after completing a task.
const openSections = openSectionsState(
  SECTIONS.map(([key]) => `zadaci-${key}`),
  window.location.hash.slice(1),
);

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
  const open = sections.today.length + sections.upcoming.length;
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
        { class: 'rv-btn rv-btn--primary', href: '/sales/tasks/new?returnTo=/sales/tasks' },
        icon('plus'),
        'Novi zadatak',
      ),
    ),
    h(
      'div',
      { class: 'rv-accordion-list' },
      SECTIONS.map(([key, title, iconName, empty]) =>
        accordionSection({
          id: `zadaci-${key}`,
          title,
          iconName,
          count: sections[key].length,
          open: openSections,
          children: sections[key].length
            ? h(
                'ul',
                { class: 'rv-tasks', role: 'list' },
                sections[key].map((task) =>
                  taskRow(task, { onToggle: toggle, returnTo: '/sales/tasks' }),
                ),
              )
            : h('p', { class: 'rv-muted rv-task-group__empty' }, empty),
        }),
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
if (window.location.hash && openSections.size) {
  document.getElementById(openSections.first())?.scrollIntoView();
}
consumeFlash();
