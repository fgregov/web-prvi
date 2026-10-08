// Dashboard integration (prototypes/home): bottom navigation, period selector,
// KPI cards of the selected period, and one of two views:
//   current quarter → the operational dashboard (Danas / Prioriteti / pipeline)
//   past or custom period → the historical dashboard (what happened then)
// Quick Add always creates current records, whatever period is on screen.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { labelOf, TASK_TYPES } from '../core/constants.js';
import {
  describePeriod,
  getDashboardPeriod,
  onDashboardPeriodChange,
  resetDashboardPeriod,
  setDashboardPeriod,
} from '../core/dashboard-period.js';
import { dayRange, formatSlot, todayKey } from '../core/format.js';
import { DEMO_CONTENT } from '../core/edition.js';
import { currentQuarterPeriod } from '../core/period.js';
import { renderHistory, renderHistorySkeleton } from '../features/dashboard/history-view.js';
import { renderKpiCards, renderKpiSkeleton } from '../features/dashboard/kpi-cards.js';
import { PeriodSelector } from '../features/dashboard/period-selector.js';
import { QuickAddSheet } from '../features/quick-add/quick-add-sheet.js';
import { renderTabbar } from '../ui/tabbar.js';
import { consumeFlash, showToast } from '../ui/toast.js';

const SVG = 'http://www.w3.org/2000/svg';
const HOME = '/dashboard';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const spriteIcon = (name, className = 'icon') => {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
};
const taskHref = (task) =>
  `/tasks/${encodeURIComponent(task.id)}?returnTo=${encodeURIComponent(HOME)}`;

QuickAddSheet({ trigger: document.querySelector('.fab'), returnTo: HOME });
renderTabbar(document.querySelector('.tabbar'), 'home');

// A new session starts at the current quarter.
document.querySelector('[data-logout]')?.addEventListener('click', resetDashboardPeriod, true);

