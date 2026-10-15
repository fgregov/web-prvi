// /users · KORISNICI: the organization's members. Status filter (Aktivni by
// default), search, sorting and pages are read by the server and kept in the
// address (?status=&q=&sort=&dir=&page=). One row can be selected: a click
// marks it (it does not open it); Odaberi opens PREGLED KORISNIKA, Deaktiviraj
// / Aktiviraj ask first. The buttons follow the rights the server reports;
// every action is checked there again.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { getAccess } from '../core/session.js';
import {
  errorText,
  fullName,
  lastLogin,
  statusBadge,
  USER_STATUSES,
} from '../features/users/user-format.js';
import { mountAppShell } from '../ui/app-shell.js';
import { confirmDialog } from '../ui/confirm.js';
import { h, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { consumeFlash, showToast } from '../ui/toast.js';

mountAppShell();
const root = document.getElementById('app');
const { user: me, permissions } = await getAccess();

const COLUMNS = [
  { key: 'firstName', label: 'Ime' },
  { key: 'lastName', label: 'Prezime' },
  { key: 'email', label: 'E-mail' },
  { key: 'phone', label: 'Telefon' },
  { key: 'status', label: 'Status' },
  { key: 'lastLoginAt', label: 'Zadnja prijava' },
];
const PAGE_SIZE = 20;

const params = new URLSearchParams(window.location.search);
const state = {
  status: USER_STATUSES.some((s) => s.value === params.get('status'))
    ? params.get('status')
    : 'active',
  q: (params.get('q') ?? '').slice(0, 100),
  sort: COLUMNS.some((c) => c.key === params.get('sort')) ? params.get('sort') : 'lastName',
  dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
  page: Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1),
};
let rows = [];
let total = 0;
let selectedId = null;
let busy = false;

function saveState() {
  const next = new URLSearchParams();
  if (state.status !== 'active') next.set('status', state.status);
  if (state.q) next.set('q', state.q);
  if (state.sort !== 'lastName') next.set('sort', state.sort);
  if (state.dir !== 'asc') next.set('dir', state.dir);
  if (state.page > 1) next.set('page', String(state.page));
  const search = next.toString();
  window.history.replaceState(window.history.state, '', `/users${search ? `?${search}` : ''}`);
}

// ------------------------------------------------------------ controls ---
const statusId = uid('user-status');
const statusSelect = h(
  'select',
  { class: 'rv-input', id: statusId, name: 'status' },
  USER_STATUSES.map((s) =>
    h('option', { value: s.value, selected: s.value === state.status }, s.label),
  ),
);
statusSelect.addEventListener('change', () => {
  state.status = statusSelect.value;
  state.page = 1;
  load();
});

const search = h('input', {
  class: 'rv-input rv-search',
  type: 'search',
  placeholder: 'Pretraži ime, prezime, e-mail ili telefon',
  'aria-label': 'Pretraži korisnike',
  autocomplete: 'off',
  maxlength: 100,
  value: state.q,
});
let timer;
search.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    state.q = search.value.trim();
    state.page = 1;
    load();
  }, 200);
});

const addButton = permissions.has('users.create')
  ? h('a', { class: 'rv-btn rv-btn--primary', href: '/users/new' }, icon('user-plus'), 'Dodaj')
  : null;
const lifecycleButton = permissions.has('users.deactivate')
  ? h('button', { type: 'button', class: 'rv-btn rv-btn--secondary', onClick: changeStatus })
  : null;
const openButton = permissions.has('users.view_details')
  ? h(
      'button',
      { type: 'button', class: 'rv-btn rv-btn--dark', onClick: openSelected },
      icon('eye'),
      'Odaberi',
    )
  : null;
const clearButton = h(
  'button',
  {
    type: 'button',
    class: 'rv-btn rv-btn--ghost rv-btn--sm',
    hidden: true,
    onClick: () => select(null),
  },
  icon('x'),
  'Poništi odabir',
);
const actionHint = h('p', { class: 'rv-users__hint', role: 'status', 'aria-live': 'polite' });

const count = h('p', { class: 'rv-muted' });
const tableHost = h('div', { class: 'rv-card rv-users__table-card' });
const pager = h('nav', { class: 'rv-pager', 'aria-label': 'Stranice korisnika' });

