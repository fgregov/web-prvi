// /tasks/{id} · Task detail: what, when, for whom; complete, reopen, edit or cancel.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { labelOf, TASK_PRIORITIES, TASK_TYPES } from '../core/constants.js';
import { formatDateTime, formatDue, formatSchedule } from '../core/format.js';
import { MESSAGES } from '../core/validation.js';
import { taskStatusBadge, taskTypeIcon } from '../features/tasks/task-row.js';
import { confirmDialog } from '../ui/confirm.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { goBack, here, withParams } from '../ui/navigation.js';
import { MobilePageHeader } from '../ui/screen.js';
import { consumeFlash, showToast } from '../ui/toast.js';

const taskId = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
const root = document.getElementById('screen');
const header = MobilePageHeader({ title: 'Zadatak', onBack: () => goBack('/tasks') });
const body = h('main', { class: 'rv-screen__body' });
root.replaceChildren(header.element, body);

const row = (label, value) =>
  value ? h('div', { class: 'rv-dl__row' }, h('dt', {}, label), h('dd', {}, value)) : null;

function actionButton(label, variant, handler) {
  const button = h('button', { type: 'button', class: `rv-btn rv-btn--${variant}` }, label);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await handler();
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : MESSAGES.taskSaveFailed);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function render(task) {
  document.title = `Renvara · ${task.title}`;
  const open = task.status === 'open';
  const editHref = withParams(`/tasks/${encodeURIComponent(task.id)}/edit`, { returnTo: here() });
  body.replaceChildren(
    h(
      'article',
      { class: 'rv-card rv-task-detail' },
      h(
        'div',
        { class: 'rv-task-detail__badges' },
        h(
          'span',
          { class: 'rv-badge rv-badge--neutral' },
          icon(taskTypeIcon(task.type), 'rv-icon rv-icon--xs'),
          labelOf(TASK_TYPES, task.type),
        ),
        taskStatusBadge(task) ?? h('span', { class: 'rv-badge rv-badge--neutral' }, 'Otvoreno'),
      ),
      h('h2', { class: 'rv-task-detail__title' }, task.title),
      h(
        'dl',
        { class: 'rv-dl' },
        row('Zakazano', formatSchedule(task) || 'Nije u Sales Kalendaru'),
        row('Rok', formatDue(task).replace(/^Rok: /, '') || 'Bez roka'),
        row('Prioritet', labelOf(TASK_PRIORITIES, task.priority)),
        row(
          'Kupac',
          task.customerName
            ? h(
                'a',
                { href: `/customers/${encodeURIComponent(task.companyId)}` },
                task.customerName,
              )
            : task.leadName
              ? null
              : 'Bez kupca',
        ),
        row(
          'Lead',
          task.leadName
            ? h('a', { href: `/leads/${encodeURIComponent(task.leadId)}` }, task.leadName)
            : null,
        ),
        row('Kontakt', task.contactName),
        row('Prilika', task.opportunityTitle),
        row('Bilješka', task.description),
        row('Kreirano', formatDateTime(task.createdAt)),
        row('Dovršeno', task.completedAt ? formatDateTime(task.completedAt) : null),
        row('Otkazano', task.cancelledAt ? formatDateTime(task.cancelledAt) : null),
      ),
    ),
    h(
      'div',
      { class: 'rv-screen__actions rv-screen__actions--stack' },
      open
        ? actionButton('Označi kao dovršeno', 'primary', async () => {
            render(await api.completeTask(task.id));
            showToast('Zadatak je dovršen.');
          })
        : actionButton('Vrati u otvoreno', 'secondary', async () => {
            render(await api.reopenTask(task.id));
            showToast('Zadatak je ponovno otvoren.');
          }),
      open ? h('a', { class: 'rv-btn rv-btn--secondary', href: editHref }, 'Uredi zadatak') : null,
      open
        ? actionButton('Otkaži zadatak', 'ghost', async () => {
            const yes = await confirmDialog({
              title: 'Otkazati zadatak?',
              message: 'Zadatak ostaje u povijesti kao otkazan i uklanja se iz Sales Kalendara.',
              cancelLabel: 'Ne',
              confirmLabel: 'Otkaži zadatak',
            });
            if (!yes) return;
            render(await api.cancelTask(task.id));
            showToast('Zadatak je otkazan.');
          })
        : null,
    ),
  );
}

async function load() {
  try {
    render(await api.getTask(taskId));
  } catch (error) {
    body.replaceChildren(
      h(
        'div',
        { class: 'rv-card rv-empty rv-empty--page' },
        h('h2', {}, error instanceof ApiError ? error.message : MESSAGES.unavailable),
        h('a', { class: 'rv-btn rv-btn--secondary', href: '/tasks' }, 'Svi zadaci'),
      ),
    );
  }
}

onDataChanged(load);
await load();
consumeFlash();
