// Renvara · Home (dashboard) — page interactions only.
(() => {
  'use strict';

  // ------------------------------------------------------------ toast ---
  const toast = document.querySelector('.toast');
  let toastTimer;

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 1800);
  }

  // Quick Add, "Sales Kalendar", "Prioritetni zadaci", the pipeline and "Feedback overview"
  // are rendered from live data by
  // /app/js/pages/dashboard.js (served by apps/beta-web).

  // ------------------------------------------- placeholder destinations ---
  const placeholders = [
    ['.module__link[href^="#"]', (el) => el.textContent.trim()],
    ['.waiting', (el) => el.querySelector('.waiting__name').textContent],
  ];

  placeholders.forEach(([selector, label]) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        showToast(`${label(el)} · uskoro`);
      });
    });
  });

  // Navigation, profile, Odjava and the signed-out check on Back: the sidebar
  // (/app/js/ui/app-shell.js, mounted by /app/js/pages/dashboard.js).
})();
