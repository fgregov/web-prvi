// Lightweight confirmation: bottom sheet on phones, centred card on wider screens. Resolves true/false.
import { h, uid } from './dom.js';

export function confirmDialog({ title, message, confirmLabel, cancelLabel }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const titleId = uid('confirm-title');
    const messageId = uid('confirm-msg');

    const cancel = h(
      'button',
      { type: 'button', class: 'rv-btn rv-btn--secondary', onClick: () => done(false) },
      cancelLabel,
    );
    const confirm = h(
      'button',
      { type: 'button', class: 'rv-btn rv-btn--primary', onClick: () => done(true) },
      confirmLabel,
    );
    const sheet = h(
      'div',
      {
        class: 'rv-confirm',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        'aria-describedby': message ? messageId : null,
      },
      h('h2', { class: 'rv-confirm__title', id: titleId }, title),
      message ? h('p', { class: 'rv-confirm__message', id: messageId }, message) : null,
      h('div', { class: 'rv-confirm__actions' }, cancel, confirm),
    );
    const root = h(
      'div',
      { class: 'rv-confirm-root' },
      h('div', { class: 'rv-confirm-backdrop', onClick: () => done(false) }),
      sheet,
    );

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        done(false);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === cancel ? confirm : cancel).focus();
      }
    }

    function done(result) {
      document.removeEventListener('keydown', onKeydown, true);
      root.remove();
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus))
        previousFocus.focus();
      resolve(result);
    }

    document.addEventListener('keydown', onKeydown, true);
    document.body.append(root);
    cancel.focus(); // the safe choice is the default
  });
}

/**
 * Several choices in the same sheet (e.g. PRILIKA JE OSVOJENA! → KREIRAJ KUPCA /
 * POVEŽI S POSTOJEĆIM KUPCEM / KASNIJE). Resolves the chosen `value`, or the
 * `dismissValue` when closed with Escape or the backdrop.
 * @param {{ title: string, message?: string, choices: Array<{ value: string, label: string, variant?: string }>, dismissValue: string }} options
 */
export function choiceDialog({ title, message, choices, dismissValue }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const titleId = uid('choice-title');
    const messageId = uid('choice-msg');
    const buttons = choices.map((choice) =>
      h(
        'button',
        {
          type: 'button',
          class: `rv-btn rv-btn--${choice.variant ?? 'secondary'}`,
          dataset: { choice: choice.value },
          onClick: () => done(choice.value),
        },
        choice.label,
      ),
    );
    const sheet = h(
      'div',
      {
        class: 'rv-confirm rv-confirm--choices',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        'aria-describedby': message ? messageId : null,
      },
      h('h2', { class: 'rv-confirm__title', id: titleId }, title),
      message ? h('p', { class: 'rv-confirm__message', id: messageId }, message) : null,
      h('div', { class: 'rv-confirm__actions rv-confirm__actions--stack' }, buttons),
    );
    const root = h(
      'div',
      { class: 'rv-confirm-root' },
      h('div', { class: 'rv-confirm-backdrop', onClick: () => done(dismissValue) }),
      sheet,
    );

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        done(dismissValue);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement);
        const step = event.shiftKey ? -1 : 1;
        buttons[(index + step + buttons.length) % buttons.length].focus();
      }
    }

    function done(result) {
      document.removeEventListener('keydown', onKeydown, true);
      root.remove();
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus))
        previousFocus.focus();
      resolve(result);
    }

    document.addEventListener('keydown', onKeydown, true);
    document.body.append(root);
    buttons[0]?.focus();
  });
}
