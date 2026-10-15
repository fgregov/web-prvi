// Renvara · Postavljanje lozinke (invitation and reset links). The link's
// token is in the address fragment (#token=… from this server, or
// #access_token=… from Supabase Auth): it never reaches a server log. It is
// read once, removed from the address bar, and sent only with the new password.
(() => {
  'use strict';

  const MESSAGES = {
    missingToken: 'Poveznica nije potpuna. Otvorite je ponovno iz poruke ili zatražite novu.',
    invalidLink: 'Poveznica nije valjana ili je istekla. Zatražite novu od administratora.',
    required: 'Ovo polje je obavezno.',
    mismatch: 'Lozinke se ne podudaraju.',
    network: 'Nije moguće povezati se sa serverom. Pokušajte ponovno.',
    server: 'Došlo je do pogreške. Pokušajte ponovno.',
  };

  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get('token') || fragment.get('access_token') || '';
  const providerError = fragment.get('error_code') || fragment.get('error');
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);

  const form = document.getElementById('setpw-form');
  const password = document.getElementById('setpw-password');
  const confirm = document.getElementById('setpw-confirm');
  const submit = document.getElementById('setpw-submit');
  const message = document.getElementById('setpw-message');
  const fields = { password, confirm };
  let pending = false;

  function showMessage(text, kind = 'error') {
    message.textContent = text;
    message.dataset.kind = kind;
    message.hidden = false;
  }

  function setFieldError(name, text) {
    const input = fields[name];
    const error = document.getElementById(`${input.id}-error`);
    if (text) {
      input.setAttribute('aria-invalid', 'true');
      error.textContent = text;
      error.hidden = false;
    } else {
      input.removeAttribute('aria-invalid');
      error.textContent = '';
      error.hidden = true;
    }
  }

  function clear() {
    message.hidden = true;
    setFieldError('password', '');
    setFieldError('confirm', '');
  }

  if (!token) {
    showMessage(providerError ? MESSAGES.invalidLink : MESSAGES.missingToken);
    submit.disabled = true;
    password.disabled = true;
    confirm.disabled = true;
  }

  document.querySelectorAll('[data-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const input = document.getElementById(toggle.dataset.toggle);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', show ? 'Sakrij lozinku' : 'Prikaži lozinku');
    });
  });

  function setLoading(loading) {
    pending = loading;
    submit.disabled = loading;
    submit.setAttribute('aria-busy', String(loading));
    submit.textContent = loading ? 'Spremanje...' : 'Spremi lozinku';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || !token) return;
    clear();
    const value = password.value; // never trimmed
    const repeat = confirm.value;
    if (!value || !repeat) {
      if (!value) setFieldError('password', MESSAGES.required);
      if (!repeat) setFieldError('confirm', MESSAGES.required);
      (value ? confirm : password).focus();
      return;
    }
    if (value !== repeat) {
      setFieldError('confirm', MESSAGES.mismatch);
      confirm.focus();
      return;
    }

    setLoading(true);
    let response;
    try {
      response = await fetch('/api/auth/set-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token, password: value, confirm: repeat }),
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
      password.value = '';
      confirm.value = '';
      const target =
        typeof data.redirectTo === 'string' &&
        data.redirectTo.startsWith('/') &&
        !data.redirectTo.startsWith('//')
          ? data.redirectTo
          : '/login';
      window.location.replace(target);
      return;
    }

    setLoading(false);
    if (response.status === 422 && data && data.errors) {
      for (const name of Object.keys(fields)) setFieldError(name, data.errors[name] || '');
      (data.errors.password ? password : confirm).focus();
      if (!data.errors.password && !data.errors.confirm)
        showMessage(data.message || MESSAGES.server);
    } else if (response.status === 409) {
      showMessage((data && data.message) || MESSAGES.invalidLink);
    } else if (response.status === 429 || response.status === 400) {
      showMessage((data && data.message) || MESSAGES.server);
    } else {
      showMessage(MESSAGES.server);
    }
  });
})();
