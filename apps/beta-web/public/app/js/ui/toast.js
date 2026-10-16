// Toasts reuse the dashboard's own .toast element when present, so they look identical everywhere.
import { h } from './dom.js';

const FLASH_KEY = 'renvara.flash';
let timer;

export function showToast(message) {
  let el = document.querySelector('.toast') ?? document.querySelector('.rv-toast');
  if (!el) {
    el = h('div', { class: 'rv-toast', role: 'status', 'aria-live': 'polite', hidden: true });
    document.body.append(el);
  }
  el.textContent = message;
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

/** Show a toast on the next page (survives a redirect, e.g. after "Kreiraj kupca"). */
export function setFlash(message) {
  try {
    sessionStorage.setItem(FLASH_KEY, message);
  } catch {
    /* ignore */
  }
}

export function consumeFlash() {
  try {
    const message = sessionStorage.getItem(FLASH_KEY);
    if (message) {
      sessionStorage.removeItem(FLASH_KEY);
      showToast(message);
    }
  } catch {
    /* ignore */
  }
}
