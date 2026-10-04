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
    ['.module__link', (el) => el.textContent.trim()],
    ['.event', (el) => el.querySelector('.event__title').textContent],
    ['.stage', (el) => el.querySelector('.stage__label').textContent],
    ['.waiting', (el) => el.querySelector('.waiting__name').textContent],
    ['.bell', () => 'Obavijesti'],
    ['.avatar', () => 'Profil'],
  ];

  placeholders.forEach(([selector, label]) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        showToast(`${label(el)} · uskoro`);
      });
    });
  });
})();
