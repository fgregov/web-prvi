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

  // ------------------------------------------------- priority checkboxes ---
  document.querySelectorAll('[data-task]').forEach((button) => {
    const row = button.closest('.task');
    const pill = row.querySelector('[data-pill]');
    const title = row.querySelector('.task__title').textContent.trim();

    const render = () => {
      const done = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute(
        'aria-label',
        `${done ? 'Označi kao otvoreno' : 'Označi kao završeno'}: ${title}`,
      );
      pill.textContent = done ? 'Završeno' : 'Danas';
      pill.classList.toggle('pill--green', done);
      pill.classList.toggle('pill--red', !done);
    };

    button.addEventListener('click', () => {
      const done = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute('aria-pressed', String(!done));
      render();
    });

    render();
  });

  // ------------------------------------------------------- quick add ---
  const fab = document.querySelector('.fab');
  const menu = document.getElementById('quick-add-menu');
  const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));

  function setMenu(open, { focusFirst = false } = {}) {
    menu.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
    if (open && focusFirst) items[0].focus();
  }

  fab.addEventListener('click', () => {
    setMenu(menu.hidden, { focusFirst: false });
  });

  items.forEach((item, index) => {
    item.addEventListener('click', () => {
      setMenu(false);
      fab.focus();
      if (item.dataset.action) {
        // Handled by the CRM module (/app/js/pages/dashboard.js).
        document.dispatchEvent(
          new CustomEvent('renvara:quick-create', { detail: { action: item.dataset.action } }),
        );
        return;
      }
      showToast(`${item.dataset.label} · uskoro`);
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + step + items.length) % items.length].focus();
      }
    });
  });

  document.addEventListener('click', (event) => {
    if (!menu.hidden && !event.target.closest('.quick-add')) setMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      setMenu(false);
      fab.focus();
    }
  });

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
    ['.event', (el) => el.querySelector('.event__title').textContent],
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
