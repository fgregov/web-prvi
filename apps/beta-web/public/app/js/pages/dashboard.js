// Dashboard integration (prototypes/home): the app's navigation, period selector,
// KPI cards of the selected period, and one of two views:
//   current quarter → the operational dashboard (Danas / Prioriteti / pipeline)
//   past or custom period → the historical dashboard (what happened then)
// Quick Add always creates current records, whatever period is on screen.
// Each widget is shown only with its Dashboard right and the data right it
// needs (core/permissions.js); the server leaves the others' data out.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { labelOf, TASK_TYPES } from '../core/constants.js';
import {
  describePeriod,
  getDashboardPeriod,
  onDashboardPeriodChange,
  setDashboardPeriod,
} from '../core/dashboard-period.js';
import { dayRange, formatDateTime, formatSlot, todayKey } from '../core/format.js';
import { currentQuarterPeriod } from '../core/period.js';
import { canSeeWidget } from '../core/permissions.js';
import { getAccess } from '../core/session.js';
import { renderFeedbackOverview } from '../features/dashboard/feedback-overview.js';
import { renderHistory, renderHistorySkeleton } from '../features/dashboard/history-view.js';
import { renderKpiCards, renderKpiSkeleton } from '../features/dashboard/kpi-cards.js';
import { PeriodSelector } from '../features/dashboard/period-selector.js';
import { renderPipelineOverview } from '../features/dashboard/pipeline-overview.js';
import { mountAppShell } from '../ui/app-shell.js';
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
  `/sales/tasks/${encodeURIComponent(task.id)}?returnTo=${encodeURIComponent(HOME)}`;

// Sidebar with "+ Novo" (Quick Add); Odjava there starts the next session at the current quarter.
mountAppShell();
const { permissions } = await getAccess();
const sees = (widget) => canSeeWidget(permissions, `dashboard.${widget}`);
const canOpenTasks = permissions.has('tasks.view');
const canEditTasks = permissions.has('tasks.edit');

/** The current-quarter widgets this member may see; the rest leave the page. */
function applyWidgetRights() {
  const section = (id) => document.querySelector(`[aria-labelledby="${id}"]`);
  const toggle = (node, on) => {
    if (node) node.hidden = !on;
  };
  toggle(section('danas-title'), sees('calendar'));
  toggle(section('prioriteti-title'), sees('priority_tasks'));
  toggle(section('pipeline-title'), sees('pipeline'));
  toggle(section('odgovor-title'), sees('feedback'));
  toggle(document.getElementById('dashboard-notifications'), sees('notifications'));
  const split = document.querySelector('#dashboard-current > .split');
  if (split) {
    const shown = [sees('pipeline'), sees('feedback')].filter(Boolean).length;
    split.hidden = shown === 0;
    split.classList.toggle('split--single', shown === 1);
  }
}
applyWidgetRights();

// Header date: today, in Croatian.
const dateEl = document.getElementById('home-date');
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

// ------------------------------------------------------------- Danas ---
function eventRow(task) {
  const done = task.status === 'completed';
  const li = el('li');
  li.dataset.taskId = task.id;
  const link = el('a', `event${done ? ' event--done' : ''}`);
  if (canOpenTasks) link.href = taskHref(task);
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
    // High priority is black (priority colours: low yellow, medium red, high black).
    const tone = task.priority === 'high' ? 'priority-high' : task.companyId ? 'green' : 'gray';
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
  if (!list || !sees('calendar')) return;
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
  check.disabled = !canEditTasks;
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
  if (canOpenTasks) title.href = taskHref(task);
  const [label, tone] =
    task.reason === 'done'
      ? PILL.done
      : task.overdue
        ? PILL.overdue
        : task.dueState === 'due_today'
          ? PILL.today
          : ['Visoko', 'priority-high'];
  li.append(check, title, el('span', `pill pill--${tone}`, label));
  return li;
}

async function updatePriorities() {
  const list = document.querySelector('[aria-labelledby="prioriteti-title"] .list');
  if (!list || !sees('priority_tasks')) return;
  const tasks = await api.priorities();
  list.replaceChildren(
    ...(tasks.length
      ? tasks.map(priorityRow)
      : [el('li', 'empty-row', 'Nema prioritetnih zadataka.')]),
  );
}

// ------------------------------------------------------------ period ---
const metricsEl = document.querySelector('.metrics');
// As many KPI placeholders as the member has cards (Leads, Won + Lost, Opportunity).
metricsEl.dataset.cards = String(
  (sees('leads') ? 1 : 0) + (sees('won_lost') ? 2 : 0) + (sees('opportunity_value') ? 1 : 0),
);
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
    if (info.isCurrent) {
      if (summary.pipelineOverview) {
        renderPipelineOverview(document.querySelector('.pipeline'), summary.pipelineOverview);
      }
      if (summary.feedback) {
        renderFeedbackOverview(
          document.querySelector('[aria-labelledby="odgovor-title"] .list'),
          summary.feedback.items,
        );
      }
    }
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

// --------------------------------------------------------- Obavijesti ---
async function updateNotifications() {
  const list = document.querySelector('#dashboard-notifications .list');
  if (!list || !sees('notifications')) return;
  const items = await api.recentNotifications();
  list.replaceChildren(
    ...(items.length
      ? items.map((item) => {
          const li = el('li');
          const internal =
            typeof item.url === 'string' && item.url.startsWith('/') && !item.url.startsWith('//');
          const row = el(internal ? 'a' : 'div', 'event');
          if (internal) row.href = item.url;
          const time = el(
            'time',
            'event__time event__time--all-day',
            formatDateTime(item.occurredAt),
          );
          time.dateTime = item.occurredAt;
          const text = el('span', 'event__text');
          text.append(el('span', 'event__title', item.title), el('span', 'event__sub', item.body));
          row.append(time, text);
          if (internal) row.append(spriteIcon('chevron-right', 'icon chevron'));
          li.append(row);
          return li;
        })
      : [el('li', 'empty-row', 'Nema novih obavijesti.')]),
  );
}

async function refreshOperational() {
  await Promise.all([updateToday(), updatePriorities(), updateNotifications()]);
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
