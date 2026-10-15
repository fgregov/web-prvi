// /reports, /users · modules in production: a status page each. No data and
// no numbers until the module is built (nothing here is simulated).
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { mountAppShell } from '../ui/app-shell.js';

const MODULES = {
  '/reports': { title: 'Izvještaji', icon: 'chart-column' },
  '/users': { title: 'Korisnici', icon: 'users' },
};

mountAppShell();
const module = MODULES[window.location.pathname] ?? MODULES['/reports'];
document.title = `Renvara · ${module.title}`;
document.getElementById('module-title').textContent = module.title;

document
  .getElementById('module')
  .replaceChildren(
    h(
      'section',
      { class: 'card module module-status', 'aria-labelledby': 'module-status-title' },
      h('span', { class: 'module-status__icon' }, icon(module.icon, 'icon')),
      h(
        'h2',
        { class: 'module-status__title', id: 'module-status-title' },
        module.title.toUpperCase(),
      ),
      h('p', { class: 'module-status__text', role: 'status' }, 'U produkciji – uskoro.'),
      h(
        'a',
        { class: 'module-status__back', href: '/dashboard' },
        icon('arrow-left', 'icon'),
        'Natrag na Početnu',
      ),
    ),
  );
