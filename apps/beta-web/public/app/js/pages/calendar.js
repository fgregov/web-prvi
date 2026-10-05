// /calendar · Sales kalendar (agenda): today's demo events + every scheduled meeting.
import { DEMO_TODAY_EVENTS, labelOf, MEETING_MODES } from '../core/constants.js';
import { crm } from '../core/crm.js';
import { dayKey, formatAgendaDay, formatDuration, formatTime, todayKey } from '../core/format.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';

renderShell('calendar');
const root = document.getElementById('app');

function render() {
  const today = todayKey();
  const entries = [
    ...DEMO_TODAY_EVENTS.map((e) => ({
      day: today,
      time: e.time,
      title: e.title,
      subtitle: e.subtitle,
      demo: true,
    })),
    ...crm.listMeetings().map((m) => ({
      day: dayKey(new Date(m.startsAt)),
      time: formatTime(m.startsAt),
      title: m.title,
      subtitle: [
        m.customerName,
        formatDuration(m.durationMinutes),
        labelOf(MEETING_MODES, m.mode),
        m.location,
      ]
        .filter(Boolean)
        .join(' · '),
      href: `/customers/${encodeURIComponent(m.customerId)}`,
    })),
  ]
    .filter((e) => e.day >= today)
    .sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));

  const days = [...new Set(entries.map((e) => e.day))];
  root.replaceChildren(
    h(
      'div',
      { class: 'rv-page-head' },
      h(
        'div',
        {},
        h('h1', { class: 'rv-page-title' }, 'Sales kalendar'),
        h('p', { class: 'rv-muted' }, 'Danas i nadolazeći sastanci'),
      ),
    ),
    ...days.map((day) =>
      h(
        'section',
        { class: 'rv-card rv-agenda' },
        h('h2', { class: 'rv-agenda__day' }, formatAgendaDay(day)),
        h(
          'ul',
          { class: 'rv-agenda__list', role: 'list' },
          entries
            .filter((e) => e.day === day)
            .map((e) => {
              const content = [
                h('time', { class: 'rv-agenda__time' }, e.time),
                h('span', { class: `rv-agenda__dot${e.demo ? ' rv-agenda__dot--demo' : ''}` }),
                h(
                  'span',
                  { class: 'rv-agenda__text' },
                  h('strong', {}, e.title),
                  h('span', {}, e.subtitle),
                ),
                e.href ? icon('chevron-right', 'rv-icon rv-list__chevron') : null,
              ];
              return h(
                'li',
                {},
                e.href
                  ? h('a', { class: 'rv-agenda__row', href: e.href }, content)
                  : h('div', { class: 'rv-agenda__row' }, content),
              );
            }),
        ),
      ),
    ),
  );
}

crm.subscribe(render);
render();
