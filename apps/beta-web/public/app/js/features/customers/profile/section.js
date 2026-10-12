// Card sections of the customer profile: PREGLED, PRILIKE, AKTIVNOSTI, ZADACI
// and KONTAKTI are accordions, closed until the user opens them. Creating
// records stays in the customer's header actions, so the sections themselves
// carry no create buttons.
import { h } from '../../../ui/dom.js';
import { icon } from '../../../ui/icons.js';

/**
 * A section whose whole header (icon, title, count, chevron) is one button
 * that opens and closes its content. `open` is the page's set of open section
 * ids: several can be open at once, and it survives a re-render of the profile.
 * Without a `count` (PREGLED: data, not a list) the header shows none.
 */
export function accordionSection({ id, title, iconName, count, open, children }) {
  const isOpen = open.has(id);
  const panelId = `${id}-panel`;
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'rv-accordion__toggle',
      id: `${id}-title`,
      'aria-expanded': String(isOpen),
      'aria-controls': panelId,
      'aria-label': count === undefined ? title : `${title} (${count})`,
      onClick: () => setOpen(!open.has(id)),
    },
    h('span', { class: 'rv-section__icon' }, icon(iconName)),
    h('span', { class: 'rv-section__title' }, title),
    count === undefined
      ? null
      : h('span', { class: 'rv-section__count', 'aria-hidden': 'true' }, String(count)),
    h('span', { class: 'rv-accordion__chevron', 'aria-hidden': 'true' }, icon('chevron-down')),
  );
  const panel = h(
    'div',
    { class: 'rv-accordion__panel', id: panelId, role: 'region', 'aria-labelledby': toggle.id },
    h(
      'div',
      { class: 'rv-accordion__inner' },
      h('div', { class: 'rv-accordion__content' }, children),
    ),
  );
  const section = h(
    'section',
    { class: `rv-card rv-accordion${isOpen ? ' is-open' : ''}`, id },
    h('h2', { class: 'rv-accordion__heading' }, toggle),
    panel,
  );
  // Closed content stays in the page for the animation, but out of reach of
  // the keyboard and screen readers.
  panel.inert = !isOpen;

  function setOpen(next) {
    if (next) open.add(id);
    else open.delete(id);
    section.classList.toggle('is-open', next);
    toggle.setAttribute('aria-expanded', String(next));
    panel.inert = !next;
  }
  return section;
}

/** What an opened section shows when it has no records (no create button). */
export function emptyState(text) {
  return h('div', { class: 'rv-empty' }, h('p', {}, text));
}
