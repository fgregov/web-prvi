// /users/{id} · PREGLED KORISNIKA: header, then OSNOVNI PODACI, LOZINKA I
// SIGURNOST, PRAVA PRISTUPA and POVIJEST PROMJENA as accordions. Each section
// saves on its own; what the page offers follows `can` from the server, which
// checks every change again.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { formatDateTime, initials } from '../core/format.js';
import { PERMISSION_GROUPS, permissionLabel } from '../core/permissions.js';
import { getAccess } from '../core/session.js';
import {
  hasErrors,
  passwordErrors,
  PASSWORD_MIN,
  validateUserProfile,
} from '../core/validation.js';
import { linkDialog } from '../features/users/link-dialog.js';
import { permissionsEditor } from '../features/users/permissions-editor.js';
import {
  errorText,
  fullName,
  lastLogin,
  roleLabel,
  statusBadge,
} from '../features/users/user-format.js';
import { profileFields } from '../features/users/user-fields.js';
import { accordionSection, openSectionsState } from '../ui/accordion.js';
import { mountAppShell } from '../ui/app-shell.js';
import { h } from '../ui/dom.js';
import { FormField } from '../ui/fields.js';
import { createForm } from '../ui/form.js';
import { icon } from '../ui/icons.js';
import { goBack } from '../ui/navigation.js';
import { UnsavedChangesDialog } from '../ui/screen.js';
import { consumeFlash, showToast } from '../ui/toast.js';

const userId = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
const root = document.getElementById('app');
mountAppShell();
const { user: me, permissions } = await getAccess();

const SECTIONS = ['osnovno', 'lozinka', 'prava', 'povijest'];
const openSections = openSectionsState(
  [...SECTIONS, ...PERMISSION_GROUPS.map((g) => `prava-${g.key}`)],
  window.location.hash.slice(1),
);
const PROFILE_KEYS = ['firstName', 'lastName', 'oib', 'email', 'phone'];
const dateFmt = new Intl.DateTimeFormat('hr-HR', { dateStyle: 'long' });

let data = null; // { user, passwordState, can, self }
let profileForm = null;
let profilePristine = '';
let editor = null;
let rightsPristine = '';
let leaving = false;

const profileDirty = () =>
  Boolean(profileForm) && JSON.stringify(pickProfile(profileForm.values())) !== profilePristine;
const rightsDirty = () => Boolean(editor) && JSON.stringify(editor.value()) !== rightsPristine;
const isDirty = () => profileDirty() || rightsDirty();
const pickProfile = (values) => Object.fromEntries(PROFILE_KEYS.map((k) => [k, values[k] ?? '']));

