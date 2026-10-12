// /feedback-overview · FEEDBACK OVERVIEW / PONUDE: every offer created in the
// selected period (the Home dashboard's period, shared), where it stood at the
// end of that period (now, for the running one) and, for a sent offer still
// waiting for the customer, the days since it was sent (1–4D yellow, 5–9D
// red, 10D+ black). A row opens the offer on its opportunity.
import { api, ApiError, onDataChanged } from '../core/api.js';
import {
  getDashboardPeriod,
  onDashboardPeriodChange,
  setDashboardPeriod,
} from '../core/dashboard-period.js';
import { PeriodSelector } from '../features/dashboard/period-selector.js';
import { offerHref } from '../features/dashboard/feedback-overview.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { goBack, withParams } from '../ui/navigation.js';
import { MobilePageHeader } from '../ui/screen.js';

const FILTERS = [
  { value: 'all', label: 'Sve' },
  { value: 'waiting', label: 'Čeka odgovor' },
  { value: 'answered', label: 'Odgovoreno' },
  { value: 'draft', label: 'Nacrt' },
];
/** Offers that are not waiting: their state in words (never a timer). */
const STANDING = {
  draft: 'Nacrt',
  answered: 'Odgovoreno',
  withdrawn: 'Povučeno',
  closed: 'Prilika zatvorena',
};
const EMPTY = {
  all: 'Nema evidentiranih ponuda za odabrani period.',
  waiting: 'Nijedna ponuda iz odabranog perioda ne čeka odgovor.',
  answered: 'Nijedna ponuda iz odabranog perioda nema zabilježen odgovor.',
  draft: 'Nema nacrta ponuda u odabranom periodu.',
};

const params = new URLSearchParams(window.location.search);
let filter = FILTERS.some((f) => f.value === params.get('status')) ? params.get('status') : 'all';

const root = document.getElementById('screen');
const header = MobilePageHeader({
  title: 'Feedback overview / Ponude',
  onBack: () => goBack('/dashboard'),
});
const periodBar = h('section', { class: 'period rv-offers-period', 'aria-label': 'Period' });
const filters = h('div', { class: 'rv-offers-filters' });
const caption = h('p', { class: 'rv-offers-caption', hidden: true });
const list = h('div', { class: 'rv-offers-list', 'aria-live': 'polite' });
root.replaceChildren(
  header.element,
  h('main', { class: 'rv-screen__body rv-offers-page' }, periodBar, filters, caption, list),
);

const selector = PeriodSelector({
  container: periodBar,
  getPeriod: getDashboardPeriod,
  onSelect: setDashboardPeriod,
});

/** "07.10.2026." in this device's timezone (the organization's, in the BETA). */
function dateLabel(iso) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('hr-HR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day}.${parts.month}.${parts.year}.`;
}
const shortDay = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
};

function renderFilters(counts) {
  filters.replaceChildren(
    h(
      'div',
      { class: 'rv-segmented', role: 'radiogroup', 'aria-label': 'Status ponude' },
      FILTERS.map((option) =>
        h(
          'label',
          { class: 'rv-segmented__option' },
          h('input', {
            type: 'radio',
            name: 'offer-status',
            value: option.value,
            checked: option.value === filter,
            onChange: () => {
              filter = option.value;
              // In the URL, so Back from an offer returns to the same list.
              window.history.replaceState(
                null,
                '',
                withParams('/feedback-overview', { status: filter === 'all' ? '' : filter }),
              );
              load();
            },
          }),
          h(
            'span',
            {},
            option.label,
            h('small', { class: 'rv-offers-filters__count' }, String(counts?.[option.value] ?? '')),
          ),
        ),
      ),
    ),
  );
}

function badge(item) {
  if (item.standing === 'waiting') {
    return h(
      'span',
      { class: `rv-wait rv-wait--${item.band}`, title: 'Dana čekanja od slanja' },
      `${item.waitingDays}D`,
    );
  }
  return h(
    'span',
    { class: `rv-badge rv-badge--${item.standing === 'answered' ? 'green' : 'neutral'}` },
    STANDING[item.standing],
  );
}

function row(item, isCurrent) {
  const dates = [
    `Kreirano: ${dateLabel(item.createdAt)}`,
    item.sentAt ? `Poslano: ${dateLabel(item.sentAt)}` : null,
    item.answeredAt ? `Odgovor: ${dateLabel(item.answeredAt)}` : null,
    item.withdrawnAt ? `Povučeno: ${dateLabel(item.withdrawnAt)}` : null,
  ].filter(Boolean);
  // A past period shows where the offer stood then; say so when today differs.
  const today =
    !isCurrent && item.standingNow !== item.standing
      ? `Danas: ${item.standingNow === 'waiting' ? 'čeka odgovor' : STANDING[item.standingNow].toLowerCase()}`
      : null;
  const label = [
    item.customerName,
    item.title,
    item.standing === 'waiting' ? `${item.waitingDays} dana čeka odgovor` : STANDING[item.standing],
  ].join(', ');
  return h(
    'li',
    {},
    h(
      'a',
      {
        class: `rv-offer-row rv-offer-row--${item.standing}`,
        href: offerHref(item),
        'aria-label': label,
        dataset: { offerId: item.offerId, standing: item.standing, band: item.band ?? '' },
      },
      h(
        'span',
        { class: 'rv-offer-row__text' },
        h(
          'strong',
          { class: 'rv-offer-row__customer' },
          item.customerName || 'Kupac nije dostupan',
          item.customerActive ? null : h('span', { class: 'rv-offer-row__inactive' }, 'Neaktivan'),
        ),
        h('span', { class: 'rv-offer-row__title' }, item.title),
        item.opportunityTitle
          ? h('span', { class: 'rv-offer-row__deal' }, `Prilika: ${item.opportunityTitle}`)
          : null,
        h('span', { class: 'rv-offer-row__dates' }, dates.join(' · ')),
        today ? h('span', { class: 'rv-offer-row__today' }, today) : null,
      ),
      h('span', { class: 'rv-offer-row__status' }, badge(item)),
      icon('chevron-right', 'rv-icon rv-offer-row__chevron'),
    ),
  );
}

let ticket = 0;
async function load() {
  const mine = ++ticket;
  const period = getDashboardPeriod();
  selector.render();
  list.setAttribute('aria-busy', 'true');
  let overview;
  try {
    overview = await api.offersOverview(period.startDate, period.endDate, filter);
  } catch (error) {
    if (mine !== ticket) return;
    list.removeAttribute('aria-busy');
    list.replaceChildren(
      h(
        'p',
        { class: 'rv-card rv-empty' },
        error instanceof ApiError ? error.message : 'Ponude se nisu učitale. Pokušajte ponovno.',
      ),
    );
    return;
  }
  if (mine !== ticket) return;
  list.removeAttribute('aria-busy');
  renderFilters(overview.counts);
  const { isCurrent, asOf } = overview.period;
  caption.hidden = isCurrent;
  caption.textContent = isCurrent
    ? ''
    : `Stanje na ${shortDay(asOf)}: čekanje i status kakvi su bili na kraju perioda.`;
  list.replaceChildren(
    overview.items.length
      ? h(
          'ul',
          { class: 'rv-card rv-offer-list', role: 'list' },
          overview.items.map((item) => row(item, isCurrent)),
        )
      : h('p', { class: 'rv-card rv-empty rv-offers-empty' }, EMPTY[filter]),
  );
}

document.title = 'Renvara · Feedback overview / Ponude';
onDashboardPeriodChange(() => load());
onDataChanged(load);
await load();
