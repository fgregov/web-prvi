// /reports · IZVJEŠTAJI (ADR-0015): choose a report, its filters, and generate
// it on demand. The numbers come from the server (the same report becomes the
// PDF and the e-mail attachment); this page only shows them. The filters stay
// in the address (?type=…), so a report can be opened again or shared with a
// colleague who has the same rights. Every action is checked on the server.
import { api, ApiError } from '../core/api.js';
import { periodRangeLabel } from '../core/period.js';
import {
  cleanAttachmentName,
  filtersToInput,
  formatDateHr,
  normalizeReportFilters,
  OUTCOME_FILTERS,
  PERIOD_PRESETS,
  presetRange,
  REP_SORTS,
  REPORT_FILTERS,
  validateReportEmail,
} from '../core/reports.js';
import { mountAppShell } from '../ui/app-shell.js';
import { h, uid } from '../ui/dom.js';
import { openDrawer } from '../ui/drawer.js';
import { FormField, TextAreaField } from '../ui/fields.js';
import { createForm } from '../ui/form.js';
import { icon } from '../ui/icons.js';
import { showToast } from '../ui/toast.js';
import { renderPdf } from '../../../viewer/pdf-pages.js';

mountAppShell();
const root = document.getElementById('app');
root.replaceChildren(h('p', { class: 'rv-card rv-empty rv-reports__loading' }, 'Učitavanje…'));

// ------------------------------------------------------------- options ---
let options;
try {
  options = await api.reportOptions();
} catch (error) {
  root.replaceChildren(
    h(
      'div',
      { class: 'rv-card rv-empty rv-empty--page', role: 'alert' },
      h('h1', {}, 'IZVJEŠTAJI'),
      h(
        'p',
        {},
        error instanceof ApiError && error.status === 403
          ? 'Za izvještaje su potrebna prava „Izvještaji” i „Prilike — pregled”. Obratite se administratoru.'
          : error instanceof ApiError
            ? error.message
            : 'Izvještaje trenutno nije moguće učitati. Pokušajte ponovno.',
      ),
    ),
  );
  throw error;
}

const TODAY = options.today;
const types = options.types;
if (!types.length) {
  root.replaceChildren(
    h(
      'div',
      { class: 'rv-card rv-empty rv-empty--page', role: 'alert' },
      h('h1', {}, 'IZVJEŠTAJI'),
      h('p', {}, 'Nemate pravo ni na jedan izvještaj. Obratite se administratoru.'),
    ),
  );
  throw new Error('no report rights');
}

const DEFAULTS = {
  preset: 'current_month',
  year: String(TODAY.slice(0, 4)),
  quarter: 'all',
  periodQuarter: '1',
  from: '',
  to: '',
  customerId: '',
  opportunityId: '',
  ownerId: '',
  status: 'all',
  sort: 'revenue',
};

/** The form's state: strings, as the controls hold them. */
const state = { type: types[0].value, ...DEFAULTS };
{
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type');
  if (types.some((t) => t.value === type)) state.type = type;
  for (const key of Object.keys(DEFAULTS)) {
    const value = params.get(key);
    if (value !== null) state[key] = value.slice(0, 64);
  }
  if (params.get('preset') === 'quarter' && params.get('quarter')) {
    state.periodQuarter = params.get('quarter');
    state.quarter = 'all';
  }
}

const has = (filter) => REPORT_FILTERS[state.type].includes(filter);

/** The request of the current form (what the server reads). */
function currentInput() {
  const input = { type: state.type };
  if (has('period')) {
    input.preset = state.preset;
    if (state.preset === 'custom') {
      input.from = state.from;
      input.to = state.to;
    }
    if (state.preset === 'quarter' || state.preset === 'year') input.year = state.year;
    if (state.preset === 'quarter') input.quarter = state.periodQuarter;
  }
  if (has('year')) {
    input.year = state.year;
    input.quarter = state.quarter;
  }
  for (const key of ['customerId', 'opportunityId', 'ownerId', 'status', 'sort']) {
    if (has(key) && state[key]) input[key] = state[key];
  }
  return input;
}

