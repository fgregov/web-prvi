// PRAVA PRISTUPA: the rights of one member as accordions of switches, a group
// per area ("3 od 4" in its header). Shared by NOVI KORISNIK and PREGLED
// KORISNIKA. It only edits a draft: the server checks every change again
// (role, rights the administrator holds, last owner, own account).
import {
  isAdminOnly,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  permissionLabel,
  ROLES,
  togglePermission,
} from '../../core/permissions.js';
import { accordionSection } from '../../ui/accordion.js';
import { h, uid } from '../../ui/dom.js';

const GROUP_ICONS = {
  sales: 'briefcase-business',
  modules: 'layout-grid',
  dashboard: 'home',
  users: 'users',
  notifications: 'bell',
};

/**
 * @param {object} options
 * @param {string[]} options.permissions  the member's rights (draft starts here)
 * @param {string} options.role           'owner' | 'admin' | 'user'
 * @param {Set<string>} options.grantable rights the administrator holds (may give or take)
 * @param {boolean} options.editable      false: read only (no right, or one's own account)
 * @param {boolean} [options.roleEditable] only the owner changes roles (never their own)
 * @param {{ add(id: string): void, delete(id: string): void, has(id: string): boolean }} options.open
 * @param {() => void} [options.onChange]
 */
export function permissionsEditor({
  permissions,
  role,
  grantable,
  editable,
  roleEditable = false,
  open,
  onChange = () => {},
}) {
  let keys = [...permissions];
  let currentRole = role;
  let errors = {};
  const element = h('div', { class: 'rv-rights' });
  const message = h('p', { class: 'rv-rights__message', role: 'status', hidden: true });

  const has = (key) => currentRole === 'owner' || keys.includes(key);

  function say(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  function set(key, on) {
    const next = togglePermission(keys, key, on);
    const changed = PERMISSION_KEYS.filter((k) => next.includes(k) !== keys.includes(k));
    const blocked = changed.filter((k) => !grantable.has(k));
    if (blocked.length) {
      say(
        `Ne možete mijenjati pravo koje sami nemate: ${blocked.map(permissionLabel).join(', ')}.`,
      );
      return render();
    }
    keys = next;
    delete errors[key];
    say('');
    render();
    onChange();
  }

  function setRole(next) {
    currentRole = next;
    // A Korisnik never holds user administration.
    if (next === 'user') keys = keys.filter((k) => !isAdminOnly(k));
    say('');
    render();
    onChange();
  }

  function row(item, { disabledByMaster }) {
    const id = uid('right');
    const on = has(item.key);
    const adminOnlyForUser = item.adminOnly && currentRole === 'user';
    const notMine = !grantable.has(item.key);
    const disabled =
      !editable || currentRole === 'owner' || disabledByMaster || adminOnlyForUser || notMine;
    const hints = [];
    if (adminOnlyForUser) hints.push('Samo za ulogu Administrator.');
    else if (editable && notMine && currentRole !== 'owner')
      hints.push('Ovo pravo nemate ni sami.');
    if (item.needs && on && !has(item.needs)) {
      hints.push(`Prikazuje se tek uz pravo: ${permissionLabel(item.needs)}.`);
    }
    const input = h('input', {
      class: 'rv-switch__input',
      id,
      type: 'checkbox',
      role: 'switch',
      checked: on,
      disabled,
      dataset: { right: item.key },
      'aria-describedby': hints.length || errors[item.key] ? `${id}-hint` : null,
      onChange: (event) => set(item.key, event.target.checked),
    });
    return h(
      'li',
      {
        class: `rv-rights__row${disabled ? ' is-disabled' : ''}${errors[item.key] ? ' is-invalid' : ''}`,
      },
      h(
        'label',
        { class: 'rv-switch', for: id },
        h('span', { class: 'rv-switch__text' }, item.label),
        input,
        h('span', { class: 'rv-switch__track', 'aria-hidden': 'true' }),
      ),
      hints.length || errors[item.key]
        ? h(
            'p',
            { class: 'rv-rights__hint', id: `${id}-hint` },
            [errors[item.key], ...hints].filter(Boolean).join(' '),
          )
        : null,
    );
  }

  function group(def) {
    const total = def.items.length;
    const granted = def.items.filter((item) => has(item.key)).length;
    const masterOff = def.master ? !has(def.master) : false;
    const invalid = def.items.some((item) => errors[item.key]);
    const section = accordionSection({
      id: `prava-${def.key}`,
      title: def.title,
      iconName: GROUP_ICONS[def.key] ?? 'shield',
      count: `${granted} od ${total}`,
      open,
      children: h(
        'ul',
        { class: 'rv-rights__list', role: 'list' },
        def.items.map((item) =>
          row(item, { disabledByMaster: masterOff && item.key !== def.master }),
        ),
      ),
    });
    section.classList.add('rv-rights__group');
    if (invalid) section.classList.add('is-invalid');
    return section;
  }

  function roleControl() {
    const name = uid('role');
    return h(
      'fieldset',
      { class: 'rv-rights__role' },
      h('legend', { class: 'rv-field__label' }, 'Uloga'),
      h(
        'div',
        { class: 'rv-segmented', role: 'radiogroup', 'aria-label': 'Uloga' },
        ROLES.map((option) =>
          h(
            'label',
            { class: 'rv-segmented__option' },
            h('input', {
              type: 'radio',
              name,
              value: option.value,
              checked: option.value === currentRole,
              disabled: !roleEditable,
              onChange: () => setRole(option.value),
            }),
            h('span', {}, option.label),
          ),
        ),
      ),
      h(
        'p',
        { class: 'rv-field__hint' },
        currentRole === 'owner'
          ? 'Vlasnik ima sva prava i ne može ih se ograničiti.'
          : currentRole === 'admin'
            ? 'Administrator može dobiti i prava upravljanja korisnicima.'
            : 'Korisnik radi u CRM-u; upravljanje korisnicima nije dostupno.',
      ),
    );
  }

  function render() {
    element.replaceChildren(
      roleControl(),
      message,
      h('div', { class: 'rv-accordion-list' }, PERMISSION_GROUPS.map(group)),
    );
  }
  render();

  return {
    element,
    /** The draft as the server takes it. */
    value: () => ({
      role: currentRole,
      permissions: currentRole === 'owner' ? [] : PERMISSION_KEYS.filter((k) => keys.includes(k)),
    }),
    /** Back to saved rights (Odustani, or after saving). */
    reset(next) {
      keys = [...next.permissions];
      currentRole = next.role;
      errors = {};
      say('');
      render();
    },
    /** Per-right messages from the server (422). */
    setErrors(next) {
      errors = { ...next };
      for (const def of PERMISSION_GROUPS) {
        if (def.items.some((item) => errors[item.key])) open.add(`prava-${def.key}`);
      }
      render();
      element.querySelector('.rv-rights__row.is-invalid input')?.focus();
    },
    showMessage: say,
  };
}
