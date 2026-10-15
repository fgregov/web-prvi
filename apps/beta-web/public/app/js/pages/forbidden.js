// 403 · a page the signed-in member has no right to (the server answered 403
// and sent this page instead of the one asked for).
import { startPage } from '../core/routes.js';
import { getAccess } from '../core/session.js';
import { mountAppShell } from '../ui/app-shell.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

mountAppShell();
const home = h(
  'a',
  { class: 'rv-btn rv-btn--primary', href: '/dashboard' },
  icon('arrow-left'),
  'Povratak na početnu',
);
document
  .getElementById('app')
  .replaceChildren(
    h(
      'div',
      { class: 'rv-card rv-empty rv-empty--page rv-forbidden', role: 'alert' },
      h('span', { class: 'rv-section__icon' }, icon('lock')),
      h('h1', {}, '403 — Nemate pravo pristupa ovoj funkcionalnosti.'),
      h(
        'p',
        {},
        'Ako vam je ovaj dio aplikacije potreban za posao, zatražite pravo od administratora organizacije.',
      ),
      home,
    ),
  );

// "Početna" is the first page this member may open (the Dashboard when allowed).
getAccess()
  .then(({ permissions }) => {
    const start = startPage(permissions);
    if (start) home.href = start;
    else home.hidden = true;
  })
  .catch(() => {});
