// The browser's single CRM store instance, persisted in localStorage.
import { STORAGE_KEY } from './constants.js';
import { createCrmStore } from './store.js';

function safeLocalStorage() {
  try {
    const probe = '__renvara_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null; // private mode / blocked: data lives in memory for this page only
  }
}

export const crm = createCrmStore({ storage: safeLocalStorage() });

// Keep tabs in sync.
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) crm.reload();
});