/** The filters in the address (?type=…), without the defaults: /reports alone is the default report. */
function saveAddress() {
  const { filters } = normalizeReportFilters(currentInput(), TODAY);
  const params = new URLSearchParams(filters ? filtersToInput(filters) : { type: state.type });
  if (state.preset !== 'custom') {
    params.delete('from');
    params.delete('to');
  }
  const defaults = { preset: 'current_month', status: 'all', sort: 'revenue', quarter: 'all' };
  for (const [key, value] of Object.entries(defaults)) {
    if (params.get(key) === value) params.delete(key);
  }
  if (state.type === 'quarters' && params.get('year') === DEFAULTS.year) params.delete('year');
  if (params.get('type') === types[0].value && [...params.keys()].length === 1)
    params.delete('type');
  const search = params.toString();
  window.history.replaceState(window.history.state, '', `/reports${search ? `?${search}` : ''}`);
}

// ------------------------------------------------------------ controls ---
const typeId = uid('report-type');
const typeSelect = h(
  'select',
  { class: 'rv-input', id: typeId, name: 'type' },
  types.map((t) => h('option', { value: t.value, selected: t.value === state.type }, t.label)),
);
typeSelect.addEventListener('change', () => {
  state.type = typeSelect.value;
  renderFilters();
  changed();
});

const filtersHost = h('div', { class: 'rv-reports__filters' });
const formError = h('p', {
  class: 'rv-field__error rv-reports__error',
  role: 'alert',
  hidden: true,
});

const generateButton = h(
  'button',
  { type: 'button', class: 'rv-btn rv-btn--primary', onClick: generate },
  icon('chart-column'),
  'GENERIRAJ IZVJEŠTAJ',
);
const previewButton = h(
  'button',
  { type: 'button', class: 'rv-btn rv-btn--secondary', onClick: preview },
  icon('eye'),
  'PREGLED PDF-a',
);
const downloadButton = h(
  'button',
  { type: 'button', class: 'rv-btn rv-btn--secondary', onClick: download },
  icon('download'),
  'PREUZMI PDF',
);
const emailButton = h(
  'button',
  { type: 'button', class: 'rv-btn rv-btn--secondary', onClick: openEmail },
  icon('mail'),
  'POŠALJI E-MAIL',
);
const resetButton = h(
  'button',
  { type: 'button', class: 'rv-btn rv-btn--ghost', onClick: reset },
  icon('rotate-ccw'),
  'RESETIRAJ FILTERE',
);
const actionHint = h('p', { class: 'rv-reports__hint', role: 'status', 'aria-live': 'polite' });
const result = h('section', { class: 'rv-reports__result', 'aria-live': 'polite' });
const sends = h('section', { class: 'rv-card rv-reports__sends', hidden: true });

root.replaceChildren(
  h(
    'div',
    { class: 'rv-page-head' },
    h(
      'div',
      {},
      h('h1', { class: 'rv-page-title' }, 'IZVJEŠTAJI'),
      h(
        'p',
        { class: 'rv-muted' },
        'Izrađuju se na zahtjev iz zaključenih prilika (WON / LOST) vaše organizacije.',
      ),
    ),
  ),
  h(
    'section',
    { class: 'rv-card rv-reports__panel', 'aria-label': 'Izvještaj i filteri' },
    h(
      'div',
      { class: 'rv-field rv-reports__type' },
      h('label', { class: 'rv-field__label', for: typeId }, 'VRSTA IZVJEŠTAJA'),
      typeSelect,
    ),
    filtersHost,
    formError,
    h(
      'div',
      { class: 'rv-reports__actions', role: 'toolbar', 'aria-label': 'Akcije izvještaja' },
      generateButton,
      previewButton,
      downloadButton,
      options.email.allowed ? emailButton : null,
      resetButton,
    ),
    actionHint,
  ),
  result,
  sends,
);

