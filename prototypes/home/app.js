// Renvara · Mobile home / dashboard — demo interactions only.
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

  // Quick Add, "Danas" and "Prioriteti" are rendered from live data by
  // /app/js/pages/dashboard.js (served by apps/beta-web).

  // -------------------------------------------------- bottom navigation ---
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      tabs.forEach((t) => {
        t.classList.toggle('is-active', t === tab);
        if (t === tab) t.setAttribute('aria-current', 'page');
        else t.removeAttribute('aria-current');
      });
      const home = tab.querySelector('use')?.getAttribute('href') === '#i-home';
      document
        .querySelector('.tab .icon use[href="#i-home"]')
        .parentElement.classList.toggle('icon--filled', home);
    });
  });

  // ------------------------------------------- placeholder destinations ---
  const placeholders = [
    ['.metric', (el) => el.querySelector('.metric__label').textContent],
    ['.module__link[href^="#"]', (el) => el.textContent.trim()],
    ['.waiting', (el) => el.querySelector('.waiting__name').textContent],
    ['.bell', () => 'Obavijesti'],
  ];

  placeholders.forEach(([selector, label]) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        showToast(`${label(el)} · uskoro`);
      });
    });
  });

  // ------------------------------------------------ account & session ---
  // Served by the BETA web server (apps/beta-web), which protects this page.
  const avatar = document.querySelector('.avatar');
  const accountMenu = document.getElementById('account-menu');
  const accountName = accountMenu.querySelector('[data-account-name]');
  const logoutButton = accountMenu.querySelector('[data-logout]');

  function setAccountMenu(open) {
    accountMenu.hidden = !open;
    avatar.setAttribute('aria-expanded', String(open));
    if (open) logoutButton.focus();
  }

  avatar.addEventListener('click', () => setAccountMenu(accountMenu.hidden));

  document.addEventListener('click', (event) => {
    if (!accountMenu.hidden && !event.target.closest('.account')) setAccountMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !accountMenu.hidden) {
      setAccountMenu(false);
      avatar.focus();
    }
  });

  async function fetchSession() {
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    return response.ok ? response.json() : { authenticated: false };
  }

  fetchSession()
    .then((session) => {
      if (session.authenticated) {
        accountName.textContent = session.user.displayName;
        avatar.setAttribute('aria-label', `Moj profil: ${session.user.displayName}`);
      }
    })
    .catch(() => {});

  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      window.location.replace('/login');
    } catch {
      logoutButton.disabled = false;
      setAccountMenu(false);
      showToast('Nije moguće povezati se sa serverom. Pokušajte ponovno.');
    }
  });

  // Back/forward cache: re-check the session before showing a restored page.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    fetchSession()
      .then((session) => {
        if (!session.authenticated) window.location.replace('/login');
      })
      .catch(() => window.location.replace('/login'));
  });
})();
