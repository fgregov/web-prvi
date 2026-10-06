// Dashboard integration (prototypes/home): Quick Add sheet, today's Sales
// Calendar in "Danas", "Prioriteti" with completion, live pipeline totals.
// Everything comes from the server; the approved layout and styles are unchanged.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { labelOf, TASK_TYPES } from '../core/constants.js';
import { dayRange, formatSlot, todayKey } from '../core/format.js';
import { QuickAddSheet } from '../features/quick-add/quick-add-sheet.js';
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
    row.style.setProperty('--fill', `${Math.max(Math.round((stage.total / max) * 100), 14)}%`);
  });
}

document
  .querySelectorAll('.pipeline .stage')
  .forEach((row) => row.addEventListener('click', () => window.location.assign('/opportunities')));

async function refresh() {
  await Promise.all([updateToday(), updatePriorities(), updatePipeline()]).catch((error) => {
    if (!(error instanceof ApiError && error.status === 401)) showToast(error.message);
  });
}

onDataChanged(refresh);
await refresh();
consumeFlash();