/** A labelled select. */
function selectField(label, value, items, onChange, { hint } = {}) {
  const id = uid('rf');
  const select = h(
    'select',
    { class: 'rv-input', id },
    items.map((item) =>
      h('option', { value: item.value, selected: item.value === value }, item.label),
    ),
  );
  select.addEventListener('change', () => onChange(select.value));
  return h(
    'div',
    { class: 'rv-field' },
    h('label', { class: 'rv-field__label', for: id }, label),
    select,
    hint ? h('p', { class: 'rv-field__hint' }, hint) : null,
  );
}

function dateField(label, value, onChange, key) {
  const id = uid('rf');
  const input = h('input', { class: 'rv-input', id, type: 'date', value, name: key });
  input.addEventListener('change', () => onChange(input.value));
  return h(
    'div',
    { class: 'rv-field', dataset: { key } },
    h('label', { class: 'rv-field__label', for: id }, label),
    input,
  );
}

const yearItems = () => options.years.map((y) => ({ value: String(y), label: `${y}.` }));
const quarterItems = [1, 2, 3, 4].map((q) => ({ value: String(q), label: `Q${q}` }));

function renderFilters() {
  const fields = [];
  const set = (key) => (value) => {
    state[key] = value;
    if (key === 'preset' || key === 'year' || key === 'periodQuarter') renderFilters();
    if (key === 'customerId') {
      const ok = options.opportunities.some(
        (o) => o.id === state.opportunityId && (!value || o.customerId === value),
      );
      if (!ok) state.opportunityId = '';
      renderFilters();
    }
    changed();
  };
  if (has('period')) {
    const range = presetRange(state.preset, TODAY, {
      year: Number(state.year),
      quarter: Number(state.periodQuarter),
      from: state.from,
      to: state.to,
    });
    const rangeText =
      state.preset !== 'custom' && range?.startDate
        ? `${formatDateHr(range.startDate)} – ${formatDateHr(range.endDate)}`
        : null;
    fields.push(
      selectField(
        'Razdoblje',
        state.preset,
        PERIOD_PRESETS.map((p) => ({ value: p.value, label: p.label })),
        (value) => {
          if (value === 'custom' && !state.from) {
            const current = presetRange(state.preset, TODAY, {
              year: Number(state.year),
              quarter: Number(state.periodQuarter),
            });
            state.from = current?.startDate ?? TODAY;
            state.to = current?.endDate ?? TODAY;
          }
          set('preset')(value);
        },
        { hint: rangeText },
      ),
    );
    if (state.preset === 'quarter' || state.preset === 'year') {
      fields.push(selectField('Godina', state.year, yearItems(), set('year')));
    }
    if (state.preset === 'quarter') {
      fields.push(selectField('Kvartal', state.periodQuarter, quarterItems, set('periodQuarter')));
    }
    if (state.preset === 'custom') {
      fields.push(dateField('Od datuma', state.from, set('from'), 'from'));
      fields.push(dateField('Do datuma', state.to, set('to'), 'to'));
    }
  }
  if (has('year')) {
    fields.push(selectField('Godina', state.year, yearItems(), set('year')));
    fields.push(
      selectField(
        'Kvartal',
        state.quarter,
        [{ value: 'all', label: 'Svi kvartali' }, ...quarterItems],
        set('quarter'),
      ),
    );
  }
  if (has('customerId')) {
    fields.push(
      selectField(
        'Kupac',
        state.customerId,
        [
          { value: '', label: 'Svi kupci' },
          ...options.customers.map((c) => ({
            value: c.id,
            label: c.active ? c.name : `${c.name} (neaktivan)`,
          })),
        ],
        set('customerId'),
      ),
    );
  }
  if (has('opportunityId')) {
    const won = options.opportunities.filter(
      (o) => o.status === 'won' && (!state.customerId || o.customerId === state.customerId),
    );
    fields.push(
      selectField(
        'Prilika',
        state.opportunityId,
        [
          { value: '', label: 'Sve prilike' },
          ...won.map((o) => ({ value: o.id, label: `${o.title} · ${formatDateHr(o.closedDate)}` })),
        ],
        set('opportunityId'),
        {
          hint: state.customerId ? 'Samo WON prilike odabranog kupca.' : 'WON prilike svih kupaca.',
        },
      ),
    );
  }
  if (has('ownerId')) {
    fields.push(
      selectField(
        'Prodajni predstavnik',
        state.ownerId,
        [
          { value: '', label: 'Svi prodajni predstavnici' },
          ...options.reps.map((r) => ({ value: r.id, label: r.name })),
        ],
        set('ownerId'),
      ),
    );
  }
  if (has('status')) {
    fields.push(selectField('Status', state.status, OUTCOME_FILTERS, set('status')));
  }
  if (has('sort')) {
    fields.push(selectField('Poredak', state.sort, REP_SORTS, set('sort')));
  }
  filtersHost.replaceChildren(...fields);
}