// ------------------------------------------------- unsaved changes guard ---
async function confirmLeave() {
  if (leaving || !isDirty()) return true;
  return UnsavedChangesDialog({
    message: 'Nespremljene promjene na ovom korisniku bit će izgubljene.',
  });
}
window.addEventListener('beforeunload', (event) => {
  if (!leaving && isDirty()) {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.addEventListener(
  'click',
  async (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || leaving || !isDirty()) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (await confirmLeave()) {
      leaving = true;
      window.location.assign(link.getAttribute('href'));
    }
  },
  true,
);

const back = h(
  'button',
  {
    type: 'button',
    class: 'rv-backlink',
    onClick: async () => {
      if (!(await confirmLeave())) return;
      leaving = true;
      goBack('/users');
    },
  },
  icon('arrow-left'),
  'Korisnici',
);

// --------------------------------------------------------------- header ---
function header(user) {
  return h(
    'header',
    { class: 'rv-card rv-profile-header rv-user-header' },
    h(
      'div',
      { class: 'rv-profile-header__identity' },
      h('span', { class: 'rv-company-avatar', 'aria-hidden': 'true' }, initials(fullName(user))),
      h(
        'div',
        { class: 'rv-profile-header__text' },
        h(
          'div',
          { class: 'rv-profile-header__title-row' },
          h('h1', { class: 'rv-profile-header__name' }, fullName(user)),
          statusBadge(user.status),
          h('span', { class: 'rv-badge rv-badge--neutral' }, roleLabel(user.role)),
          data.self ? h('span', { class: 'rv-badge rv-badge--red' }, 'Vi') : null,
        ),
        h(
          'p',
          { class: 'rv-profile-header__address' },
          icon('mail'),
          h('span', {}, user.email || '—'),
        ),
        h(
          'dl',
          { class: 'rv-profile-header__meta' },
          h(
            'div',
            {},
            h('dt', {}, 'Kreiran'),
            h('dd', {}, dateFmt.format(new Date(user.createdAt))),
          ),
          h('div', {}, h('dt', {}, 'Zadnja prijava'), h('dd', {}, lastLogin(user.lastLoginAt))),
          user.status === 'inactive' && user.deactivatedAt
            ? h(
                'div',
                {},
                h('dt', {}, 'Deaktiviran'),
                h('dd', {}, dateFmt.format(new Date(user.deactivatedAt))),
              )
            : null,
        ),
      ),
    ),
  );
}

function actionsRow(...buttons) {
  return h('div', { class: 'rv-user-section__actions' }, buttons);
}

function notice(text, kind = 'info') {
  return h(
    'p',
    { class: `rv-notice${kind === 'warn' ? ' rv-notice--warn' : ''}` },
    icon(kind === 'warn' ? 'alert' : 'info'),
    h('span', {}, text),
  );
}

// ------------------------------------------------------ OSNOVNI PODACI ---
function profileSection(user) {
  const host = h('div', { class: 'rv-user-section' });
  if (!data.can.edit) {
    profileForm = null;
    host.append(
      h(
        'dl',
        { class: 'rv-user-facts' },
        [
          ['Ime', user.firstName],
          ['Prezime', user.lastName],
          ['OIB', user.oib || '—'],
          ['E-mail', user.email],
          ['Telefon', user.phone || '—'],
          ['Uloga', roleLabel(user.role)],
        ].map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', {}, value))),
      ),
      notice('Nemate pravo uređivati podatke ovog korisnika.'),
    );
    return host;
  }
  profileForm = createForm([{ fields: profileFields(user) }], { single: false });
  profilePristine = JSON.stringify(pickProfile(user));
  const error = h('p', { class: 'rv-screen__error', role: 'alert', hidden: true });
  const cancel = h('button', { type: 'button', class: 'rv-btn rv-btn--secondary' }, 'Odustani');
  const save = h('button', { type: 'submit', class: 'rv-btn rv-btn--primary' }, 'Spremi promjene');
  const sync = () => {
    const dirty = profileDirty();
    cancel.disabled = !dirty;
    save.disabled = !dirty;
  };
  const formEl = h(
    'form',
    { novalidate: true, class: 'rv-user-profile-form' },
    profileForm.element,
    h(
      'p',
      { class: 'rv-field__hint' },
      'Promjena e-maila mijenja i adresu za prijavu (i u sustavu za prijavu).',
    ),
    error,
    actionsRow(cancel, save),
  );
  formEl.addEventListener('input', sync);
  formEl.addEventListener('change', sync);
  cancel.addEventListener('click', () => {
    for (const key of PROFILE_KEYS) profileForm.setValue(key, user[key] ?? '');
    profileForm.setErrors({});
    error.hidden = true;
    sync();
  });
  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const values = pickProfile(profileForm.values());
    const errors = validateUserProfile(values);
    if (hasErrors(errors)) {
      profileForm.setErrors(errors);
      return;
    }
    save.disabled = true;
    cancel.disabled = true;
    save.textContent = 'Spremanje...';
    try {
      const updated = await api.updateUser(userId, values);
      data.user = { ...data.user, ...updated, permissions: data.user.permissions };
      profilePristine = JSON.stringify(pickProfile(updated));
      showToast('Podaci korisnika su spremljeni.');
      renderHeader();
      loadAudit();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 422)
        profileForm.setErrors(failure.errors);
      else {
        error.textContent = errorText(failure, 'Promjene nije moguće spremiti. Pokušajte ponovno.');
        error.hidden = false;
      }
    } finally {
      save.textContent = 'Spremi promjene';
      sync();
    }
  });
  sync();
  host.append(formEl);
  return host;
}

