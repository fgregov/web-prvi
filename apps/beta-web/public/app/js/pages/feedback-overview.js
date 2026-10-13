// /feedback-overview · FEEDBACK OVERVIEW / PONUDE: every offer created in the
// selected period (the Home dashboard's period, shared), where it stood at the
// end of that period (now, for the running one) and, for a sent offer still
// waiting for the customer, the days since it was sent (1–4D yellow, 5–9D
// red, 10D+ black). A row opens the offer on its opportunity.
// Laid out like the Opportunity Pipeline: the period next to the title, and
// the offers grouped by their standing in accordions (closed on a new visit,
// as they were when coming Back).
import { api, ApiError, onDataChanged } from '../core/api.js';
import {
  describePeriod,
  getDashboardPeriod,
  onDashboardPeriodChange,
  setDashboardPeriod,
} from '../core/dashboard-period.js';
import { PeriodSelector } from '../features/dashboard/period-selector.js';
import { offerHref, offerParty } from '../features/dashboard/feedback-overview.js';
import { accordionSection, openSectionsState } from '../ui/accordion.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';

/** Offers that are not waiting: their state in words (never a timer). */
const STANDING = {
  draft: 'Nacrt',
  answered: 'Odgovoreno',
  withdrawn: 'Povučeno',
  closed: 'Prilika zatvorena',
};
/** The accordions: the offer standings, as the status filter offered them. */
const GROUPS = [
  {
    id: 'ceka-odgovor',
    status: 'waiting',
    standings: ['waiting'],
    title: 'Čeka odgovor',
    iconName: 'clock',
    empty: 'Nijedna ponuda iz odabranog perioda ne čeka odgovor.',
  },
  {
    id: 'odgovoreno',
    status: 'answered',
    standings: ['answered'],
    title: 'Odgovoreno',
    iconName: 'check',
    empty: 'Nijedna ponuda iz odabranog perioda nema zabilježen odgovor.',
  },
  {
    id: 'nacrti',
    status: 'draft',
    standings: ['draft'],
    title: 'Nacrti',
    iconName: 'pencil',
    empty: 'Nema nacrta ponuda u odabranom periodu.',
  },
  // Withdrawn offers and offers of a closed opportunity: shown only when there are some.
  {
    id: 'povuceno-zatvoreno',
    status: null,
    standings: ['withdrawn', 'closed'],
    title: 'Povučeno / zatvoreno',
    iconName: 'x',
    empty: null,
  },
];

// ?status=waiting|answered|draft (the former filter) opens that group.
const linked = GROUPS.find(
  (g) => g.status && g.status === new URLSearchParams(window.location.search).get('status'),
);
const openSections = openSectionsState(
  GROUPS.map((g) => g.id),
  linked?.id ?? null,
);

renderShell('offers');
const root = document.getElementById('app');
const summary = h('p', { class: 'rv-muted' }, ' ');
const periodSlot = h('div', { class: 'rv-period-slot' });
const caption = h('p', { class: 'rv-period-caption' });
const body = h('div', { class: 'rv-period-body', 'aria-live': 'polite' });
root.replaceChildren(
  h(
    'div',
    { class: 'rv-page-head' },
    h('div', {}, h('h1', { class: 'rv-page-title' }, 'Feedback overview / Ponude'), summary),
    h('div', { class: 'rv-page-head__actions rv-pipeline-actions' }, periodSlot),
  ),
  caption,
  body,
);

const selector = PeriodSelector({
  container: periodSlot,
  getPeriod: getDashboardPeriod,
  onSelect: setDashboardPeriod,
  compact: true,
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
/** 1 ponuda, 2 ponude, 5 ponuda. */
function offersCount(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? `${n} ponude` : `${n} ponuda`;
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
    offerParty(item),
    item.title,
    item.standing === 'waiting' ? `${item.waitingDays} dana čeka odgovor` : STANDING[item.standing],
  ].join(', ');
  return h(
    'li',
    { class: 'rv-board__card' },
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
          offerParty(item),
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
let scrolled = false;
async function load() {
  const mine = ++ticket;
  const period = getDashboardPeriod();
  const info = describePeriod(period);
  selector.render();
  // Until the period's offers arrive, the previous ones are dimmed and out of reach.
  body.setAttribute('aria-busy', 'true');
  body.classList.add('is-loading');
  let overview;
  try {
    overview = await api.offersOverview(period.startDate, period.endDate, 'all');
  } catch (error) {
    if (mine !== ticket) return;
    body.removeAttribute('aria-busy');
    body.classList.remove('is-loading');
    body.replaceChildren(
      h(
        'p',
        { class: 'rv-card rv-empty' },
        error instanceof ApiError ? error.message : 'Ponude se nisu učitale. Pokušajte ponovno.',
      ),
    );
    return;
  }
  if (mine !== ticket) return; // a newer period was chosen meanwhile
  body.removeAttribute('aria-busy');
  body.classList.remove('is-loading');

  const { counts, items } = overview;
  const { isCurrent, asOf } = overview.period;
  summary.textContent =
    offersCount(counts.all) + (counts.waiting ? ` · ${counts.waiting} čeka odgovor` : '');
  caption.textContent = isCurrent
    ? `Ponude kreirane u razdoblju ${info.range}`
    : `Ponude kreirane u razdoblju ${info.range} Stanje na ${shortDay(asOf)}: čekanje i status kakvi su bili na kraju perioda.`;

  if (!counts.all) {
    body.replaceChildren(
      h('p', { class: 'rv-card rv-empty' }, 'Nema evidentiranih ponuda za odabrani period.'),
    );
    return;
  }
  body.replaceChildren(
    h(
      'div',
      { class: 'rv-accordion-list' },
      GROUPS.map((group) => {
        // In the order the server sorts them: the longest wait first.
        const groupItems = items.filter((item) => group.standings.includes(item.standing));
        if (!group.empty && !groupItems.length) return null;
        return accordionSection({
          id: group.id,
          title: group.title,
          iconName: group.iconName,
          count: groupItems.length,
          open: openSections,
          children: groupItems.length
            ? h(
                'ul',
                { class: 'rv-pipeline-list rv-offer-cards', role: 'list' },
                groupItems.map((item) => row(item, isCurrent)),
              )
            : h('p', { class: 'rv-muted rv-pipeline-empty' }, group.empty),
        });
      }),
    ),
  );
  // Opened from a link to one group (?status=…): show it, once.
  if (linked && !scrolled && openSections.has(linked.id)) {
    scrolled = true;
    document.getElementById(linked.id)?.scrollIntoView();
  }
}

document.title = 'Renvara · Feedback overview / Ponude';
onDashboardPeriodChange(() => load());
onDataChanged(load);
await load();