// ------------------------------------------------------- report state ---
/** The report on screen and the request it was made with. */
let shown = null; // { input, key, report, fileName, email }
let busy = false;

const keyOf = (input) =>
  JSON.stringify(filtersToInput(normalizeReportFilters(input, TODAY).filters ?? input));

function renderActions() {
  const current = (() => {
    const { filters } = normalizeReportFilters(currentInput(), TODAY);
    return filters ? JSON.stringify(filtersToInput(filters)) : null;
  })();
  const fresh = shown !== null && current === shown.key;
  for (const button of [previewButton, downloadButton, emailButton])
    button.disabled = busy || !fresh;
  generateButton.disabled = busy;
  resetButton.disabled = busy;
  let hint = '';
  if (!shown)
    hint =
      'Odaberite filtre i generirajte izvještaj; zatim ga možete pregledati kao PDF, preuzeti ili poslati e-mailom.';
  else if (!fresh)
    hint = 'Filteri su promijenjeni — generirajte izvještaj ponovno da bi PDF odgovarao prikazu.';
  actionHint.textContent = hint;
  result.classList.toggle('is-stale', Boolean(shown) && !fresh);
}

function changed() {
  formError.hidden = true;
  for (const field of filtersHost.querySelectorAll('.rv-field--invalid')) {
    field.classList.remove('rv-field--invalid');
  }
  saveAddress();
  renderActions();
}

function showErrors(errors, message) {
  const text = message ?? Object.values(errors)[0] ?? 'Provjerite filtre.';
  formError.replaceChildren(icon('alert', 'rv-icon rv-icon--sm'), h('span', {}, text));
  formError.hidden = false;
  if (errors.range || errors.from || errors.to) {
    for (const field of filtersHost.querySelectorAll('[data-key="from"], [data-key="to"]')) {
      field.classList.add('rv-field--invalid');
    }
  }
}

async function generate() {
  const input = currentInput();
  const { errors } = normalizeReportFilters(input, TODAY);
  if (Object.keys(errors).length) {
    showErrors(errors);
    return;
  }
  busy = true;
  renderActions();
  generateButton.replaceChildren(icon('chart-column'), 'Generiranje…');
  try {
    const response = await api.generateReport(input);
    shown = { input, key: keyOf(input), ...response };
    renderReport(response.report);
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) showErrors(error.errors, error.message);
    else showErrors({}, error instanceof ApiError ? error.message : 'Pokušajte ponovno.');
  } finally {
    busy = false;
    generateButton.replaceChildren(icon('chart-column'), 'GENERIRAJ IZVJEŠTAJ');
    renderActions();
  }
}

function reset() {
  Object.assign(state, DEFAULTS);
  renderFilters();
  changed();
}