// Header date: today, in Croatian.
const dateEl = document.querySelector('.brand__date');
if (dateEl) {
  const text = new Intl.DateTimeFormat('hr-HR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  dateEl.textContent = text.charAt(0).toUpperCase() + text.slice(1);
  dateEl.setAttribute('datetime', todayKey());
}

// Clean start: no example content. "Čekaš odgovor" and the notification dot are
// demo examples (no data behind them yet); the pipeline counts come from the API.
if (!DEMO_CONTENT) {
  document
    .querySelector('[aria-labelledby="odgovor-title"] .list')
    ?.replaceChildren(el('li', 'empty-row', 'Nema stavki koje čekaju odgovor.'));
  document.querySelector('.bell__dot')?.remove();
  document.querySelector('.bell')?.setAttribute('aria-label', 'Obavijesti');
  document.querySelectorAll('.pipeline .stage__count').forEach((count) => (count.textContent = ''));
}

// ------------------------------------------------------------- Danas ---
function eventRow(task) {
  const done = task.status === 'completed';
  const li = el('li');
  li.dataset.taskId = task.id;
  const link = el('a', `event${done ? ' event--done' : ''}`);
  link.href = taskHref(task);
  const time = el(
    'time',
    `event__time${task.allDay ? ' event__time--all-day' : ''}`,
    task.allDay ? 'Cijeli dan' : formatSlot({ ...task, scheduledEndAt: null }),
  );
  time.dateTime = task.scheduledStartAt;
  let status;
  if (done) {
    status = el('span', 'event__done');
    status.setAttribute('aria-label', 'Dovršeno');
    status.append(spriteIcon('check'));
  } else {
    const tone = task.priority === 'high' ? 'red' : task.companyId ? 'green' : 'gray';
    status = el('span', `dot dot--${tone}`);
    status.setAttribute('aria-label', task.priority === 'high' ? 'Visok prioritet' : 'Otvoreno');
  }
  const text = el('span', 'event__text');
  text.append(
    el('span', 'event__title', task.title),
    el(
      'span',
      'event__sub',
      [
        labelOf(TASK_TYPES, task.type),
        task.customerName ?? task.description,
        done ? 'Dovršeno' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  );
  link.append(time, status, text, spriteIcon('chevron-right', 'icon chevron'));
  li.append(link);
  return li;
}

async function updateToday() {
  const list = document.querySelector('[aria-labelledby="danas-title"] .list');
  if (!list) return;
  const { start, end } = dayRange(todayKey());
  const tasks = await api.calendar(start, end);
  list.replaceChildren(
    ...(tasks.length
      ? tasks.map(eventRow)
      : [el('li', 'empty-row', 'Danas nema ništa u Sales Kalendaru.')]),
  );
}

// -------------------------------------------------------- Prioriteti ---
const PILL = {
  done: ['Dovršeno', 'green'],
  overdue: ['Kasni', 'red'],
  today: ['Danas', 'red'],
};

function priorityRow(task) {
  const done = task.status === 'completed';
  const li = el('li', 'task');
  li.dataset.taskId = task.id;
  const check = el('button', 'task__check');
  check.type = 'button';
  check.setAttribute('aria-pressed', String(done));
  check.setAttribute(
    'aria-label',
    `${done ? 'Vrati u otvoreno' : 'Označi kao dovršeno'}: ${task.title}`,
  );
  check.append(spriteIcon('check'));
  check.addEventListener('click', async () => {
    check.disabled = true;
    try {
      if (done) await api.reopenTask(task.id);
      else await api.completeTask(task.id);
      showToast(done ? 'Zadatak je ponovno otvoren.' : 'Zadatak je dovršen.');
      await refresh();
    } catch (error) {
      check.disabled = false;
      showToast(error instanceof ApiError ? error.message : 'Pokušajte ponovno.');
    }
  });
  const title = el('a', 'task__title', task.title);
  title.href = taskHref(task);
  const [label, tone] =
    task.reason === 'done'
      ? PILL.done
      : task.overdue
        ? PILL.overdue
        : task.dueState === 'due_today'
          ? PILL.today
          : ['Visoko', 'red'];
  li.append(check, title, el('span', `pill pill--${tone}`, label));
  return li;
}

async function updatePriorities() {
  const list = document.querySelector('[aria-labelledby="prioriteti-title"] .list');
  if (!list) return;
  const tasks = await api.priorities();
  list.replaceChildren(
    ...(tasks.length
      ? tasks.map(priorityRow)
      : [el('li', 'empty-row', 'Nema prioritetnih zadataka.')]),
  );
}

// ---------------------------------------------------------- Pipeline ---
async function updatePipeline() {
  const totals = await api.pipeline();
  const max = Math.max(...totals.map((t) => t.total), 1);
  document.querySelectorAll('.pipeline .stage').forEach((row, index) => {
    const stage = totals[index];
    if (!stage) return;
    row.querySelector('.stage__count').textContent = String(stage.total);
    const fill = stage.total ? Math.max(Math.round((stage.total / max) * 100), 14) : 0;
    row.style.setProperty('--fill', `${fill}%`);
  });
}

document
  .querySelectorAll('.pipeline .stage')
  .forEach((row) => row.addEventListener('click', () => window.location.assign('/opportunities')));

// ------------------------------------------------------------ period ---
const metricsEl = document.querySelector('.metrics');
const currentView = document.getElementById('dashboard-current');
const historyView = document.getElementById('dashboard-history');
const selector = PeriodSelector({
  container: document.getElementById('period-bar'),
  getPeriod: getDashboardPeriod,
  onSelect: setDashboardPeriod,
});
const backToCurrent = () => setDashboardPeriod(currentQuarterPeriod(todayKey()));

let ticket = 0;
/**
 * Loads the selected period: skeleton first (no stale numbers from another
 * period), then a short fade-in. `quiet` refreshes the same period in place.
 */
async function showPeriod({ quiet = false } = {}) {
  const mine = ++ticket;
  const info = describePeriod(getDashboardPeriod());
  selector.render();
  metricsEl.setAttribute('aria-busy', 'true');
  if (!quiet) {
    renderKpiSkeleton(metricsEl);
    currentView.hidden = !info.isCurrent;
    historyView.hidden = info.isCurrent;
    if (!info.isCurrent) renderHistorySkeleton(historyView);
  }

  try {
    const [summary] = await Promise.all([
      api.dashboardSummary(info.period.startDate, info.period.endDate),
      info.isCurrent ? refreshOperational() : null,
    ]);
    if (mine !== ticket) return; // a newer selection is loading
    renderKpiCards(metricsEl, summary);
    if (!info.isCurrent)
      renderHistory(historyView, summary, info, { onBackToCurrent: backToCurrent });
    if (quiet) return;
    for (const el of [metricsEl, info.isCurrent ? currentView : historyView]) {
      el.classList.remove('is-entering');
      void el.offsetWidth; // restart the fade
      el.classList.add('is-entering');
    }
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) showToast(error.message);
  } finally {
    if (mine === ticket) metricsEl.removeAttribute('aria-busy');
  }
}

async function refreshOperational() {
  await Promise.all([updateToday(), updatePriorities(), updatePipeline()]);
}

/** After a change (completing a task, another tab): reload what is on screen. */
async function refresh() {
  await showPeriod({ quiet: true });
}

onDashboardPeriodChange(() => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showPeriod();
});
onDataChanged(refresh);
await showPeriod();
consumeFlash();