root.replaceChildren(
  h(
    'div',
    { class: 'rv-page-head' },
    h('div', {}, h('h1', { class: 'rv-page-title' }, 'KORISNICI'), count),
  ),
  h(
    'div',
    { class: 'rv-users__bar', role: 'toolbar', 'aria-label': 'Korisnici' },
    h(
      'div',
      { class: 'rv-users__filters' },
      h(
        'div',
        { class: 'rv-field rv-users__status' },
        h('label', { class: 'rv-field__label', for: statusId }, 'Status korisnika'),
        statusSelect,
      ),
      h('div', { class: 'rv-users__search' }, search),
    ),
    h('div', { class: 'rv-users__actions' }, addButton, lifecycleButton, openButton, clearButton),
  ),
  actionHint,
  tableHost,
  pager,
);

// ----------------------------------------------------------- selection ---
const selected = () => rows.find((u) => u.id === selectedId) ?? null;

function select(id) {
  selectedId = id;
  for (const tr of tableHost.querySelectorAll('tr[data-user-id]')) {
    const on = tr.dataset.userId === id;
    tr.classList.toggle('is-selected', on);
    tr.setAttribute('aria-selected', String(on));
    const radio = tr.querySelector('input[type="radio"]');
    if (radio) radio.checked = on;
  }
  renderActions();
}

function renderActions() {
  const user = selected();
  clearButton.hidden = !user;
  if (openButton) openButton.disabled = busy || !user || !user.can.view;
  if (lifecycleButton) {
    const inactive = user?.status === 'inactive';
    lifecycleButton.replaceChildren(
      icon(inactive ? 'user-check' : 'user-x'),
      inactive ? 'Aktiviraj' : 'Deaktiviraj',
    );
    lifecycleButton.disabled =
      busy || !user || (inactive ? !user.can.activate : !user.can.deactivate);
  }
  let hint = '';
  if (user && lifecycleButton && lifecycleButton.disabled && !busy) {
    if (user.id === me.id) hint = 'Ne možete deaktivirati vlastiti račun.';
    else if (user.role === 'owner' || user.role === 'admin')
      hint = 'Administratora i vlasnika može deaktivirati samo vlasnik organizacije.';
    else hint = 'Nemate pravo promijeniti status ovog korisnika.';
  }
  actionHint.textContent = hint;
  actionHint.hidden = !hint;
}

function openSelected() {
  const user = selected();
  if (user) window.location.assign(`/users/${encodeURIComponent(user.id)}`);
}

async function changeStatus() {
  const user = selected();
  if (!user || busy) return;
  const deactivate = user.status === 'active';
  const yes = await confirmDialog({
    title: deactivate ? 'Želite li deaktivirati korisnika?' : 'Želite li aktivirati korisnika?',
    message: `${fullName(user)} (${user.email})${
      deactivate
        ? ' više se neće moći prijaviti; svi njegovi podaci ostaju sačuvani.'
        : ' ponovno će se moći prijaviti s postojećom lozinkom.'
    }`,
    confirmLabel: 'DA',
    cancelLabel: 'NE',
  });
  if (!yes) return;
  busy = true;
  renderActions();
  try {
    if (deactivate) await api.deactivateUser(user.id);
    else await api.activateUser(user.id);
    showToast(deactivate ? 'Korisnik je uspješno deaktiviran.' : 'Korisnik je uspješno aktiviran.');
  } catch (error) {
    showToast(errorText(error, 'Promjena statusa nije uspjela. Pokušajte ponovno.'));
  } finally {
    busy = false;
  }
  await load();
}

