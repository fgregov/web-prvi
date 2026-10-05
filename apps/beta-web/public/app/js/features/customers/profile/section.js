// Card section with a heading row (title, count, optional action) used by every profile section.
import { h } from '../../../ui/dom.js';
import { icon } from '../../../ui/icons.js';

export function profileSection({ id, title, iconName, count, action, children }) {
  return h(
    'section',
    { class: 'rv-card rv-section', id, 'aria-labelledby': `${id}-title` },
    h(
      'header',
      { class: 'rv-section__head' },
      h('span', { class: 'rv-section__icon' }, icon(iconName)),
      h('h2', { class: 'rv-section__title', id: `${id}-title` }, title),
      count !== undefined ? h('span', { class: 'rv-section__count' }, String(count)) : null,
      action
        ? h(
            'button',
            { type: 'button', class: 'rv-link-btn', onClick: action.onClick },
            icon('plus', 'rv-icon rv-icon--sm'),
            action.label,
          )
        : null,
    ),
    children,
  );
}

export function emptyState(text, action) {
  return h(
    'div',
    { class: 'rv-empty' },
    h('p', {}, text),
    action
      ? h(
          'button',
          { type: 'button', class: 'rv-btn rv-btn--secondary rv-btn--sm', onClick: action.onClick },
          action.label,
        )
      : null,
  );
}
