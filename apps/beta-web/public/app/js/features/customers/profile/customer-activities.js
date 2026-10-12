// Aktivnosti: chronological timeline, newest first.
import { ACTIVITY_META } from '../../../core/constants.js';
import { formatDateTime } from '../../../core/format.js';
import { h } from '../../../ui/dom.js';
import { icon } from '../../../ui/icons.js';
import { accordionSection, emptyState } from './section.js';

export function customerActivities(profile, open) {
  return accordionSection({
    id: 'aktivnosti',
    title: 'Aktivnosti',
    iconName: 'clock',
    count: profile.activities.length,
    open,
    children: profile.activities.length
      ? h(
          'ol',
          { class: 'rv-timeline', 'aria-label': 'Vremenski tijek aktivnosti, najnovije prvo' },
          profile.activities.map((activity) => {
            const meta = ACTIVITY_META[activity.type] ?? { icon: 'info', tone: 'neutral' };
            return h(
              'li',
              { class: 'rv-timeline__item' },
              h(
                'span',
                { class: `rv-timeline__icon rv-timeline__icon--${meta.tone}` },
                icon(meta.icon),
              ),
              h(
                'div',
                { class: 'rv-timeline__body' },
                h('p', { class: 'rv-timeline__title' }, activity.title),
                activity.description
                  ? h('p', { class: 'rv-timeline__desc' }, activity.description)
                  : null,
                h(
                  'p',
                  { class: 'rv-timeline__time' },
                  h('time', { datetime: activity.occurredAt }, formatDateTime(activity.occurredAt)),
                  activity.actorName ? ` · ${activity.actorName}` : '',
                ),
              ),
            );
          }),
        )
      : emptyState('Nema evidentiranih aktivnosti.'),
  });
}
