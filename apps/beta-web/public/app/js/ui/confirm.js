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
