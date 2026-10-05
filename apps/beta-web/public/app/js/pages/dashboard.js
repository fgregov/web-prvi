// Dashboard integration: Quick Create actions, live pipeline totals and today's meetings in "Danas".
import { crm } from '../core/crm.js';
import { labelOf, MEETING_MODES } from '../core/constants.js';
import { dayKey, formatTime, todayKey } from '../core/format.js';
import { runQuickCreate } from '../features/quick-create/quick-create.js';
import { consumeFlash } from '../ui/toast.js';

const SVG = 'http://www.w3.org/2000/svg';

// app.js dispatches this when a Quick Create menu item with data-action is chosen.
document.addEventListener('renvara:quick-create', (event) => runQuickCreate(event.detail.action));

function updatePipeline() {
  const totals = crm.pipelineTotals();
  const max = Math.max(...totals.map((t) => t.total), 1);
  document.querySelectorAll('.pipeline .stage').forEach((row, index) => {
    const stage = totals[index];
    if (!stage) return;
    row.querySelector('.stage__count').textContent = String(stage.total);
    row.style.setProperty('--fill', `${Math.max(Math.round((stage.total / max) * 100), 14)}%`);
  });
}

function eventRow(meeting) {
  const li = document.createElement('li');
  li.dataset.meetingId = meeting.id;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'event';
  const time = document.createElement('time');
  time.className = 'event__time';
  time.textContent = formatTime(meeting.startsAt);
  const dot = document.createElement('span');
  dot.className = 'dot dot--green';
  dot.setAttribute('aria-label', 'Zakazano');
  const text = document.createElement('span');
  text.className = 'event__text';
  const title = document.createElement('span');
  title.className = 'event__title';
  title.textContent = meeting.title;
  const sub = document.createElement('span');
  sub.className = 'event__sub';
  sub.textContent = `${meeting.customerName} · ${labelOf(MEETING_MODES, meeting.mode)}`;
  text.append(title, sub);
  const chevron = document.createElementNS(SVG, 'svg');
  chevron.setAttribute('class', 'icon chevron');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', '#i-chevron-right');
  chevron.append(use);
  button.append(time, dot, text, chevron);
  button.addEventListener('click', () =>
    window.location.assign(`/customers/${encodeURIComponent(meeting.customerId)}`),
  );
  li.append(button);
  return li;
}

/** Inserts today's scheduled meetings into the "Danas" list in time order. */
function updateToday() {
  const list = document.querySelector('[aria-labelledby="danas-title"] .list');
  if (!list) return;
  list.querySelectorAll('li[data-meeting-id]').forEach((li) => li.remove());
  const today = todayKey();
  for (const meeting of crm.listMeetings().filter((m) => dayKey(new Date(m.startsAt)) === today)) {
    const row = eventRow(meeting);
    const time = formatTime(meeting.startsAt);
    const after = [...list.children].find(
      (li) => (li.querySelector('.event__time')?.textContent ?? '') > time,
    );
    list.insertBefore(row, after ?? null);
  }
}

document
  .querySelectorAll('.pipeline .stage')
  .forEach((row) => row.addEventListener('click', () => window.location.assign('/opportunities')));

function refresh() {
  updatePipeline();
  updateToday();
}

crm.subscribe(refresh);
refresh();
consumeFlash();
