// /follow-up · FOLLOW-UP ENGINE: the offers the salesperson tracks, unresolved
// first, for the selected period (the Home dashboard's period, shared; the
// selector sits next to "+ ATTACH NEW DOCUMENT", as on the Opportunity
// Pipeline): offers created in it and, while the period runs, the earlier ones
// still unresolved, so an offer waiting since last quarter is still waiting.
// A card opens the offer. Refreshes while the page is visible, so new views
// appear without reloading.
import { api, ApiError } from '../core/api.js';
import {
  describePeriod,
  getDashboardPeriod,
  onDashboardPeriodChange,
  setDashboardPeriod,
} from '../core/dashboard-period.js';
import { PeriodSelector } from '../features/dashboard/period-selector.js';
import {
  LINK_STATUS_LABEL,
  dateLabel,
  standingBadge,
  viewsLine,
} from '../features/follow-up/format.js';
import { offerParty } from '../features/dashboard/feedback-overview.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderTabbar } from '../ui/tabbar.js';
import { consumeFlash } from '../ui/toast.js';

const REFRESH_MS = 30_000;
const FILTERS = [
  { value: 'all', label: 'Sve' },
  { value: 'waiting', label: 'Čeka odgovor' },
  { value: 'viewed', label: 'Pregledano' },
  { value: 'resolved', label: 'Riješeno' },
];
const EMPTY = {
  all: 'Još nema ponuda. Dodajte PDF ponude i pošaljite kupcu link.',
  waiting: 'Nijedna poslana ponuda ne čeka odgovor.',
  viewed: 'Nijedna otvorena ponuda još nema zabilježen pregled.',
  resolved: 'Još nema riješenih ponuda.',
};

document.title = 'Renvara · Follow-up Engine';
renderTabbar(document.getElementById('tabbar'), 'follow-up');

const params = new URLSearchParams(window.location.search);
let filter = FILTERS.some((f) => f.value === params.get('filter')) ? params.get('filter') : 'all';

const filters = h('div', { class: 'fu-filters' });
const list = h('div', { class: 'fu-list-box rv-period-body', 'aria-live': 'polite' });
const periodSlot = h('div', { class: 'rv-period-slot' });
const caption = h('p', { class: 'rv-period-caption fu-period-caption' });
document
  .getElementById('follow-up')
  .replaceChildren(
    h(
      'section',
      { class: 'fu-head', 'aria-labelledby': 'fu-title' },
      h('h1', { class: 'fu-title', id: 'fu-title' }, 'Follow-up Engine'),
      h(
        'p',
        { class: 'fu-sub' },
        'Ponude poslane kupcima: zabilježeni pregledi i koliko dugo čekate odgovor.',
      ),
      h(
        'div',
        { class: 'fu-head__actions' },
        periodSlot,
        h(
          'a',
          { class: 'rv-btn rv-btn--primary fu-cta', href: '/follow-up/new' },
          icon('plus', 'rv-icon'),
          'Attach new document',
        ),
      ),
      caption,
    ),
    h(
      'section',
      { class: 'card module fu-overview', 'aria-labelledby': 'fu-overview-title' },
      h(
        'div',
        { class: 'module__head' },
        h('span', { class: 'module__icon' }, icon('file', 'icon')),
        h('h2', { class: 'module__title', id: 'fu-overview-title' }, 'Offer overview'),
      ),
      filters,
      list,
    ),
  );

const selector = PeriodSelector({
  container: periodSlot,
  getPeriod: getDashboardPeriod,
  onSelect: setDashboardPeriod,
  compact: true,
});

/** What the list holds: the period's offers and, while it runs, the earlier unresolved ones. */
function captionText(info, period) {
  const created = `Ponude kreirane u razdoblju ${info.range}`;
  if (!period?.includesToday) {
    return `${created} Status, čekanje i pregledi prikazani su na današnji dan.`;
  }
  return period.earlierUnresolved
    ? `${created} Neriješene ponude iz ranijih perioda: ${period.earlierUnresolved}.`
    : created;
}

function renderFilters(counts) {
  filters.replaceChildren(
    h(
      'div',
      { class: 'rv-segmented', role: 'radiogroup', 'aria-label': 'Prikaz ponuda' },
      FILTERS.map((option) =>
        h(
          'label',
          { class: 'rv-segmented__option' },
          h('input', {
            type: 'radio',
            name: 'fu-filter',
            value: option.value,
            checked: option.value === filter,
            onChange: () => {
              filter = option.value;
              // In the URL, so Back from an offer returns to the same list.
              window.history.replaceState(
                window.history.state,
                '',
                filter === 'all' ? '/follow-up' : `/follow-up?filter=${filter}`,
              );
              load();
            },
          }),
          h(
            'span',
            {},
            option.label,
            h('small', { class: 'fu-filters__count' }, String(counts?.[option.value] ?? '')),
          ),
        ),
      ),
    ),
  );
}

