/**
 * Skripte koje se izvršavaju unutar stranice portala. Pisane su kao čisti JavaScript tekst
 * (ne TypeScript funkcije) kako ih prevoditelj ne bi izmijenio prije slanja u preglednik.
 * Skripte samo čitaju DOM i označavaju pronađene elemente atributom data-vs-role;
 * same radnje (unos, klik) izvodi Playwright stvarnim korisničkim događajima.
 */

const HELPERS = String.raw`
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled;
  };
  const textish = (i) => ['text', 'email', 'tel', ''].includes((i.getAttribute('type') || '').toLowerCase());
  const attrs = (i) => [i.name, i.id, i.getAttribute('placeholder'), i.getAttribute('aria-label'), i.getAttribute('autocomplete')].filter(Boolean).join(' ');
  const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ');
`;

/** Analiza stranice za prijavu: lozinka, korisničko ime, gumb za prijavu, CAPTCHA, MFA, poruka o grešci. */
export const ANALYZE_LOGIN_SCRIPT = String.raw`(() => {
  ${HELPERS}
  document.querySelectorAll('[data-vs-role]').forEach((e) => e.removeAttribute('data-vs-role'));
  const inputs = [...document.querySelectorAll('input')];
  const pw = inputs.filter((i) => (i.getAttribute('type') || '').toLowerCase() === 'password' && visible(i));
  const bodyText = ((document.body && document.body.innerText) || '').slice(0, 30000);
  const res = {
    url: location.href,
    title: document.title,
    passwordVisible: pw.length > 0,
    usernameFound: false,
    usernamePrefilled: false,
    submitFound: false,
    usernameOnlyStep: false,
    captcha: false,
    mfa: false,
    logoutFound: false,
    errorText: null,
  };
  res.captcha = !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="captcha"], .g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]');
  const otp = inputs.filter(visible).find((i) => i.autocomplete === 'one-time-code' || /(^|[^a-z])(otp|totp|2fa|mfa|one.?time|verification.?code|auth.?code)([^a-z]|$)/i.test(attrs(i)));
  const mfaText = /two-factor|two-step|2-step|dvofaktor|dvostruk[ae] (provjer|autentifik)|verifikacijsk[ia] kod|jednokratn[ia] (kod|lozink)|authenticator app|enter the code|unesite kod/i.test(bodyText);
  res.mfa = pw.length === 0 && (!!otp || mfaText);
  const submitRe = /prijav|log ?in|sign ?in|uloguj|submit|potvrdi|nastavi|dalje|continue|next|enter/i;
  const findSubmit = (scope) => {
    const typed = [...scope.querySelectorAll('button[type=submit], input[type=submit]')].filter(visible)[0];
    if (typed) return typed;
    return [...scope.querySelectorAll('button, [role=button], input[type=button], a')].filter(visible).find((b) => submitRe.test(label(b)));
  };
  if (pw.length) {
    const p = pw[0];
    p.setAttribute('data-vs-role', 'password');
    const scope = p.form || p.closest('form') || document;
    const cands = [...scope.querySelectorAll('input')].filter((i) => textish(i) && visible(i));
    const before = cands.filter((i) => i.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING);
    const u = cands.find((i) => ['username', 'email'].includes((i.autocomplete || '').toLowerCase()))
      || cands.find((i) => /user|e-?mail|login|korisn|ime|account|racun|račun/i.test(attrs(i)))
      || before[before.length - 1] || cands[0];
    if (u) {
      u.setAttribute('data-vs-role', 'username');
      res.usernameFound = true;
      res.usernamePrefilled = !!u.value;
    }
    const s = findSubmit(scope) || findSubmit(document);
    if (s) {
      s.setAttribute('data-vs-role', 'submit');
      res.submitFound = true;
    }
  } else if (!res.mfa) {
    // Prijava u dva koraka (najprije korisničko ime, zatim lozinka)
    const forms = [...document.querySelectorAll('form')].filter(visible);
    for (const f of forms) {
      const t = [...f.querySelectorAll('input')].filter((i) => textish(i) && visible(i));
      if (t.length === 1 && /user|e-?mail|login|korisn|account|identifier/i.test(attrs(t[0]) + ' ' + (f.getAttribute('action') || ''))) {
        t[0].setAttribute('data-vs-role', 'username');
        const s = findSubmit(f);
        if (s) s.setAttribute('data-vs-role', 'submit');
        res.usernameOnlyStep = true;
        res.usernameFound = true;
        res.submitFound = !!s;
        break;
      }
    }
  }
  res.logoutFound = [...document.querySelectorAll('a, button, [role=button], [role=menuitem]')].some((e) =>
    /odjav|log ?out|sign ?out/i.test(label(e)) || /logout|signout|sign-out|log-out|odjava/i.test(e.getAttribute('href') || ''));
  const errEl = [...document.querySelectorAll('[role=alert], .alert, .error, .errors, .invalid-feedback, .validation-summary-errors, .field-validation-error, .text-danger, .notification, .toast')]
    .filter(visible).map((e) => (e.innerText || '').trim()).filter(Boolean)[0];
  const m = bodyText.match(/[^\n]*(pogrešn|neispravn|invalid|incorrect|wrong password|nije ispravn|login failed|neuspješn|zaključan|locked)[^\n]*/i);
  res.errorText = errEl ? errEl.slice(0, 300) : (m ? m[0].trim().slice(0, 300) : null);
  return res;
})()`;

