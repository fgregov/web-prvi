// QuickAddSheet: the "+" button opens a bottom sheet with exactly four actions.
// Each one navigates to its dedicated screen; nothing is created inside the dashboard.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { withParams } from '../../ui/navigation.js';
import { openSheet } from '../../ui/sheet.js';

export const QUICK_ADD_ACTIONS = [
  { key: 'customer', label: 'Novi kupac', href: '/customers/new', icon: 'building' },
  { key: 'opportunity', label: 'Nova prilika', href: '/opportunities/new', icon: 'target' },
  { key: 'contact', label: 'Novi kontakt', href: '/contacts/new', icon: 'user-plus' },
  { key: 'task', label: 'Novi zadatak', href: '/tasks/new', icon: 'check-square' },
];

/** Wires `trigger` (the dashboard's "+" button) to the sheet. */
export function QuickAddSheet({ trigger, returnTo }) {
  let sheet = null;

  function open() {
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
                href: withParams(action.href, { returnTo }),
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