// --------------------------------------------------------------- table ---
function sortButton(column) {
  const active = state.sort === column.key;
  return h(
    'button',
    {
      type: 'button',
      class: `rv-users__sort${active ? ' is-active' : ''}`,
      onClick: () => {
        if (active) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else {
          state.sort = column.key;
          state.dir = column.key === 'lastLoginAt' ? 'desc' : 'asc';
        }
        state.page = 1;
        load();
      },
    },
    column.label,
    icon(
      active ? (state.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down',
      'rv-icon rv-icon--sm',
    ),
  );
}

function renderTable() {
  if (!rows.length) {
    const empty = state.q
      ? 'Nema korisnika za ovu pretragu.'
      : state.status === 'inactive'
        ? 'Nema neaktivnih korisnika.'
        : state.status === 'active'
          ? 'Nema aktivnih korisnika.'
          : 'Još nema korisnika.';
    tableHost.replaceChildren(h('div', { class: 'rv-empty rv-empty--page' }, h('p', {}, empty)));
    return;
  }
  const name = uid('user-pick');
  tableHost.replaceChildren(
    h(
      'div',
      { class: 'rv-users__scroll' },
      h(
        'table',
        { class: 'rv-table', 'aria-label': 'Korisnici' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col', class: 'rv-table__pick' }, 'Označi'),
            COLUMNS.map((column) =>
              h(
                'th',
                {
                  scope: 'col',
                  'aria-sort':
                    state.sort === column.key
                      ? state.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : null,
                },
                sortButton(column),
              ),
            ),
          ),
        ),
        h(
          'tbody',
          {},
          rows.map((user) => {
            const label = `Označi korisnika ${fullName(user)}`;
            const radio = h('input', {
              type: 'radio',
              name,
              value: user.id,
              'aria-label': label,
              checked: user.id === selectedId,
            });
            const tr = h(
              'tr',
              {
                class: `rv-table__row${user.id === selectedId ? ' is-selected' : ''}${user.status === 'inactive' ? ' is-inactive' : ''}`,
                dataset: { userId: user.id },
                'aria-selected': String(user.id === selectedId),
              },
              h('td', { class: 'rv-table__pick' }, radio),
              h('td', {}, user.firstName),
              h('td', {}, user.lastName),
              h('td', { class: 'rv-table__email' }, user.email),
              h('td', { class: 'rv-table__nowrap' }, user.phone || '—'),
              h('td', {}, statusBadge(user.status)),
              h('td', { class: 'rv-table__nowrap' }, lastLogin(user.lastLoginAt)),
            );
            // A click marks the row (a second click on it clears the mark).
            tr.addEventListener('click', (event) => {
              if (event.target === radio) return;
              select(selectedId === user.id ? null : user.id);
            });
            radio.addEventListener('click', () => {
              if (radio.dataset.was === 'on') select(null);
            });
            radio.addEventListener('pointerdown', () => {
              radio.dataset.was = selectedId === user.id ? 'on' : '';
            });
            radio.addEventListener('change', () => {
              if (radio.checked) select(user.id);
            });
            return tr;
          }),
        ),
      ),
    ),
  );
}

function renderPager() {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) {
    pager.replaceChildren();
    pager.hidden = true;
    return;
  }
  pager.hidden = false;
  const from = (state.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, state.page * PAGE_SIZE);
  const go = (page) => () => {
    state.page = page;
    load();
  };
  pager.replaceChildren(
    h(
      'button',
      {
        type: 'button',
        class: 'rv-btn rv-btn--secondary rv-btn--sm',
        disabled: state.page <= 1,
        onClick: go(state.page - 1),
      },
      icon('chevron-left'),
      'Prethodna',
    ),
    h(
      'span',
      { class: 'rv-pager__info' },
      `${from}–${to} od ${total} · stranica ${state.page} od ${pages}`,
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'rv-btn rv-btn--secondary rv-btn--sm',
        disabled: state.page >= pages,
        onClick: go(state.page + 1),
      },
      'Sljedeća',
      icon('chevron-right'),
    ),
  );
}

const COUNT = {
  active: (n) => `Aktivni: ${n}`,
  inactive: (n) => `Neaktivni: ${n}`,
  all: (n) => `Svi korisnici: ${n}`,
};

let ticket = 0;
async function load() {
  const mine = ++ticket;
  saveState();
  let result;
  try {
    result = await api.listUsers({
      status: state.status,
      q: state.q,
      sort: state.sort,
      dir: state.dir,
      page: state.page,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    if (mine !== ticket) return;
    rows = [];
    total = 0;
    tableHost.replaceChildren(
      h(
        'div',
        { class: 'rv-empty rv-empty--page', role: 'alert' },
        h('p', {}, errorText(error, 'Korisnike trenutno nije moguće učitati.')),
        error instanceof ApiError && error.status === 403
          ? null
          : h(
              'button',
              { type: 'button', class: 'rv-btn rv-btn--secondary', onClick: load },
              'Pokušaj ponovno',
            ),
      ),
    );
    renderPager();
    select(null);
    return;
  }
  if (mine !== ticket) return; // a newer filter, search or page is loading
  rows = result.users;
  total = result.total;
  // A page past the end (after a filter change elsewhere): the last page.
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (state.page > pages) {
    state.page = pages;
    return load();
  }
  count.textContent = state.q ? `${total} rezultata` : COUNT[state.status](total);
  renderTable();
  renderPager();
  // The mark goes when its user is no longer in the list.
  select(rows.some((u) => u.id === selectedId) ? selectedId : null);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && selectedId && !document.querySelector('.rv-confirm-root'))
    select(null);
});

onDataChanged(load);
await load();
consumeFlash();
