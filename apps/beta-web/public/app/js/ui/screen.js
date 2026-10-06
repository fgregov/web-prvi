// Dedicated mobile form screens (/customers/new, /tasks/new, /contacts/new,
// /opportunities/new): MobilePageHeader + one-column form + SaveActionBar,
// with unsaved-change protection. Each page supplies its form and its save().
import { confirmDialog } from './confirm.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { goBack } from './navigation.js';

/** Sticky header with a back button and the screen title. */
export function MobilePageHeader({ title, onBack }) {
  const back = h(
    'button',
    {
      type: 'button',
      class: 'rv-icon-btn rv-screen__back',
      'aria-label': 'Natrag',
      onClick: onBack,
    },
    icon('chevron-left'),
  );
  const heading = h('h1', { class: 'rv-screen__title', id: 'screen-title', tabindex: '-1' }, title);
  const element = h(
    'header',
    { class: 'rv-screen__header' },
    h('div', { class: 'rv-screen__header-inner' }, back, heading),
  );
  return { element, back, heading };
}

/** OTKAŽI + primary submit. setSaving() disables both and shows the loading label. */
export function SaveActionBar({ submitLabel, savingLabel = 'Spremanje...', onCancel }) {
  const cancel = h(
    'button',
    { type: 'button', class: 'rv-btn rv-btn--secondary', onClick: onCancel },
    'Otkaži',
  );
  const save = h('button', { type: 'submit', class: 'rv-btn rv-btn--primary' }, submitLabel);
  return {
    element: h('div', { class: 'rv-screen__actions' }, cancel, save),
    save,
    cancel,
    setSaving(on) {
      save.disabled = on;
      cancel.disabled = on;
      save.setAttribute('aria-busy', String(on));
      save.textContent = on ? savingLabel : submitLabel;
    },
  };
}

/** "Želite li odbaciti unesene podatke?" → true when the user chooses ODBACI. */
export function UnsavedChangesDialog({ message } = {}) {
  return confirmDialog({
    title: 'Želite li odbaciti unesene podatke?',
    message,
    cancelLabel: 'Ostani',
    confirmLabel: 'Odbaci',
  });
}

/**
 * @param {object} options
 * @param {HTMLElement} options.root
 * @param {string} options.title
 * @param {string} options.submitLabel
 * @param {string} options.fallback       where Back/Otkaži go when the screen was opened directly
 * @param {string} [options.discardMessage]
 * @param {(screen) => Promise<void>} options.onSubmit  validate + save + navigate; throw to stay
 */
export function createFormScreen({ root, title, submitLabel, fallback, discardMessage, onSubmit }) {
  let content = null;
  let pristine = null;
  let readValues = () => ({});
  let saving = false;
  let leaving = false;

  const header = MobilePageHeader({ title, onBack: requestLeave });
  const actions = SaveActionBar({ submitLabel, onCancel: requestLeave });
  const formError = h('p', { class: 'rv-screen__error', role: 'alert', hidden: true });
  const body = h('div', { class: 'rv-screen__content' });
  const formEl = h(
    'form',
    { class: 'rv-screen__form', novalidate: true, 'aria-labelledby': 'screen-title' },
    body,
    formError,
    actions.element,
  );
  root.replaceChildren(header.element, h('main', { class: 'rv-screen__body' }, formEl));
  header.heading.focus({ preventScroll: true });

  const isDirty = () => pristine !== null && JSON.stringify(readValues()) !== pristine;

  async function requestLeave() {
    if (saving) return;
    if (!isDirty()) {
      leaving = true;
      return goBack(fallback);
    }
    if (await UnsavedChangesDialog({ message: discardMessage })) {
      leaving = true;
      goBack(fallback);
    }
  }

  // Browser back / reload / closing the tab with unsaved data → the browser's own prompt.
  window.addEventListener('beforeunload', (event) => {
    if (!leaving && isDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  const screen = {
    header,
    actions,
    /** Puts the form (or a loading/error state) on the screen and records its pristine values. */
    setContent(node, values) {
      content = node;
      body.replaceChildren(node);
      if (values) {
        readValues = values;
        pristine = JSON.stringify(values());
      }
    },
    /** Re-baseline after programmatic changes (e.g. context preselection). */
    markPristine() {
      pristine = JSON.stringify(readValues());
    },
    showError(message) {
      formError.textContent = message;
      formError.hidden = false;
      formError.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    clearError() {
      formError.hidden = true;
    },
    setSaving(on) {
      saving = on;
      header.back.disabled = on;
      actions.setSaving(on);
    },
    /** Call right before navigating away after a successful save. */
    allowLeave() {
      leaving = true;
    },
    get content() {
      return content;
    },
  };

  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    screen.clearError();
    await onSubmit(screen);
  });

  return screen;
}
