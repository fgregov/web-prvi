// Renvara BETA · Prijava. Sends the form to the server; holds no credentials.
(() => {
  'use strict';

  const MESSAGES = {
    invalid: 'Neispravan e-mail (korisničko ime) ili lozinka.',
    missing: 'Unesite e-mail (ili korisničko ime) i lozinku.',
    network: 'Nije moguće povezati se sa serverom. Pokušajte ponovno.',
    server: 'Došlo je do pogreške. Pokušajte ponovno.',
    expired: 'Vaša sesija je istekla. Prijavite se ponovno.',
    unavailable: 'Ova opcija još nije dostupna u BETA verziji.',
    forgot:
      'Novu lozinku zatražite od administratora organizacije: on vam šalje poveznicu za postavljanje lozinke.',
    passwordSet: 'Lozinka je postavljena. Prijavite se e-mailom i novom lozinkom.',
  };
  const FLASH_KEY = 'renvara.flash'; // shown by the first page after sign-in (ui/toast.js)

  const form = document.getElementById('login-form');
  const username = document.getElementById('login-username');
  const password = document.getElementById('login-password');
  const submit = document.getElementById('login-submit');
  const message = document.getElementById('login-message');
  const toggle = document.getElementById('password-toggle');
  let pending = false;

  function showMessage(text, kind = 'error') {
    message.textContent = text;
    message.dataset.kind = kind;
    message.hidden = false;
  }

  function clearMessage() {
    message.hidden = true;
    message.textContent = '';
    username.removeAttribute('aria-invalid');
    password.removeAttribute('aria-invalid');
  }

  function setLoading(loading) {
    pending = loading;
    submit.disabled = loading;
    submit.setAttribute('aria-busy', String(loading));
    submit.textContent = loading ? 'Prijava...' : 'Prijava';
  }

  // Session expired → shown once, then the reason is removed from the address bar.
  const params = new URLSearchParams(window.location.search);
  const reason = params.get('reason');
  if (reason === 'expired' || reason === 'password-set') {
    showMessage(reason === 'expired' ? MESSAGES.expired : MESSAGES.passwordSet, 'info');
    window.history.replaceState(null, '', window.location.pathname);
  }

  toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Sakrij lozinku' : 'Prikaži lozinku');
  });

  document.querySelectorAll('[data-unavailable]').forEach((button) => {
    button.addEventListener('click', () => showMessage(MESSAGES.unavailable, 'info'));
  });
  document.querySelectorAll('[data-forgot]').forEach((button) => {
    button.addEventListener('click', () => showMessage(MESSAGES.forgot, 'info'));
  });

  /** An administrator changed this member's password since the last sign-in. */
  function rememberNotice(notice) {
    if (!notice || typeof notice.passwordChangedAt !== 'string') return;
    const at = new Date(notice.passwordChangedAt);
    if (Number.isNaN(at.getTime())) return;
    const when = new Intl.DateTimeFormat('hr-HR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(at);
    try {
      sessionStorage.setItem(
        FLASH_KEY,
        `Administrator je promijenio vašu lozinku (${when}). Ako to niste očekivali, javite se administratoru.`,
      );
    } catch {
      /* private mode: no notice */
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    clearMessage();

    const user = username.value.trim();
    const pass = password.value; // never trimmed

    if (!user || !pass) {
      showMessage(MESSAGES.missing);
      if (!user) username.setAttribute('aria-invalid', 'true');
      if (!pass) password.setAttribute('aria-invalid', 'true');
      (user ? password : username).focus();
      return;
    }

    setLoading(true);
    let response;
    try {
      response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
    } catch {
      setLoading(false);
      showMessage(MESSAGES.network);
      return;
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (response.ok && data && data.success === true) {
      rememberNotice(data.notice);
      const target =
        typeof data.redirectTo === 'string' &&
        data.redirectTo.startsWith('/') &&
        !data.redirectTo.startsWith('//')
          ? data.redirectTo
          : '/dashboard';
      // Keep the loading state: the page is navigating away.
      window.location.replace(target);
      return;
    }

    setLoading(false);
    if (response.status === 401) {
      password.value = '';
      username.setAttribute('aria-invalid', 'true');
      password.setAttribute('aria-invalid', 'true');
      showMessage(MESSAGES.invalid);
      password.focus();
    } else if (response.status === 400 || response.status === 429) {
      showMessage((data && data.message) || MESSAGES.server);
    } else {
      showMessage(MESSAGES.server);
    }
  });
})();
