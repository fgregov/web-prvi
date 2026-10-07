// /follow-up, /leads, /reports, /more · navigation shells for the primary
// modules that are not built yet. They keep the bottom navigation working and
// show the Home period they will be filtered by.
import { describePeriod, getDashboardPeriod } from '../core/dashboard-period.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderTabbar } from '../ui/tabbar.js';

const MODULES = {
  '/follow-up': {
    key: 'follow-up',
    title: 'Follow-up Engine',
    icon: 'repeat',
    text: 'Praćenje follow-upova po kupcima i prilikama. Modul je u pripremi.',
  },
  '/leads': {
    key: 'leads',
    title: 'Leads',
    icon: 'users',
    text: 'Pregled leadova i kvalifikacije. Modul je u pripremi.',
  },
  '/reports': {
    key: 'reports',
    title: 'Izvještaji',
    icon: 'bars',
    text: 'Detaljna analitika, trendovi i usporedbe. Modul je u pripremi.',
  },
  '/more': { key: 'more', title: 'Više', icon: 'ellipsis', text: null },
};

const MORE_LINKS = [
  { href: '/customers', label: 'Kupci', icon: 'building' },
  { href: '/opportunities', label: 'Prilike', icon: 'target' },
  { href: '/tasks', label: 'Zadaci', icon: 'check-square' },
  { href: '/calendar', label: 'Sales Kalendar', icon: 'calendar' },
];

const module = MODULES[window.location.pathname] ?? MODULES['/more'];
const info = describePeriod(getDashboardPeriod());
document.title = `Renvara · ${module.title}`;
document.getElementById('module-title').textContent = module.title;
renderTabbar(document.getElementById('tabbar'), module.key);

document.getElementById('module').replaceChildren(
  module.text
    ? h(
        'section',
        { class: 'card module module-shell' },
        h(
          'div',
          { class: 'module__head' },
          h('span', { class: 'module__icon' }, icon(module.icon, 'icon')),
          h('h2', { class: 'module__title' }, module.title),
        ),
        h(
          'div',
          { class: 'module-shell__body' },
          h('p', {}, module.text),
          h(
            'p',
            { class: 'module-shell__period' },
            h('span', {}, 'Period s Početne'),
            h('strong', {}, `${info.title} · ${info.range}`),
          ),
          h(
            'a',
            { class: 'module-shell__back', href: '/dashboard' },
            icon('arrow-left', 'icon'),
            'Natrag na Početnu',
          ),
        ),
      )
    : h(
        'section',
        { class: 'card module module-shell' },
        h(
          'ul',
          { class: 'list', role: 'list' },
          MORE_LINKS.map((link) =>
            h(
              'li',
              {},
              h(
                'a',
                { class: 'waiting module-shell__link', href: link.href },
                h('span', { class: 'waiting__icon' }, icon(link.icon, 'icon')),
                h(
                  'span',
                  { class: 'waiting__text' },
                  h('span', { class: 'waiting__name' }, link.label),
                ),
                h('span', {}),
                icon('chevron-right', 'icon chevron'),
              ),
            ),
          ),
        ),
      ),
);