// ------------------------------------------------ LOZINKA I SIGURNOST ---
function passwordSection(user) {
  const host = h('div', { class: 'rv-user-section' });
  if (data.passwordState === 'server') {
    host.append(
      notice(
        'Lozinka ovog računa postavljena je u postavkama poslužitelja (RENVARA_BETA_PASSWORD) i mijenja se ondje.',
      ),
    );
    return host;
  }
  if (data.passwordState === 'unavailable') {
    host.append(
      notice(
        'Demo: ovdje nema prijave lozinkom. Na BETA serveru i sa Supabase Auth ovdje se mijenja lozinka ili šalje poveznica za novu lozinku.',
      ),
    );
    return host;
  }
  if (data.passwordState === 'pending') {
    host.append(notice('Korisnik još nije postavio lozinku: pozivnica nije iskorištena.', 'warn'));
  }
  if (!data.can.changePassword) {
    host.append(notice('Za promjenu lozinke drugog korisnika potrebno je posebno pravo.'));
    return host;
  }

  const form = createForm(
    [
      {
        fields: [
          FormField('currentPassword', data.self ? 'Trenutna lozinka' : 'Vaša trenutna lozinka', {
            type: 'password',
            required: true,
            autocomplete: 'current-password',
            maxlength: 512,
            hint: data.self
              ? 'Potvrda da ste to vi.'
              : 'Prije promjene tuđe lozinke potvrdite svoj identitet.',
          }),
          FormField('password', 'Nova lozinka', {
            type: 'password',
            required: true,
            autocomplete: 'new-password',
            maxlength: 128,
            hint: `Najmanje ${PASSWORD_MIN} znakova, barem jedno slovo i jedna znamenka; bez imena i e-maila.`,
            full: false,
          }),
          FormField('confirm', 'Ponovite novu lozinku', {
            type: 'password',
            required: true,
            autocomplete: 'new-password',
            maxlength: 128,
            full: false,
          }),
        ],
      },
    ],
    {},
  );
  const inputs = ['currentPassword', 'password', 'confirm'].map((name) => form.control(name));
  const show = h('input', {
    type: 'checkbox',
    class: 'rv-checkbox',
    id: 'show-passwords',
    onChange: (event) => {
      for (const input of inputs) input.type = event.target.checked ? 'text' : 'password';
    },
  });
  const error = h('p', { class: 'rv-screen__error', role: 'alert', hidden: true });
  const done = h('p', { class: 'rv-user-success', role: 'status', hidden: true });
  const submit = h(
    'button',
    { type: 'submit', class: 'rv-btn rv-btn--primary' },
    icon('lock'),
    'Promijeni lozinku',
  );
  const formEl = h(
    'form',
    { novalidate: true, class: 'rv-user-password-form', 'aria-label': 'Promjena lozinke' },
    form.element,
    h(
      'label',
      { class: 'rv-check', for: 'show-passwords' },
      show,
      h('span', {}, 'Prikaži lozinke'),
    ),
    error,
    done,
    actionsRow(submit),
  );
  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    done.hidden = true;
    const values = form.values();
    const errors = {
      ...(values.currentPassword ? {} : { currentPassword: 'Unesite svoju trenutnu lozinku.' }),
      ...passwordErrors(values.password, values.confirm, {
        email: user.email,
        names: [user.firstName, user.lastName],
      }),
    };
    if (hasErrors(errors)) {
      form.setErrors(errors);
      return;
    }
    submit.disabled = true;
    try {
      await api.changeUserPassword(userId, values);
      for (const input of inputs) input.value = '';
      show.checked = false;
      for (const input of inputs) input.type = 'password';
      form.setErrors({});
      done.textContent = data.self
        ? 'Lozinka je uspješno promijenjena. Ostale vaše sesije su odjavljene.'
        : 'Lozinka je uspješno promijenjena. Korisnik je odjavljen sa svih uređaja i bit će obaviješten pri sljedećoj prijavi.';
      done.hidden = false;
      showToast('Lozinka je uspješno promijenjena.');
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 422) form.setErrors(failure.errors);
      else {
        error.textContent = errorText(
          failure,
          'Lozinku nije moguće promijeniti. Pokušajte ponovno.',
        );
        error.hidden = false;
      }
    } finally {
      submit.disabled = false;
    }
  });
  host.append(
    h(
      'h3',
      { class: 'rv-user-section__title' },
      data.self ? 'Promjena vlastite lozinke' : `Nova lozinka za ${fullName(user)}`,
    ),
    formEl,
  );

  if (!data.self && user.status === 'active') {
    const linkButton = h(
      'button',
      { type: 'button', class: 'rv-btn rv-btn--secondary' },
      icon('send'),
      'Pošalji poveznicu za novu lozinku',
    );
    linkButton.addEventListener('click', async () => {
      linkButton.disabled = true;
      try {
        const link = await api.userPasswordLink(userId);
        if (link.delivery === 'link') {
          await linkDialog({
            title: 'Poveznica za novu lozinku',
            intro: `Pošaljite poveznicu korisniku ${fullName(user)}. Postojeća lozinka vrijedi dok je korisnik ne promijeni.`,
            link,
            doneLabel: 'Zatvori',
          });
        } else if (link.delivery === 'email') {
          showToast('Poveznica za postavljanje lozinke poslana je e-mailom.');
        } else {
          showToast('U demo verziji poveznice se ne šalju.');
        }
      } catch (failure) {
        showToast(errorText(failure, 'Poveznicu nije moguće izraditi. Pokušajte ponovno.'));
      } finally {
        linkButton.disabled = false;
      }
    });
    host.append(
      h(
        'div',
        { class: 'rv-user-section__alt' },
        h('h3', { class: 'rv-user-section__title' }, 'Ili: korisnik sam postavlja lozinku'),
        h(
          'p',
          { class: 'rv-field__hint' },
          'Jednokratna poveznica (vrijedi 2 sata). Administrator ne vidi novu lozinku.',
        ),
        actionsRow(linkButton),
      ),
    );
  }
  return host;
}