function card(item, now) {
  const sent =
    item.standing === 'draft'
      ? 'Nacrt · još nije označeno kao poslano'
      : item.answeredAt
        ? `Poslano: ${dateLabel(item.sentAt)} · Odgovor: ${dateLabel(item.answeredAt)}`
        : item.sentAt
          ? `Poslano: ${dateLabel(item.sentAt)}`
          : null;
  const linkNote =
    item.linkStatus && item.linkStatus !== 'active' ? LINK_STATUS_LABEL[item.linkStatus] : null;
  return h(
    'li',
    {},
    h(
      'a',
      {
        class: `fu-offer fu-offer--${item.standing}`,
        href: `/follow-up/${encodeURIComponent(item.offerId)}`,
        dataset: { offerId: item.offerId, standing: item.standing },
      },
      h(
        'span',
        { class: 'fu-offer__main' },
        h('strong', { class: 'fu-offer__customer' }, offerParty(item)),
        h('span', { class: 'fu-offer__title' }, item.title),
        item.opportunityTitle
          ? h('span', { class: 'fu-offer__meta' }, `Prilika: ${item.opportunityTitle}`)
          : null,
        sent ? h('span', { class: 'fu-offer__meta' }, sent) : null,
        item.hasDocument
          ? h(
              'span',
              { class: `fu-offer__views${item.engagement.viewCount ? ' is-viewed' : ''}` },
              viewsLine(item.engagement, now),
            )
          : h('span', { class: 'fu-offer__meta' }, 'Bez dokumenta (zabilježeno na prilici)'),
        item.standing === 'waiting' && item.waitingDays
          ? h(
              'span',
              { class: 'fu-offer__wait' },
              `Čeka odgovor ${item.waitingDays} ${item.waitingDays % 10 === 1 && item.waitingDays % 100 !== 11 ? 'dan' : 'dana'}`,
            )
          : null,
        linkNote ? h('span', { class: 'fu-offer__link' }, linkNote) : null,
      ),
      h('span', { class: 'fu-offer__side' }, standingBadge(item)),
      icon('chevron-right', 'icon fu-offer__chevron'),
    ),
  );
}

let ticket = 0;
async function load({ quiet = false } = {}) {
  const mine = ++ticket;
  const period = getDashboardPeriod();
  const info = describePeriod(period);
  if (!quiet) {
    // Not on the background refresh, so the button never loses focus under the user.
    selector.render();
    // Until the period's offers arrive, the previous ones are dimmed and out of reach.
    list.setAttribute('aria-busy', 'true');
    list.classList.add('is-loading');
  }
  let result;
  try {
    result = await api.followUpOffers(filter, { from: period.startDate, to: period.endDate });
  } catch (error) {
    if (mine !== ticket) return;
    list.removeAttribute('aria-busy');
    list.classList.remove('is-loading');
    if (quiet) return; // keep what is shown; the next refresh tries again
    list.replaceChildren(
      h(
        'p',
        { class: 'empty-row' },
        error instanceof ApiError ? error.message : 'Ponude se nisu učitale. Pokušajte ponovno.',
      ),
    );
    return;
  }
  if (mine !== ticket) return; // a newer period or filter was chosen meanwhile
  list.removeAttribute('aria-busy');
  list.classList.remove('is-loading');
  renderFilters(result.counts);
  caption.textContent = captionText(info, result.period);
  const now = new Date();
  list.replaceChildren(
    result.items.length
      ? h(
          'ul',
          { class: 'fu-list', role: 'list' },
          result.items.map((item) => card(item, now)),
        )
      : h(
          'p',
          { class: 'empty-row fu-empty' },
          result.counts.all ? EMPTY[filter] : 'Nema evidentiranih ponuda za odabrani period.',
        ),
  );
}

// Live enough: new views show up while the page is open, and on return to it.
setInterval(() => {
  if (document.visibilityState === 'visible') load({ quiet: true });
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load({ quiet: true });
});

onDashboardPeriodChange(() => load());
renderFilters(null);
await load();
consumeFlash();