export interface LoginAnalysis {
  url: string;
  title: string;
  passwordVisible: boolean;
  usernameFound: boolean;
  usernamePrefilled: boolean;
  submitFound: boolean;
  usernameOnlyStep: boolean;
  captcha: boolean;
  mfa: boolean;
  logoutFound: boolean;
  errorText: string | null;
}

/** Analiza stranice za istraživanje portala: navigacija, tablice, izvozi, polja za datum. */
export const ANALYZE_PAGE_SCRIPT = String.raw`(() => {
  ${HELPERS}
  const exportRe = /export|izvoz|izvezi|preuzmi|download|csv|xlsx|xls|excel/i;
  const dangerRe = /odjav|log ?out|sign ?out|obri[sš]|delete|ukloni|remove|reset|deaktiv|disable|ugasi|restart|reboot|promijeni cijen|update price|save|spremi/i;
  const links = [...document.querySelectorAll('a[href]')].filter(visible).map((a) => ({
    text: label(a).slice(0, 120),
    href: a.href,
    inNav: !!a.closest('nav, header, aside, [role=navigation], .menu, .navbar, .sidebar, .nav'),
    dangerous: dangerRe.test(label(a)) || /logout|signout|delete|remove/i.test(a.getAttribute('href') || ''),
  })).filter((l) => l.href && !l.href.startsWith('javascript:') && !l.href.startsWith('mailto:'));
  const tables = [...document.querySelectorAll('table')].filter(visible).map((t, idx) => {
    const headRow = t.querySelector('thead tr') || t.querySelector('tr');
    const headers = headRow ? [...headRow.children].map((c) => (c.innerText || '').trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 40) : [];
    const rows = t.querySelectorAll('tbody tr').length || Math.max(0, t.querySelectorAll('tr').length - 1);
    const selector = t.id ? 'table#' + CSS.escape(t.id) : 'table >> nth=' + idx;
    return { selector, headers, rowCount: rows };
  });
  const gridHeaders = [...document.querySelectorAll('[role=grid], [role=table]')].filter(visible).slice(0, 5).map((g, idx) => ({
    selector: '[role=' + g.getAttribute('role') + '] >> nth=' + idx,
    headers: [...g.querySelectorAll('[role=columnheader]')].map((c) => (c.innerText || '').trim()).filter(Boolean).slice(0, 40),
  }));
  const exportsFound = [...document.querySelectorAll('a, button, [role=button], input[type=button], input[type=submit]')].filter(visible)
    .map((e) => ({ text: label(e).slice(0, 120), tag: e.tagName.toLowerCase(), href: e.getAttribute('href') || null }))
    .filter((e) => exportRe.test(e.text) || (e.href && /\.(csv|xlsx?|zip)(\?|$)|export|download/i.test(e.href)));
  const dateInputs = [...document.querySelectorAll('input')].filter(visible)
    .filter((i) => ['date', 'datetime-local'].includes(i.type) || /date|datum|from|to|od|do|period|razdoblje/i.test(attrs(i)))
    .map((i) => ({ selector: i.id ? '#' + CSS.escape(i.id) : (i.name ? 'input[name="' + i.name.replace(/"/g, '') + '"]' : null), type: i.type, name: i.name || null, placeholder: i.getAttribute('placeholder') }))
    .filter((d) => d.selector);
  const h1 = document.querySelector('h1, h2');
  return {
    url: location.href,
    title: document.title,
    heading: h1 ? (h1.innerText || '').trim().slice(0, 200) : null,
    links,
    tables,
    grids: gridHeaders,
    exports: exportsFound.slice(0, 30),
    dateInputs: dateInputs.slice(0, 20),
    formCount: document.querySelectorAll('form').length,
  };
})()`;

export interface PageAnalysis {
  url: string;
  title: string;
  heading: string | null;
  links: { text: string; href: string; inNav: boolean; dangerous: boolean }[];
  tables: { selector: string; headers: string[]; rowCount: number }[];
  grids: { selector: string; headers: string[] }[];
  exports: { text: string; tag: string; href: string | null }[];
  dateInputs: { selector: string; type: string; name: string | null; placeholder: string | null }[];
  formCount: number;
}