// ------------------------------------------------------ PRAVA PRISTUPA ---
function rightsSection(user) {
  const host = h('div', { class: 'rv-user-section' });
  const editable = data.can.manageAccess;
  editor = permissionsEditor({
    permissions: user.permissions,
    role: user.role,
    grantable: permissions,
    editable,
    roleEditable: data.can.changeRole,
    open: openSections,
    onChange: () => sync(),
  });
  rightsPristine = JSON.stringify(editor.value());
  const reason = data.self
    ? 'Ne možete mijenjati vlastitu ulogu ni vlastita prava.'
    : !permissions.has('users.manage_permissions')
      ? 'Nemate pravo upravljati pravima pristupa.'
      : !editable
        ? 'Prava administratora i vlasnika mijenja samo vlasnik organizacije.'
        : null;
  if (reason) host.append(notice(reason));
  host.append(editor.element);
  if (!editable) {
    editor = null; // read only: never "unsaved"
    return host;
  }
  const error = h('p', { class: 'rv-screen__error', role: 'alert', hidden: true });
  const cancel = h('button', { type: 'button', class: 'rv-btn rv-btn--secondary' }, 'Odustani');
  const save = h(
    'button',
    { type: 'button', class: 'rv-btn rv-btn--primary' },
    'Spremi prava pristupa',
  );
  const dirtyNote = h(
    'p',
    { class: 'rv-user-dirty', role: 'status', hidden: true },
    'Imate nespremljene promjene prava pristupa.',
  );
  function sync() {
    const dirty = rightsDirty();
    cancel.disabled = !dirty;
    save.disabled = !dirty;
    dirtyNote.hidden = !dirty;
  }
  cancel.addEventListener('click', () => {
    editor.reset({ role: user.role, permissions: user.permissions });
    error.hidden = true;
    sync();
  });
  save.addEventListener('click', async () => {
    error.hidden = true;
    save.disabled = true;
    cancel.disabled = true;
    save.textContent = 'Spremanje...';
    try {
      await api.setUserAccess(userId, editor.value());
      showToast('Prava pristupa su spremljena. Vrijede odmah, i u otvorenim sesijama.');
      data = await api.getUser(userId);
      renderHeader();
      rightsHost.replaceChildren(rightsSection(data.user));
      loadAudit();
      return;
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        failure.status === 422 &&
        Object.keys(failure.errors).length
      ) {
        editor.setErrors(failure.errors);
      }
      error.textContent = errorText(failure, 'Prava nije moguće spremiti. Pokušajte ponovno.');
      error.hidden = false;
    } finally {
      save.textContent = 'Spremi prava pristupa';
      sync();
    }
  });
  host.append(dirtyNote, error, actionsRow(cancel, save));
  sync();
  return host;
}

// -------------------------------------------------- POVIJEST PROMJENA ---
const ACTIONS = {
  'user.create': 'Korisnik kreiran',
  'user.update': 'Osnovni podaci promijenjeni',
  'user.deactivate': 'Korisnik deaktiviran',
  'user.activate': 'Korisnik aktiviran',
  'user.access': 'Prava pristupa promijenjena',
  'user.password_change': 'Lozinka promijenjena',
  'user.password_link': 'Izrađena poveznica za lozinku',
};
const FIELD_LABELS = {
  firstName: 'ime',
  lastName: 'prezime',
  oib: 'OIB',
  email: 'e-mail',
  phone: 'telefon',
};

