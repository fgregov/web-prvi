// Bottom sheet: slides up from the bottom, closes on backdrop tap, Escape or a
// downward swipe on the sheet. Used by Quick Add and the pickers.
import { h, uid } from './dom.js';

const SWIPE_CLOSE_PX = 80;

/**
 * @param {{ title: string, content: Node, className?: string, onClose?: () => void, initialFocus?: HTMLElement }} options
 */
export function openSheet({ title, content, className = '', onClose, initialFocus }) {
  const previousFocus = document.activeElement;
  const titleId = uid('sheet-title');
  let closed = false;

  const handle = h('div', { class: 'rv-sheet__handle', 'aria-hidden': 'true' });
  const panel = h(
    'div',
    {
      class: `rv-sheet ${className}`.trim(),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
    },
    handle,
    h('h2', { class: 'rv-sheet__title', id: titleId }, title),
    content,
  );
  const backdrop = h('div', { class: 'rv-sheet-backdrop', onClick: () => close() });
  const root = h('div', { class: 'rv-sheet-root' }, backdrop, panel);

  // Swipe down to dismiss (from the handle/title area, or anywhere when the content is not scrolled).
  let startY = null;
  let dy = 0;
  let dragged = false;
  panel.addEventListener('pointerdown', (event) => {
    const scroller = event.target.closest('.rv-sheet__scroll');
    if (scroller && scroller.scrollTop > 0) return;
    if (event.target.closest('input, textarea, select')) return;
    startY = event.clientY;
    dy = 0;
    dragged = false;
  });
  panel.addEventListener('pointermove', (event) => {
    if (startY === null) return;
    dy = Math.max(0, event.clientY - startY);
    if (dy > 8) {
      dragged = true;
      panel.classList.add('is-dragging');
      panel.style.transform = `translateY(${dy}px)`;
    }
  });
  const endSwipe = () => {
    if (startY === null) return;
    startY = null;
    panel.classList.remove('is-dragging');
    panel.style.transform = '';
    if (dy > SWIPE_CLOSE_PX) close();
  };
  // A drag that started on an option must not also select it.
  panel.addEventListener(
    'click',
    (event) => {
      if (!dragged) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  panel.addEventListener('pointerup', endSwipe);
  panel.addEventListener('pointercancel', endSwipe);

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  function close({ restoreFocus = true } = {}) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    document.documentElement.classList.remove('rv-scroll-lock');
    root.classList.remove('is-open');
    const remove = () => root.remove();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) remove();
    else setTimeout(remove, 220);
    if (restoreFocus && previousFocus instanceof HTMLElement && document.contains(previousFocus))
      previousFocus.focus({ preventScroll: true });
    onClose?.();
  }

  document.body.append(root);
  document.documentElement.classList.add('rv-scroll-lock');
  document.addEventListener('keydown', onKeydown, true);
  requestAnimationFrame(() => {
    root.classList.add('is-open');
    (initialFocus ?? panel.querySelector('a, button, input'))?.focus({ preventScroll: true });
  });
  return { close, panel };
}
