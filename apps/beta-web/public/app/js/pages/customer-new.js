// /customers/new · NewCustomerScreen
//
// A dedicated route-level screen (not part of the dashboard). The dashboard's
// Quick Add only navigates here; this module owns the form, unsaved-change
// protection, saving and the onward navigation.
import { DEMO_CUSTOMER, DEMO_PREFILL } from '../core/constants.js';
import { crm } from '../core/crm.js';
import { getCurrentUser } from '../core/session.js';
import { ValidationError } from '../core/store.js';
import { hasErrors, validateCustomer } from '../core/validation.js';
import { BLANK_CUSTOMER, customerSections } from '../features/customers/customer-fields.js';
import { confirmDialog } from '../ui/confirm.js';
import { h } from '../ui/dom.js';
import { createForm } from '../ui/form.js';
import { icon } from '../ui/icons.js';
import { setFlash } from '../ui/toast.js';

const FALLBACK_BACK = '/dashboard';
const root = document.getElementById('screen');
const user = await getCurrentUser();

const initial = DEMO_PREFILL ? { ...BLANK_CUSTOMER, ...DEMO_CUSTOMER } : { ...BLANK_CUSTOMER };
const form = createForm(customerSections(initial, { ownerName: user.displayName }), {
  single: true,
  notice: DEMO_PREFILL ? 'Demo: forma je unaprijed popunjena testnim podacima.' : null,
});
const pristine = JSON.stringify(form.values());
const isDirty = () => JSON.stringify(form.values()) !== pristine;

let saving = false;
let leaving = false;

// ------------------------------------------------------------------ view
const back = h(
  'button',
  {
    type: 'button',
    class: 'rv-icon-btn rv-screen__back',
    'aria-label': 'Natrag',
    onClick: requestLeave,
  },
  icon('chevron-left'),
);
const title = h(
  'h1',
  { class: 'rv-screen__title', id: 'screen-title', tabindex: '-1' },
  'Novi kupac',
);
const formError = h('p', { class: 'rv-screen__error', role: 'alert', hidden: true });
const cancel = h(
  'button',
  { type: 'button', class: 'rv-btn rv-btn--secondary', onClick: requestLeave },
  'Otkaži',
);
const save = h('button', { type: 'submit', class: 'rv-btn rv-btn--primary' }, 'Spremi kupca');
const formEl = h(
  'form',
  { class: 'rv-screen__form', novalidate: true, 'aria-labelledby': 'screen-title' },
  form.element,
  formError,
  h('div', { class: 'rv-screen__actions' }, cancel, save),
);

root.replaceChildren(
  h(
    'header',
    { class: 'rv-screen__header' },
    h('div', { class: 'rv-screen__header-inner' }, back, title),
  ),
  h('main', { class: 'rv-screen__body' }, formEl),
);
title.focus({ preventScroll: true });

// ------------------------------------------------------------ navigation
/** Back to the previous Renvara screen; the dashboard when opened directly. */
function goBack() {
  leaving = true;
  let cameFromApp = false;
  try {
    const ref = new URL(document.referrer);
    cameFromApp =
      ref.origin === window.location.origin && ref.pathname !== window.location.pathname;
  } catch {
    cameFromApp = false;
  }
  if (cameFromApp && window.history.length > 1) window.history.back();
  else window.location.replace(FALLBACK_BACK);
}

async function requestLeave() {
  if (saving) return;
  if (!isDirty()) return goBack();
  const discard = await confirmDialog({
    title: 'Želite li odbaciti unesene podatke?',
    message: 'Uneseni podaci o kupcu neće biti spremljeni.',
    cancelLabel: 'Ostani',
    confirmLabel: 'Odbaci',
  });
  if (discard) goBack();
}

// Browser back / reload / closing the tab with unsaved data → the browser's own prompt.
window.addEventListener('beforeunload', (event) => {
  if (!leaving && isDirty()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ------------------------------------------------------------------ save
function setSaving(on) {
  saving = on;
  save.disabled = on;
  cancel.disabled = on;
  back.disabled = on;
  save.setAttribute('aria-busy', String(on));
  save.textContent = on ? 'Spremanje...' : 'Spremi kupca';
}

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving) return;
  formError.hidden = true;

  const values = form.values();
  const errors = validateCustomer(values, { existing: crm.listCustomers() });
  if (hasErrors(errors)) {
    form.setErrors(errors);
    return;
  }

  setSaving(true);
  try {
    // Demo latency so the saving state is visible; the store itself is synchronous.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const customer = crm.createCustomer(values, user);
    leaving = true;
    setFlash(`${customer.companyName} uspješno kreirana.`);
    // replace(): Back from the new profile returns to the previous screen, not to this form.
    window.location.replace(`/customers/${encodeURIComponent(customer.id)}`);
  } catch (error) {
    setSaving(false);
    if (error instanceof ValidationError) {
      form.setErrors(error.errors);
    } else {
      console.error(error);
      formError.textContent = 'Nije moguće spremiti kupca. Pokušajte ponovno.';
      formError.hidden = false;
      formError.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
});