function auditDetail(entry) {
  const d = entry.details ?? {};
  if (entry.result !== 'success')
    return d.reason
      ? `Odbijeno: ${d.reason === 'reauthentication' ? 'neispravna potvrda identiteta' : d.reason}`
      : 'Nije uspjelo';
  if (entry.action === 'user.update' && Array.isArray(d.fields))
    return d.fields.map((f) => FIELD_LABELS[f] ?? f).join(', ');
  if (entry.action === 'user.access') {
    const parts = [];
    if (d.role) parts.push(`uloga: ${roleLabel(d.role.from)} → ${roleLabel(d.role.to)}`);
    if (d.granted?.length) parts.push(`dodano: ${d.granted.map(permissionLabel).join(', ')}`);
    if (d.revoked?.length) parts.push(`oduzeto: ${d.revoked.map(permissionLabel).join(', ')}`);
    return parts.join(' · ');
  }
  if (entry.action === 'user.password_change') {
    return (
      { self: 'sam korisnik', administrator: 'administrator', link: 'putem poveznice' }[d.by] ?? ''
    );
  }
  if (entry.action === 'user.create' && d.role) return `uloga: ${roleLabel(d.role)}`;
  return '';
}

const auditHost = h('div', { class: 'rv-user-section' });
async function loadAudit() {
  try {
    const entries = await api.userAudit(userId);
    auditHost.replaceChildren(
      entries.length
        ? h(
            'ol',
            { class: 'rv-audit', role: 'list' },
            entries.map((entry) =>
              h(
                'li',
                { class: `rv-audit__item${entry.result !== 'success' ? ' is-denied' : ''}` },
                h('strong', {}, ACTIONS[entry.action] ?? entry.action),
                h('span', { class: 'rv-audit__detail' }, auditDetail(entry)),
                h(
                  'span',
                  { class: 'rv-audit__meta' },
                  `${formatDateTime(entry.at)} · ${entry.actor ? (entry.actor.id === me.id ? 'vi' : entry.actor.name) : 'sustav'}`,
                ),
              ),
            ),
          )
        : h('div', { class: 'rv-empty' }, h('p', {}, 'Još nema zapisa.')),
    );
  } catch (failure) {
    auditHost.replaceChildren(
      h(
        'div',
        { class: 'rv-empty' },
        h('p', {}, errorText(failure, 'Povijest trenutno nije dostupna.')),
      ),
    );
  }
}

// ---------------------------------------------------------------- page ---
const headerHost = h('div');
const profileHost = h('div');
const passwordHost = h('div');
const rightsHost = h('div');
const sectionsHost = h(
  'div',
  { class: 'rv-accordion-list' },
  accordionSection({
    id: 'osnovno',
    title: 'Osnovni podaci',
    iconName: 'user',
    open: openSections,
    children: profileHost,
  }),
  accordionSection({
    id: 'lozinka',
    title: 'Lozinka i sigurnost',
    iconName: 'lock',
    open: openSections,
    children: passwordHost,
  }),
  accordionSection({
    id: 'prava',
    title: 'Prava pristupa',
    iconName: 'shield',
    open: openSections,
    children: rightsHost,
  }),
  accordionSection({
    id: 'povijest',
    title: 'Povijest promjena',
    iconName: 'history',
    open: openSections,
    children: auditHost,
  }),
);
function renderHeader() {
  headerHost.replaceChildren(header(data.user));
  document.title = `Renvara · ${fullName(data.user)}`;
}

function render() {
  const user = data.user;
  renderHeader();
  profileHost.replaceChildren(profileSection(user));
  passwordHost.replaceChildren(passwordSection(user));
  rightsHost.replaceChildren(rightsSection(user));
  loadAudit();
}

async function load({ force = false } = {}) {
  if (!force && isDirty()) return; // another tab changed data: keep this draft
  let next;
  try {
    next = await api.getUser(userId);
  } catch (error) {
    document.title = 'Renvara · Korisnik nije pronađen';
    const forbidden = error instanceof ApiError && error.status === 403;
    root.replaceChildren(
      back,
      h(
        'div',
        { class: 'rv-card rv-empty rv-empty--page', role: 'alert' },
        h(
          'h1',
          {},
          forbidden
            ? '403 — Nemate pravo pristupa ovoj funkcionalnosti.'
            : 'Korisnik nije pronađen',
        ),
        h('p', {}, errorText(error, 'Pokušajte ponovno.')),
        h('a', { class: 'rv-btn rv-btn--secondary', href: '/users' }, 'Svi korisnici'),
      ),
    );
    return;
  }
  data = next;
  const scroll = window.scrollY;
  render();
  if (!root.contains(sectionsHost)) root.replaceChildren(back, headerHost, sectionsHost);
  window.scrollTo({ top: scroll });
}

onDataChanged(() => load());
await load({ force: true });
const first = openSections.first();
if (first && SECTIONS.includes(first) && window.location.hash)
  document.getElementById(first)?.scrollIntoView();
consumeFlash();
