// /calendar · Sales Kalendar: a week of scheduled tasks (?week=YYYY-MM-DD, the Monday).
// It is a view over tasks with a calendar slot; completed ones stay visible as history.
import { api, onDataChanged } from '../core/api.js';
import { labelOf, TASK_TYPES } from '../core/constants.js';
import {
  addDaysKey,
  dayKey,
  formatAgendaDay,
  formatSlot,
  parseDayKey,
  todayKey,
} from '../core/format.js';
import { taskTypeIcon } from '../features/tasks/task-row.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { withParams } from '../ui/navigation.js';
import { renderShell } from '../ui/shell.js';
import { consumeFlash } from '../ui/toast.js';

renderShell('calendar');
const root = document.getElementById('app');

const weekFmt = new Intl.DateTimeFormat('hr-HR', { day: 'numeric', month: 'long' });

function mondayOf(key) {
  const date = parseDayKey(key);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return dayKey(date);
}

function currentWeek() {
  const param = new URLSearchParams(window.location.search).get('week');
  return mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(param ?? '') ? param : todayKey());
}

function entry(task, returnTo) {
  const done = task.status === 'completed';
  return h(
    'li',
    {},
    h(
      'a',
      {
        class: `rv-agenda__row${done ? ' is-done' : ''}`,
        href: withParams(`/tasks/${encodeURIComponent(task.id)}`, { returnTo }),
      },
      h('time', { class: 'rv-agenda__time' }, formatSlot(task)),
      done
        ? h('span', { class: 'rv-agenda__check', 'aria-label': 'Dovršeno' }, icon('check'))
        : h('span', {
            class: `rv-agenda__dot${task.priority === 'high' ? ' rv-agenda__dot--red' : task.companyId ? '' : ' rv-agenda__dot--demo'}`,
          }),
      h(
        'span',
        { class: 'rv-agenda__text' },
        h('strong', {}, task.title),
        h(
          'span',
          {},
          [
            labelOf(TASK_TYPES, task.type),
            task.customerName,
            task.contactName,
            done ? 'Dovršeno' : null,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
      icon(taskTypeIcon(task.type), 'rv-icon rv-agenda__type'),
      icon('chevron-right', 'rv-icon rv-list__chevron'),
    ),
  );
}

async function load() {
  const monday = currentWeek();
  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(i, parseDayKey(monday)));
  const from = parseDayKey(monday);
  const to = parseDayKey(addDaysKey(7, from));
  const tasks = await api.calendar(from, to);
  const returnTo = `/calendar?week=${monday}`;
  const today = todayKey();
  const sunday = parseDayKey(days[6]);
  const weekUrl = (key) => `/calendar?week=${key}`;

  root.replaceChildren(
    h(
      'div',
      { class: 'rv-page-head' },
      h(
        'div',
        {},
        h('h1', { class: 'rv-page-title' }, 'Sales Kalendar'),
        h(
          'p',
          { class: 'rv-muted' },
          `${weekFmt.format(from)} – ${weekFmt.format(sunday)} ${sunday.getFullYear()}.`,
        ),
      ),
      h(
        'a',
        {
          class: 'rv-btn rv-btn--primary',
          href: withParams('/tasks/new', {
            calendar: '1',
            date: days.includes(today) ? today : monday,
            returnTo,
          }),
        },
        icon('plus'),
        'Novi zadatak',
      ),
    ),
    h(
      'nav',
      { class: 'rv-week-nav', 'aria-label': 'Tjedan' },
      h(
        'a',
        {
          class: 'rv-btn rv-btn--secondary rv-btn--sm',
          href: weekUrl(addDaysKey(-7, from)),
          'aria-label': 'Prethodni tjedan',
        },
        icon('chevron-left'),
      ),
      h(
        'a',
        {
          class: 'rv-btn rv-btn--secondary rv-btn--sm',
          href: weekUrl(mondayOf(today)),
          'aria-current': days.includes(today) ? 'true' : null,
        },
        'Ovaj tjedan',
      ),
      h(
        'a',
        {
          class: 'rv-btn rv-btn--secondary rv-btn--sm',
          href: weekUrl(addDaysKey(7, from)),
          'aria-label': 'Sljedeći tjedan',
        },
        icon('chevron-right'),
      ),
    ),
    ...days.map((day) => {
      const items = tasks.filter(
        (t) => (t.allDay ? t.scheduledDate : dayKey(new Date(t.scheduledStartAt))) === day,
      );
      return h(
        'section',
        {
          class: `rv-card rv-agenda${day === today ? ' is-today' : ''}`,
          'aria-label': formatAgendaDay(day),
        },
        h('h2', { class: 'rv-agenda__day' }, formatAgendaDay(day)),
        items.length
          ? h(
              'ul',
              { class: 'rv-agenda__list', role: 'list' },
              items.map((t) => entry(t, returnTo)),
            )
          : h('p', { class: 'rv-muted rv-agenda__empty' }, 'Nema zakazanih zadataka.'),
      );
    }),
  );
}

onDataChanged(load);
await load();
consumeFlash();
