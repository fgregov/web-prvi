// QuickAddSheet: "+ Novo" (sidebar, top bar) opens a sheet with exactly five actions.
// Each one navigates to its dedicated screen; nothing is created on the page itself.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { withParams } from '../../ui/navigation.js';
import { openSheet } from '../../ui/sheet.js';

export const QUICK_ADD_ACTIONS = [
  { key: 'customer', label: 'Novi kupac', href: '/sales/customers/new', icon: 'building' },
  { key: 'opportunity', label: 'Nova prilika', href: '/sales/opportunities/new', icon: 'target' },
  { key: 'contact', label: 'Novi kontakt', href: '/sales/contacts/new', icon: 'user-plus' },
  { key: 'task', label: 'Novi zadatak', href: '/sales/tasks/new', icon: 'check-square' },
  { key: 'lead', label: 'Novi lead', href: '/sales/leads/new', icon: 'user-search' },
];

/**
 * Wires `trigger` to the sheet. `returnTo`: where the forms go back to, or a
 * function giving it when the sheet opens (the page's address with its filters).
 */
export function QuickAddSheet({ trigger, returnTo }) {
  let sheet = null;

  function open() {
    const back = typeof returnTo === 'function' ? returnTo() : returnTo;
    trigger.setAttribute('aria-expanded', 'true');
    sheet = openSheet({
      title: 'Brzo dodavanje',
      className: 'rv-sheet--quick-add',
      content: h(
        'ul',
        { class: 'rv-quick-add', role: 'list', id: 'quick-add-sheet' },
        QUICK_ADD_ACTIONS.map((action) =>
          h(
            'li',
            {},
            h(
              'a',
              {
                class: 'rv-quick-add__item',
                href: withParams(action.href, { returnTo: back }),
                dataset: { action: action.key },
                // Close first, then let the link navigate (same tab).
                onClick: () => sheet?.close({ restoreFocus: false }),
              },
              h('span', { class: 'rv-quick-add__icon' }, icon(action.icon)),
              h('span', { class: 'rv-quick-add__label' }, action.label),
              icon('chevron-right', 'rv-icon rv-quick-add__chevron'),
            ),
          ),
        ),
      ),
      onClose: () => {
        trigger.setAttribute('aria-expanded', 'false');
        sheet = null;
      },
    });
  }

  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.removeAttribute('aria-controls');
  trigger.addEventListener('click', () => (sheet ? sheet.close() : open()));
  // Returning with Back must not show a sheet left open from before.
  window.addEventListener('pageshow', () => sheet?.close({ restoreFocus: false }));
  return { open, close: () => sheet?.close() };
}
