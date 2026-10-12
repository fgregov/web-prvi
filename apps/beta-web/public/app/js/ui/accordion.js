// Accordion sections (Customer Detail, Zadaci): the whole header (icon, title,
// count, chevron) is one button that opens and closes the content, with a
// short height animation. Several can be open at once.
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * A section whose whole header (icon, title, count, chevron) is one button
 * that opens and closes its content. `open` is the page's set of open section
 * ids: several can be open at once, and it survives a re-render of the page.
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

/**
 * Which sections of a page are open: none on a new visit (or only `linked`,
 * the one a link points at), and on Back to the page the ones that were open
 * then. Kept in this history entry's state, so a new visit never inherits it.
 * @param {string[]} ids  the page's section ids
 * @param {string | null} linked  a section a link asks for (#prilike …)
 */
export function openSectionsState(ids, linked = null) {
  const remembered = window.history.state?.openSections;
  const open = new Set(
    Array.isArray(remembered)
      ? remembered.filter((id) => ids.includes(id))
      : ids.includes(linked)
        ? [linked]
        : [],
  );
  const save = () => {
    try {
      window.history.replaceState({ ...window.history.state, openSections: [...open] }, '');
    } catch {
      /* no history state here: the sections still work for this view */
    }
  };
  return {
    has: (id) => open.has(id),
    add: (id) => {
      open.add(id);
      save();
    },
    delete: (id) => {
      open.delete(id);
      save();
    },
    get size() {
      return open.size;
    },
    /** The first open section, to scroll to after the page is drawn. */
    first: () => ids.find((id) => open.has(id)) ?? null,
  };
}
