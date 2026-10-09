// Prilike: every opportunity of the customer, with its next action (or the warning).
import { labelOf, OPPORTUNITY_STATUSES, STAGES } from '../../../core/constants.js';
import { dayKey, formatDay, formatMoney } from '../../../core/format.js';
import { MESSAGES } from '../../../core/validation.js';
import { h } from '../../../ui/dom.js';
import { icon } from '../../../ui/icons.js';
import { activeReminder, reminderLabel } from '../../reminders/reminder-control.js';
import { taskMeta } from '../../tasks/task-row.js';
import { emptyState, profileSection } from './section.js';

/** "Sljedeća akcija: …" or the missing-next-action warning with "Dodaj zadatak". */
export function nextActionLine(o, addTaskHref) {
  if (o.nextAction) {
    return h(
      'a',
      { class: 'rv-next-action', href: `/tasks/${encodeURIComponent(o.nextAction.id)}` },
      icon('check-square', 'rv-icon rv-icon--sm'),
      h(
        'span',
        {},
        h('strong', {}, 'Sljedeća akcija: '),
        `${o.nextAction.title} · ${taskMeta(o.nextAction, { withCustomer: false })}`,
      ),
    );
  }
  if (!o.needsNextAction) return null;
  return h(
    'p',
    { class: 'rv-next-action rv-next-action--missing', role: 'status' },
    icon('alert', 'rv-icon rv-icon--sm'),
    h('span', {}, MESSAGES.missingNextAction),
    h('a', { class: 'rv-link-btn', href: addTaskHref }, 'Dodaj zadatak'),
  );
}

/** "Ponuda · poslana 5. listopada · 5D" with the waiting badge, or its answer. */
function offerRow(offer, deal) {
  const day = (iso) => formatDay(dayKey(new Date(iso)));
  const sent = offer.sentAt ? day(offer.sentAt) : '';
  return h(
    'li',
    { class: 'rv-offer', dataset: { offerId: offer.id } },
    icon('file', 'rv-icon rv-icon--sm'),
    h(
      'span',
      { class: 'rv-offer__text' },
      h('strong', {}, offer.title),
      h(
        'span',
        {},
        offer.status === 'answered'
          ? `Poslana ${sent} · odgovor primljen ${day(offer.answeredAt)}`
          : `Poslana ${sent}`,
      ),
    ),
    offer.waitingDays
      ? h(
          'span',
          { class: `rv-wait rv-wait--${offer.band}`, title: 'Dana čekanja na odgovor' },
          `${offer.waitingDays}D`,
        )
      : null,
    offer.waitingDays
      ? h(
          'button',
          { type: 'button', class: 'rv-link-btn', onClick: () => deal.answered(offer) },
          'Odgovor primljen',
        )
      : null,
  );
}

export function customerOpportunities(profile, actions) {
  const active = profile.opportunities.filter((o) => o.status === 'active');
  const total = active.reduce((sum, o) => sum + (o.value ?? 0), 0);
  return profileSection({
    id: 'prilike',
    title: 'Prilike',
    iconName: 'target',
    count: profile.opportunities.length,
    action: { label: 'Kreiraj priliku', onClick: actions.opportunity },
    children: profile.opportunities.length
      ? [
          h(
            'p',
            { class: 'rv-section__summary' },
            `Aktivne prilike, procijenjena vrijednost: ${formatMoney(total)}`,
          ),
          h(
            'ul',
            { class: 'rv-opps', role: 'list' },
            profile.opportunities.map((o) =>
              h(
                'li',
                { class: 'rv-opp' },
                h(
                  'div',
                  { class: 'rv-opp__top' },
                  h('strong', { class: 'rv-opp__title' }, o.title),
                  h(
                    'span',
                    { class: 'rv-opp__value' },
                    // A won deal shows its final amount when it differs from the estimate.
                    formatMoney(o.status === 'won' ? (o.wonValue ?? o.value) : o.value, o.currency),
                  ),
                ),
                h(
                  'div',
                  { class: 'rv-opp__meta' },
                  h('span', { class: 'rv-badge rv-badge--red' }, labelOf(STAGES, o.stage)),
                  o.status !== 'active'
                    ? h(
                        'span',
                        { class: `rv-badge rv-badge--${o.status === 'won' ? 'green' : 'neutral'}` },
                        labelOf(OPPORTUNITY_STATUSES, o.status),
                      )
                    : null,
                  o.contactName ? h('span', {}, o.contactName) : null,
                  o.expectedCloseDate
                    ? h('span', {}, `Zatvaranje: ${formatDay(o.expectedCloseDate)}`)
                    : null,
                ),
                nextActionLine(o, actions.nextActionFor(o.id)),
                o.offers?.length
                  ? h(
                      'ul',
                      { class: 'rv-offers', role: 'list' },
                      o.offers.map((offer) => offerRow(offer, actions.deal)),
                    )
                  : null,
                o.reminder
                  ? h(
                      'p',
                      {
                        class: `rv-opp__reminder${o.reminder.status === 'failed' ? ' is-failed' : ''}`,
                      },
                      icon('clock', 'rv-icon rv-icon--sm'),
                      `Podsjetnik: ${reminderLabel(o.reminder)}`,
                    )
                  : null,
                o.status === 'active'
                  ? h(
                      'div',
                      { class: 'rv-opp__actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'rv-btn rv-btn--sm rv-btn--secondary',
                          onClick: () => actions.deal.offerSent(o),
                        },
                        'Ponuda poslana',
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'rv-btn rv-btn--sm rv-btn--secondary',
                          onClick: () => actions.deal.won(o),
                        },
                        'Dobiveno',
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'rv-btn rv-btn--sm rv-btn--secondary',
                          onClick: () => actions.deal.lost(o),
                        },
                        'Izgubljeno',
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'rv-btn rv-btn--sm rv-btn--ghost',
                          onClick: () => actions.deal.reminder(o),
                        },
                        activeReminder(o.reminder) ? 'Promijeni podsjetnik' : 'Podsjetnik',
                      ),
                    )
                  : null,
                o.notes ? h('p', { class: 'rv-opp__notes' }, o.notes) : null,
              ),
            ),
          ),
        ]
      : emptyState('Još nema prilika za ovog kupca.', {
          label: 'Kreiraj priliku',
          onClick: actions.opportunity,
        }),
  });
}
