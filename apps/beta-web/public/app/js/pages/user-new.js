// /users/new · NOVI KORISNIK. The server creates the sign-in account first
// (Supabase Auth, or the BETA server's accounts file) without a password: the
// new member sets it from an invitation link. Success is shown only after the
// server confirms both the account and the member.
import { api, ApiError } from '../core/api.js';
import { DEFAULT_USER_PERMISSIONS } from '../core/permissions.js';
import { getAccess } from '../core/session.js';
import { hasErrors, validateUserProfile } from '../core/validation.js';
import { linkDialog } from '../features/users/link-dialog.js';
import { permissionsEditor } from '../features/users/permissions-editor.js';
import { errorText } from '../features/users/user-format.js';
import { BLANK_USER, profileFields } from '../features/users/user-fields.js';
import { openSectionsState } from '../ui/accordion.js';
import { h } from '../ui/dom.js';
import { createForm } from '../ui/form.js';
import { icon } from '../ui/icons.js';
import { createFormScreen } from '../ui/screen.js';
import { setFlash } from '../ui/toast.js';

const { user: me, permissions } = await getAccess();
const grantable = permissions; // an owner's session lists every right

const screen = createFormScreen({
  root: document.getElementById('screen'),
  title: 'NOVI KORISNIK',
  submitLabel: 'Spremi korisnika',
  fallback: '/users',
  discardMessage: 'Uneseni podaci o korisniku neće biti spremljeni.',
  onSubmit: save,
});
screen.actions.cancel.textContent = 'Odustani';

const form = createForm([{ title: 'Osnovni podaci', fields: profileFields(BLANK_USER) }], {
  notice:
    'Korisnik će e-mailom (ili poveznicom koju mu proslijedite) dobiti poziv da sam postavi lozinku. Lozinke se ne unose ovdje.',
});

const mayChooseRights = permissions.has('users.manage_permissions');
const editor = mayChooseRights
  ? permissionsEditor({
      permissions: DEFAULT_USER_PERMISSIONS.filter((k) => grantable.has(k)),
      role: 'user',
      grantable,
      editable: true,
      roleEditable: me.role === 'owner',
      open: openSectionsState(['prava-sales']),
    })
  : null;

screen.setContent(
  h(
    'div',
    { class: 'rv-user-new' },
    form.element,
    editor
      ? h(
          'section',
          { class: 'rv-form__section rv-user-new__rights', 'aria-labelledby': 'new-rights-title' },
          h(
            'h3',
            { class: 'rv-form__section-title', id: 'new-rights-title' },
            icon('shield', 'rv-icon rv-icon--sm'),
            ' Prava pristupa',
          ),
          h(
            'p',
            { class: 'rv-field__hint' },
            'Zadano: rad u CRM-u bez upravljanja korisnicima. Prava se mogu promijeniti i kasnije.',
          ),
          editor.element,
        )
      : h(
          'p',
          { class: 'rv-notice' },
          icon('info'),
          h(
            'span',
            {},
            'Novi korisnik dobit će zadana prava: rad u CRM-u bez upravljanja korisnicima.',
          ),
        ),
  ),
  () => ({ ...form.values(), ...(editor ? editor.value() : {}) }),
);

async function save() {
  const values = form.values();
  const errors = validateUserProfile(values); // the server also checks that the e-mail is free
  if (hasErrors(errors)) {
    form.setErrors(errors);
    return;
  }
  const input = { ...values };
  if (editor) {
    const access = editor.value();
    input.permissions = access.permissions;
    if (me.role === 'owner') input.role = access.role;
  }
  screen.setSaving(true);
  let result;
  try {
    result = await api.createUser(input);
  } catch (error) {
    screen.setSaving(false);
    if (error instanceof ApiError && error.status === 422) {
      form.setErrors(error.errors);
      editor?.setErrors(error.errors);
      if (!Object.keys(error.errors).some((k) => k in BLANK_USER)) {
        screen.showError(errorText(error, 'Provjerite unesene podatke.'));
      }
    } else {
      screen.showError(errorText(error, 'Korisnika nije moguće spremiti. Pokušajte ponovno.'));
    }
    return;
  }
  screen.allowLeave();
  const { user, link } = result;
  const target = `/users/${encodeURIComponent(user.id)}`;
  if (link?.delivery === 'link') {
    await linkDialog({
      title: 'Korisnik je uspješno kreiran.',
      intro: `Pošaljite ${user.firstName} ${user.lastName} ovu poveznicu za postavljanje lozinke. Bez nje se korisnik ne može prijaviti.`,
      link,
      doneLabel: 'Otvori korisnika',
    });
    setFlash('Korisnik je uspješno kreiran.');
  } else {
    setFlash(
      link?.delivery === 'email'
        ? 'Korisnik je uspješno kreiran. Poziv za postavljanje lozinke poslan je e-mailom.'
        : link?.delivery === 'none'
          ? 'Korisnik je uspješno kreiran. (Demo: bez prijave i bez poziva e-mailom.)'
          : 'Korisnik je uspješno kreiran.',
    );
  }
  window.location.replace(target);
}
