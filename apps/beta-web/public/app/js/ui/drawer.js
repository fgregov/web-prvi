// Right-side drawer: modal dialog with focus trap, Esc/backdrop close and a sticky action footer.
import { h, uid } from './dom.js';
import { icon } from './icons.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.subtitle]
 * @param {Node} options.content
 * @param {string} options.submitLabel
 * @param {() => boolean | Promise<boolean>} options.onSubmit  return false to keep the drawer open
 */
export function openDrawer({
  title,
  subtitle,
  content,
  submitLabel,
  cancelLabel = 'Odustani',
  onSubmit,
}) {
  const previousFocus = document.activeElement;
  const titleId = uid('drawer-title');
  let closed = false;
  let busy = false;

  const submit = h('button', { type: 'submit', class: 'rv-btn rv-btn--primary' }, submitLabel);
  const form = h(
    'form',
    { class: 'rv-drawer__form', novalidate: true },
    h('div', { class: 'rv-drawer__body' }, content),
    h(
      'footer',
      { class: 'rv-drawer__footer' },
      h(
        'button',
        { type: 'button', class: 'rv-btn rv-btn--secondary', onClick: () => close() },
        cancelLabel,
      ),
      submit,
    ),
  );
  const panel = h(
    'aside',
    { class: 'rv-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h(
      'header',
      { class: 'rv-drawer__header' },
      h(
        'div',
        { class: 'rv-drawer__heading' },
        h('h2', { class: 'rv-drawer__title', id: titleId }, title),
        subtitle ? h('p', { class: 'rv-drawer__subtitle' }, subtitle) : null,
      ),
      h(
        'button',
        { type: 'button', class: 'rv-icon-btn', 'aria-label': 'Zatvori', onClick: () => close() },
        icon('x'),
      ),
    ),
    form,
  );
  const root = h(
    'div',
    { class: 'rv-drawer-root' },
    h('div', { class: 'rv-drawer-backdrop', onClick: () => close() }),
    panel,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    submit.disabled = true;
    try {
      if ((await onSubmit()) !== false) close();
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    root.classList.remove('is-open');
    document.removeEventListener('keydown', onKeydown, true);
    document.documentElement.classList.remove('rv-scroll-lock');
    const remove = () => root.remove();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) remove();
    else setTimeout(remove, 240);
    if (previousFocus instanceof HTMLElement && document.contains(previousFocus))
      previousFocus.focus();
  }

  document.body.append(root);
  document.documentElement.classList.add('rv-scroll-lock');
  document.addEventListener('keydown', onKeydown, true);
  requestAnimationFrame(() => {
    root.classList.add('is-open');
    const firstField = panel.querySelector(
      '.rv-drawer__body input:not([readonly]), .rv-drawer__body select, .rv-drawer__body textarea',
    );
    (firstField ?? panel.querySelector(FOCUSABLE))?.focus({ preventScroll: true });
  });

  return { close, panel };
}