// -------------------------------------------------------- the report ---
function renderReport(report) {
  const tile = (item) =>
    h(
      'div',
      { class: `rv-report-tile${item.tone ? ` rv-report-tile--${item.tone}` : ''}` },
      h('p', { class: 'rv-report-tile__label' }, item.label),
      h('p', { class: 'rv-report-tile__value' }, item.display),
      item.hint ? h('p', { class: 'rv-report-tile__hint' }, item.hint) : null,
    );
  const chart = (c) => {
    const max = Math.max(...c.items.map((i) => i.value), 0);
    const pct = (v) => (max > 0 ? `${Math.max((v / max) * 100, v > 0 ? 1 : 0)}%` : '0%');
    if (c.kind === 'columns') {
      return h(
        'figure',
        { class: 'rv-report-chart rv-report-chart--columns' },
        h('figcaption', {}, c.title),
        h(
          'div',
          { class: 'rv-report-columns', role: 'list' },
          c.items.map((i) =>
            h(
              'div',
              {
                class: 'rv-report-columns__item',
                role: 'listitem',
                'aria-label': `${i.label}: ${i.display}`,
              },
              h('span', { class: 'rv-report-columns__value' }, i.display),
              h(
                'span',
                { class: 'rv-report-columns__track' },
                h('span', {
                  class: `rv-report-columns__bar rv-report-tone--${i.tone ?? 'neutral'}`,
                  style: `height: ${pct(i.value)}`,
                }),
              ),
              h('span', { class: 'rv-report-columns__label' }, i.label),
            ),
          ),
        ),
      );
    }
    return h(
      'figure',
      { class: 'rv-report-chart' },
      h('figcaption', {}, c.title),
      h(
        'ul',
        { class: 'rv-report-bars', role: 'list' },
        c.items.map((i) =>
          h(
            'li',
            { class: 'rv-report-bars__row' },
            h('span', { class: 'rv-report-bars__label' }, i.label),
            h(
              'span',
              { class: 'rv-report-bars__track' },
              h('span', {
                class: `rv-report-bars__bar rv-report-tone--${i.tone ?? 'neutral'}`,
                style: `width: ${pct(i.value)}`,
              }),
            ),
            h('span', { class: 'rv-report-bars__value' }, i.display),
          ),
        ),
      ),
    );
  };
  const table = (t) =>
    h(
      'section',
      { class: 'rv-report-table-card' },
      h('h3', { class: 'rv-report-section-title' }, t.title),
      t.rows.length
        ? h(
            'div',
            { class: 'rv-report-table-scroll' },
            h(
              'table',
              { class: 'rv-report-table' },
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  t.columns.map((c) =>
                    h('th', { scope: 'col', class: c.align === 'right' ? 'is-num' : '' }, c.label),
                  ),
                ),
              ),
              h(
                'tbody',
                {},
                t.rows.map((row) =>
                  h(
                    'tr',
                    { class: `is-${row.kind}` },
                    row.cells.map((cell, i) =>
                      h(
                        i === 0 && row.kind !== 'row' && row.kind !== 'muted' ? 'th' : 'td',
                        {
                          class: [
                            t.columns[i]?.align === 'right' ? 'is-num' : '',
                            i === 0 && row.indent ? 'is-indented' : '',
                          ]
                            .filter(Boolean)
                            .join(' '),
                          ...(i === 0 && row.kind !== 'row' && row.kind !== 'muted'
                            ? { scope: 'row' }
                            : {}),
                        },
                        cell,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'rv-report-empty' }, t.empty),
    );

  result.replaceChildren(
    h(
      'article',
      { class: 'rv-card rv-report', 'aria-labelledby': 'report-title' },
      h(
        'header',
        { class: 'rv-report__head' },
        h('h2', { class: 'rv-report__title', id: 'report-title' }, report.title),
        h(
          'p',
          { class: 'rv-report__meta' },
          `Razdoblje: ${report.period.label} · Generirano: ${report.generatedLabel} (${report.timeZone})`,
        ),
        h(
          'ul',
          { class: 'rv-report__filters', 'aria-label': 'Primijenjeni filteri' },
          report.filters.map((f) =>
            h('li', {}, h('span', {}, `${f.label}: `), h('strong', {}, f.value)),
          ),
        ),
      ),
      report.empty
        ? h(
            'p',
            { class: 'rv-notice rv-report__empty' },
            icon('info'),
            h('span', {}, 'Za odabrano razdoblje i odabrane filtre nema zaključenih prilika.'),
          )
        : null,
      h('div', { class: 'rv-report-tiles' }, report.summary.map(tile)),
      report.charts.length
        ? h('div', { class: 'rv-report-charts' }, report.charts.map(chart))
        : null,
      ...report.tables.map(table),
      h(
        'section',
        { class: 'rv-report-notes' },
        h('h3', { class: 'rv-report-section-title' }, 'Napomene'),
        h(
          'ul',
          {},
          report.notes.map((n) => h('li', {}, n)),
        ),
      ),
    ),
  );
  result.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
}

// ------------------------------------------------------------------ PDF ---
async function pdfBytes(downloadIt) {
  return api.reportPdf(shown.input, { download: downloadIt });
}

function saveFile(bytes, fileName) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = h('a', { href: url, download: fileName, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function download() {
  if (!shown || busy) return;
  busy = true;
  renderActions();
  try {
    saveFile(await pdfBytes(true), shown.fileName);
    showToast('PDF je preuzet.');
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : 'PDF trenutno nije moguće izraditi.');
  } finally {
    busy = false;
    renderActions();
  }
}

async function preview() {
  if (!shown || busy) return;
  const previousFocus = document.activeElement;
  const status = h('p', { class: 'rv-pdf-overlay__status', role: 'status' }, 'Izrada PDF-a…');
  const pages = h('div', { class: 'rv-pdf-overlay__pages' });
  const fileName = shown.fileName;
  let bytes = null;
  const close = () => {
    overlay.remove();
    document.documentElement.classList.remove('rv-scroll-lock');
    document.removeEventListener('keydown', onKey, true);
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  };
  const closeButton = h(
    'button',
    { type: 'button', class: 'rv-btn rv-btn--secondary rv-btn--sm', onClick: close },
    icon('x'),
    'Zatvori',
  );
  const saveButton = h(
    'button',
    {
      type: 'button',
      class: 'rv-btn rv-btn--primary rv-btn--sm',
      disabled: true,
      onClick: () => bytes && saveFile(bytes, fileName),
    },
    icon('download'),
    'Preuzmi PDF',
  );
  const overlay = h(
    'div',
    {
      class: 'rv-pdf-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Pregled PDF-a',
    },
    h(
      'header',
      { class: 'rv-pdf-overlay__bar' },
      h('p', { class: 'rv-pdf-overlay__title' }, icon('file'), h('span', {}, fileName)),
      h('div', { class: 'rv-pdf-overlay__actions' }, saveButton, closeButton),
    ),
    h('div', { class: 'rv-pdf-overlay__body' }, status, pages),
  );
  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }
  document.body.append(overlay);
  document.documentElement.classList.add('rv-scroll-lock');
  document.addEventListener('keydown', onKey, true);
  closeButton.focus();
  try {
    bytes = await pdfBytes(false);
    saveButton.disabled = false;
    const { pageCount } = await renderPdf(pages, bytes.slice(0), { label: 'Stranica izvještaja' });
    status.textContent = `${pageCount} ${pageCount === 1 ? 'stranica' : pageCount < 5 ? 'stranice' : 'stranica'} · A4`;
  } catch (error) {
    status.textContent =
      error instanceof ApiError
        ? error.message
        : 'PDF trenutno nije moguće prikazati. Pokušajte ponovno.';
    status.classList.add('is-error');
  }
}

// ---------------------------------------------------------------- e-mail ---
const newRequestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function openEmail() {
  if (!shown || busy) return;
  const sent = shown;
  let requestId = newRequestId();
  const form = createForm(
    [
      {
        fields: [
          FormField('to', 'E-mail primatelja', {
            type: 'email',
            required: true,
            autocomplete: 'email',
            placeholder: 'ime@tvrtka.hr',
            maxlength: 254,
          }),
          FormField('subject', 'Predmet poruke', {
            required: true,
            value: sent.email.subject,
            maxlength: 200,
          }),
          TextAreaField('message', 'Tekst poruke', {
            rows: 5,
            value: sent.email.message,
            maxlength: 5000,
          }),
          FormField('fileName', 'Naziv PDF privitka', {
            value: sent.fileName,
            maxlength: 150,
            hint: 'Slova bez kvačica, brojke, točka, crtica i podvlaka; završava s .pdf.',
          }),
        ],
      },
    ],
    {
      notice: options.email.configured
        ? `PDF izvještaja šalje se kao privitak${options.email.from ? ` s adrese ${options.email.from}` : ''}.`
        : options.email.message,
    },
  );
  const error = h('p', { class: 'rv-reports-error', role: 'alert', hidden: true });
  const drawer = openDrawer({
    title: 'Pošalji izvještaj e-mailom',
    subtitle: `${sent.report.title} · ${sent.report.period.label}`,
    content: h('div', {}, form.element, error),
    submitLabel: 'Pošalji e-mail',
    onSubmit: async () => {
      error.hidden = true;
      const values = form.values();
      if (form.setErrors(validateReportEmail(values))) return false;
      try {
        const response = await api.sendReportEmail({
          filters: sent.input,
          to: values.to.trim(),
          subject: values.subject,
          message: values.message,
          fileName: cleanAttachmentName(values.fileName, sent.fileName),
          requestId,
        });
        showToast(`E-mail je poslan na ${response.entry.recipient}.`);
        loadSends();
        return true;
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 422) form.setErrors(failure.errors);
        error.textContent =
          failure instanceof ApiError && failure.status !== 0
            ? failure.message
            : 'Nije moguće provjeriti je li e-mail poslan (veza je prekinuta). Ponovni pokušaj neće poslati dvostruki e-mail.';
        error.hidden = false;
        // A clear answer of the server ends this attempt; after a lost connection the
        // same request is repeated, so the server answers it once.
        if (failure instanceof ApiError && failure.status !== 0) requestId = newRequestId();
        if (failure instanceof ApiError && failure.status !== 0) loadSends();
        return false;
      }
    },
  });
  if (!options.email.configured) {
    const submit = drawer.panel.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
  }
}

async function loadSends() {
  if (!options.email.allowed) return;
  let list;
  try {
    list = await api.reportEmails();
  } catch {
    return;
  }
  sends.hidden = list.length === 0;
  sends.replaceChildren(
    h('h2', { class: 'rv-report-section-title' }, 'Zadnja slanja e-mailom'),
    h(
      'ul',
      { class: 'rv-reports__send-list', role: 'list' },
      list.map((e) =>
        h(
          'li',
          {},
          h(
            'span',
            { class: `rv-badge rv-badge--${e.status === 'sent' ? 'green' : 'red'}` },
            e.status === 'sent' ? 'Poslano' : 'Nije poslano',
          ),
          h('strong', {}, e.reportTitle),
          h(
            'span',
            { class: 'rv-muted' },
            [
              e.periodFrom && e.periodTo
                ? periodRangeLabel({ startDate: e.periodFrom, endDate: e.periodTo })
                : null,
              e.recipient,
              new Date(e.createdAt).toLocaleString('hr-HR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
              e.sentByName,
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        ),
      ),
    ),
  );
}

renderFilters();
saveAddress();
renderActions();
loadSends();
