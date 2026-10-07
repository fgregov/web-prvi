// PeriodSelector: the period control under the Home header, its bottom sheet
// with quarters (year by year) and the "Ručni odabir perioda" range sheet.
// It only reads and writes the dashboard period; widgets react to the change.
import { describePeriod, todayKey } from '../../core/dashboard-period.js';
import {
  currentQuarterPeriod,
  customPeriod,
  previousPeriod,
  quarterOf,
  quarterPeriod,
  samePeriod,
  validateRange,
} from '../../core/period.js';
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openSheet } from '../../ui/sheet.js';

const YEARS_BACK = 5;

/**
 * @param {{ container: HTMLElement, getPeriod: () => object, onSelect: (period) => void }} options
 */
export function PeriodSelector({ container, getPeriod, onSelect }) {
  function render() {
    const info = describePeriod(getPeriod());
    const trigger = h(
      'button',
      {
        type: 'button',
        class: 'period__trigger',
        'aria-haspopup': 'dialog',
        'aria-label': `${info.accessibleLabel}. Promijeni period`,
        onClick: openQuarterSheet,
      },
      h('span', { class: 'period__title' }, info.title),
      icon('chevron-down', 'icon period__chevron'),
    );
    const state = info.isCurrent
      ? h(
          'span',
          { class: 'period__state period__state--live' },
          h('span', { class: 'period__dot' }),
          'Aktualni kvartal',
        )
      : h('span', { class: 'period__state' }, icon('history', 'icon'), 'Povijesni pregled');
    container.replaceChildren(
      h('div', { class: 'period__row' }, trigger, state),
      h(
        'div',
        { class: 'period__row period__row--sub' },
        h('span', { class: 'period__range' }, info.range),
        info.isCurrent
          ? null
          : h(
              'button',
              {
                type: 'button',
                class: 'period__back',
                onClick: () => onSelect(currentQuarterPeriod(todayKey())),
              },
              'Vrati na aktualni kvartal',
            ),
      ),
    );
    container.classList.toggle('period--history', !info.isCurrent);
  }

  function openQuarterSheet() {
    const selected = getPeriod();
    const today = todayKey();
    const current = quarterOf(today);
    let year = selected.type === 'QUARTER' ? selected.year : current.year;
    let sheet;

    const yearLabel = h('span', { class: 'period-sheet__year', 'aria-live': 'polite' });
    const prevYear = h(
      'button',
      {
        type: 'button',
        class: 'rv-icon-btn',
        'aria-label': 'Prethodna godina',
        onClick: () => showYear(year - 1),
      },
      icon('chevron-left'),
    );
    const nextYear = h(
      'button',
      {
        type: 'button',
        class: 'rv-icon-btn',
        'aria-label': 'Sljedeća godina',
        onClick: () => showYear(year + 1),
      },
      icon('chevron-right'),
    );
    const list = h('ul', { class: 'rv-sheet__list period-sheet__list', role: 'list' });

    function option(period, note) {
      const isSelected = samePeriod(period, selected);
      return h(
        'li',
        {},
        h(
          'button',
          {
            type: 'button',
            class: `period-option${isSelected ? ' is-selected' : ''}`,
            'aria-pressed': String(isSelected),
            onClick: () => {
              sheet.close({ restoreFocus: false });
              if (!isSelected) onSelect(period);
            },
          },
          h(
            'span',
            { class: 'period-option__check', 'aria-hidden': 'true' },
            isSelected ? icon('check') : null,
          ),
          h(
            'span',
            { class: 'period-option__text' },
            h('strong', {}, `Q${period.quarter} ${period.year}`),
            h('span', {}, describePeriod(period, today).range),
          ),
          note ? h('span', { class: 'period-option__note' }, note) : null,
        ),
      );
    }

    function showYear(next) {
      year = Math.min(current.year, Math.max(current.year - YEARS_BACK, next));
      yearLabel.textContent = String(year);
      prevYear.disabled = year <= current.year - YEARS_BACK;
      nextYear.disabled = year >= current.year;
      const quarters = [4, 3, 2, 1]
        .map((q) => quarterPeriod(year, q))
        .filter((p) => p.startDate <= today); // no future quarters
      list.replaceChildren(
        ...quarters.map((p) =>
          option(p, p.year === current.year && p.quarter === current.quarter ? 'Aktualni' : null),
        ),
      );
    }

    const currentShortcut = describePeriod(selected, today).isCurrent
      ? null
      : h(
          'button',
          {
            type: 'button',
            class: 'period-sheet__current',
            onClick: () => {
              sheet.close({ restoreFocus: false });
              onSelect(currentQuarterPeriod(today));
            },
          },
          icon('history', 'rv-icon rv-icon--sm'),
          'Vrati na aktualni kvartal',
        );

    sheet = openSheet({
      title: 'Odaberite period',
      className: 'rv-sheet--period',
      content: h(
        'div',
        { class: 'rv-sheet__body' },
        currentShortcut,
        h('div', { class: 'period-sheet__years' }, prevYear, yearLabel, nextYear),
        h('div', { class: 'rv-sheet__scroll' }, list),
        h(
          'button',
          {
            type: 'button',
            class: `period-option period-option--custom${selected.type === 'CUSTOM' ? ' is-selected' : ''}`,
            onClick: () => {
              sheet.close({ restoreFocus: false });
              openRangeSheet();
            },
          },
          h('span', { class: 'period-option__check', 'aria-hidden': 'true' }, icon('calendar')),
          h(
            'span',
            { class: 'period-option__text' },
            h('strong', {}, 'Ručni odabir perioda'),
            h(
              'span',
              {},
              selected.type === 'CUSTOM'
                ? describePeriod(selected, today).range
                : 'Od – do, bilo koji raspon',
            ),
          ),
          icon('chevron-right', 'rv-icon rv-quick-add__chevron'),
        ),
      ),
    });
    showYear(year);
  }

  function openRangeSheet() {
    const selected = getPeriod();
    const initial = selected.type === 'CUSTOM' ? selected : previousPeriod(selected);
    const from = h('input', {
      class: 'rv-input',
      type: 'date',
      id: 'period-from',
      value: initial.startDate,
      max: '2100-12-31',
    });
    const to = h('input', {
      class: 'rv-input',
      type: 'date',
      id: 'period-to',
      value: initial.endDate,
      max: '2100-12-31',
    });
    const error = h('p', {
      class: 'rv-field__error period-range__error',
      id: 'period-range-error',
      role: 'alert',
      hidden: true,
    });
    const apply = h(
      'button',
      { type: 'submit', class: 'rv-btn rv-btn--primary' },
      'Prikaži period',
    );
    const cancel = h('button', { type: 'button', class: 'rv-btn rv-btn--secondary' }, 'Odustani');
    let sheet;

    /** Shows the problem only once both dates are set; Apply stays off until the range is valid. */
    function check() {
      const problem = validateRange(from.value, to.value);
      const show = problem && from.value && to.value;
      error.hidden = !show;
      error.replaceChildren(
        ...(show ? [icon('alert', 'rv-icon rv-icon--sm'), h('span', {}, problem)] : []),
      );
      to.toggleAttribute('aria-invalid', Boolean(show));
      apply.disabled = Boolean(problem);
      return problem;
    }
    from.addEventListener('input', check);
    to.addEventListener('input', check);
    cancel.addEventListener('click', () => sheet.close());

    const form = h(
      'form',
      { class: 'rv-sheet__body period-range', novalidate: true },
      h(
        'div',
        { class: 'rv-field' },
        h('label', { class: 'rv-field__label', for: 'period-from' }, 'Od'),
        from,
      ),
      h(
        'div',
        { class: 'rv-field' },
        h('label', { class: 'rv-field__label', for: 'period-to' }, 'Do'),
        to,
        error,
      ),
      h('div', { class: 'rv-confirm__actions' }, cancel, apply),
    );
    to.setAttribute('aria-describedby', 'period-range-error');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (check()) return;
      sheet.close({ restoreFocus: false });
      onSelect(customPeriod(from.value, to.value));
    });

    sheet = openSheet({
      title: 'Ručni odabir perioda',
      className: 'rv-sheet--period',
      content: form,
      initialFocus: from,
    });
    check();
  }

  render();
  return { render };
}
