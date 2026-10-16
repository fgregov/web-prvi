// A password link the administrator passes on (BETA server without e-mail):
// shown once, copied to the clipboard on request, never stored by the page.
import { h, uid } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';

const expiry = (iso) =>
  new Intl.DateTimeFormat('hr-HR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));

/**
 * @param {{ title: string, intro: string, link: { url: string, expiresAt: string }, doneLabel: string }} options
 * @returns {Promise<void>} when closed
 */
export function linkDialog({ title, intro, link, doneLabel }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const titleId = uid('link-title');
    const field = h('input', {
      class: 'rv-input rv-link-dialog__url',
      type: 'text',
      readonly: true,
      value: link.url,
      'aria-label': 'Poveznica za postavljanje lozinke',
      onFocus: (event) => event.target.select(),
    });
    const status = h('p', {
      class: 'rv-link-dialog__status',
      role: 'status',
      'aria-live': 'polite',
    });
    const copy = h(
      'button',
      {
        type: 'button',
        class: 'rv-btn rv-btn--secondary',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(link.url);
            status.textContent = 'Poveznica je kopirana.';
          } catch {
            field.focus();
            field.select();
            status.textContent = 'Kopirajte označenu poveznicu (Ctrl+C / ⌘C).';
          }
        },
      },
      icon('copy'),
      'Kopiraj poveznicu',
    );
    const done = h(
      'button',
      { type: 'button', class: 'rv-btn rv-btn--primary', onClick: close },
      doneLabel,
    );
    const sheet = h(
      'div',
      {
        class: 'rv-confirm rv-link-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      h('h2', { class: 'rv-confirm__title', id: titleId }, title),
      h('p', { class: 'rv-confirm__message' }, intro),
      field,
      h(
        'p',
        { class: 'rv-field__hint' },
        `Jednokratna poveznica, vrijedi do ${expiry(link.expiresAt)}. Pošaljite je samo tom korisniku.`,
      ),
      status,
      h('div', { class: 'rv-confirm__actions' }, copy, done),
    );
    const root = h(
      'div',
      { class: 'rv-confirm-root' },
      h('div', { class: 'rv-confirm-backdrop' }),
      sheet,
    );

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        const focusable = [field, copy, done];
        const index = focusable.indexOf(document.activeElement);
        event.preventDefault();
        focusable[
          (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length
        ].focus();
      }
    }
    function close() {
      document.removeEventListener('keydown', onKeydown, true);
      root.remove();
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus))
        previousFocus.focus();
      resolve();
    }
    document.addEventListener('keydown', onKeydown, true);
    document.body.append(root);
    copy.focus();
  });
}
