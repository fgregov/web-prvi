// /follow-up/{id} · One offer in the Follow-up Engine: the secret link to copy
// into the salesperson's own e-mail, sending and answer, what the customer's
// browser recorded (signals, never proof of reading) and the history.
// Opened with ?new=1 right after "Spremi i generiraj link": PONUDA USPJEŠNO
// DODANA with the three next steps. Refreshes while visible.
import { api, ApiError, onDataChanged } from '../core/api.js';
import { MESSAGES } from '../core/validation.js';
import {
  BOT_REASON,
  dateLabel,
  dateTimeLabel,
  LINK_STATUS_LABEL,
  pagesLabel,
  relativeTime,
  sizeLabel,
  standingBadge,
} from '../features/follow-up/format.js';
import { offerParty } from '../features/dashboard/feedback-overview.js';
import { confirmDialog } from '../ui/confirm.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { goBack } from '../ui/navigation.js';
import { MobilePageHeader } from '../ui/screen.js';
import { openSheet } from '../ui/sheet.js';
import { consumeFlash, showToast } from '../ui/toast.js';

const REFRESH_MS = 30_000;
const offerId = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
const params = new URLSearchParams(window.location.search);
// The success state belongs to this visit only: a reload shows the plain offer.
let justCreated = params.get('new') === '1';
if (justCreated) window.history.replaceState(window.history.state, '', window.location.pathname);

const root = document.getElementById('screen');
const header = MobilePageHeader({ title: 'Ponuda', onBack: () => goBack('/follow-up') });
const body = h('main', { class: 'rv-screen__body' });
root.replaceChildren(header.element, body);

let offer = null;

const row = (label, value) =>
  value ? h('div', { class: 'rv-dl__row' }, h('dt', {}, label), h('dd', {}, value)) : null;
const daysWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'dan' : 'dana');

function actionButton(label, variant, handler, iconName) {
  const button = h(
    'button',
    { type: 'button', class: `rv-btn rv-btn--${variant}` },
    iconName ? icon(iconName) : null,
    label,
  );
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await handler();
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : MESSAGES.unavailable);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

// ---------------------------------------------------------------- actions --
async function copyLink(url, box) {
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link je kopiran.');
    return;
  } catch {
    // Older browsers / no permission: select the text and use the legacy copy.
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(box);
  selection?.removeAllRanges();
  selection?.addRange(range);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  showToast(copied ? 'Link je kopiran.' : 'Link je označen: kopirajte ga ručno.');
}

const previewHref = () => `/follow-up/${encodeURIComponent(offerId)}/preview`;

function markSent() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const nowRadio = h('input', { type: 'radio', name: 'fu-sent-when', value: 'now', checked: true });
  const earlierRadio = h('input', { type: 'radio', name: 'fu-sent-when', value: 'earlier' });
  const date = h('input', {
    class: 'rv-input',
    type: 'date',
    max: today,
    value: today,
    'aria-label': 'Datum slanja',
  });
  const time = h('input', {
    class: 'rv-input',
    type: 'time',
    step: 60,
    value: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    'aria-label': 'Vrijeme slanja',
  });
  const when = h('div', { class: 'fu-sent-sheet__when', hidden: true }, date, time);
  const error = h('p', { class: 'rv-field__error', role: 'alert', hidden: true });
  const toggle = () => {
    when.hidden = !earlierRadio.checked;
  };
  nowRadio.addEventListener('change', toggle);
  earlierRadio.addEventListener('change', toggle);

  const confirm = h(
    'button',
    { type: 'button', class: 'rv-btn rv-btn--primary' },
    'Označi kao poslano',
  );
  const sheet = openSheet({
    title: 'Kada je ponuda poslana?',
    className: 'fu-sent',
    content: h(
      'div',
      { class: 'fu-sent-sheet' },
      h(
        'div',
        { class: 'rv-segmented', role: 'radiogroup', 'aria-label': 'Vrijeme slanja' },
        h('label', { class: 'rv-segmented__option' }, nowRadio, h('span', {}, 'Upravo sada')),
        h('label', { class: 'rv-segmented__option' }, earlierRadio, h('span', {}, 'Ranije')),
      ),
      when,
      error,
      h(
        'p',
        { class: 'fu-note' },
        'Dani čekanja računaju se od slanja; dan slanja je 1. dan. Zabilježeno slanje se kasnije ne mijenja.',
      ),
      confirm,
    ),
  });
  confirm.addEventListener('click', async () => {
    let sentAt;
    if (earlierRadio.checked) {
      const at = new Date(`${date.value}T${time.value || '00:00'}`);
      if (!date.value || Number.isNaN(at.getTime())) {
        error.textContent = 'Odaberite datum i vrijeme slanja.';
        error.hidden = false;
        return;
      }
      sentAt = at.toISOString();
    }
    confirm.disabled = true;
    try {
      offer = await api.markFollowUpSent(offerId, sentAt);
    } catch (problem) {
      confirm.disabled = false;
      error.textContent =
        problem instanceof ApiError
          ? (problem.errors?.sentAt ?? problem.message)
          : MESSAGES.unavailable;
      error.hidden = false;
      return;
    }
    sheet.close();
    justCreated = false;
    render();
    showToast('Ponuda je označena kao poslana.');
  });
}

async function markAnswered() {
  const yes = await confirmDialog({
    title: 'Označiti ponudu odgovorenom?',
    message:
      'Kupac je odgovorio na ponudu (prihvatio, odbio ili postavio pitanje). Pregled ponude nije odgovor. Ponuda prestaje čekati.',
    cancelLabel: 'Odustani',
    confirmLabel: 'Označi odgovorenim',
  });
  if (!yes) return;
  offer = await api.markFollowUpAnswered(offerId);
  render();
  showToast('Odgovor kupca je zabilježen.');
}

async function revokeLink() {
  const yes = await confirmDialog({
    title: 'Opozvati poveznicu?',
    message:
      'Kupac je više neće moći otvoriti. Ponuda, dokument i zabilježeni pregledi ostaju. Novu poveznicu možete generirati kasnije.',
    cancelLabel: 'Odustani',
    confirmLabel: 'Opozovi link',
  });
  if (!yes) return;
  offer = await api.revokeFollowUpLink(offerId);
  render();
  showToast('Poveznica je opozvana.');
}

async function issueLink() {
  offer = await api.issueFollowUpLink(offerId);
  render();
  showToast('Nova poveznica je generirana.');
}

async function downloadPdf() {
  const bytes = await api.followUpDocument(offerId);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = h('a', { href: url, download: offer.document?.fileName ?? 'ponuda.pdf' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --------------------------------------------------------------- sections --
function linkBox(url) {
  // The in-browser demo has no public address: its links are paths that open in the demo.
  if (url.startsWith('/')) {
    return h(
      'a',
      { class: 'fu-link', href: url, 'data-share-url': url },
      icon('link'),
      h('span', {}, url),
    );
  }
  return h('div', { class: 'fu-link', 'data-share-url': url }, icon('link'), h('span', {}, url));
}

const demoLinkNote = (url) =>
  url?.startsWith('/')
    ? h(
        'p',
        { class: 'fu-note' },
        'Demo: poveznica se otvara samo unutar ovog demoa (dodirnite je i vidite ponudu kao kupac). BETA server daje punu https adresu koju šaljete kupcu.',
      )
    : null;

function successCard(o) {
  const box = o.shareUrl ? linkBox(o.shareUrl) : null;
  return h(
    'section',
    { class: 'fu-success', 'aria-labelledby': 'fu-success-title' },
    h(
      'h2',
      { class: 'fu-success__title', id: 'fu-success-title', tabindex: '-1' },
      icon('check'),
      'Ponuda uspješno dodana',
    ),
    h('dl', { class: 'rv-dl' }, row('Kupac', offerParty(o)), row('Dokument', o.document?.fileName)),
    box ?? h('p', { class: 'rv-field__error' }, MESSAGES.linkFailed),
    box ? demoLinkNote(o.shareUrl) : null,
    h(
      'div',
      { class: 'fu-actions' },
      box ? actionButton('Kopiraj link', 'primary', () => copyLink(o.shareUrl, box), 'copy') : null,
      h(
        'a',
        { class: 'rv-btn rv-btn--secondary', href: previewHref() },
        icon('eye'),
        'Pregledaj ponudu',
      ),
      o.standing === 'draft'
        ? actionButton('Označi kao poslano', 'dark', async () => markSent(), 'send')
        : null,
    ),
    h(
      'p',
      { class: 'fu-note' },
      'Renvara ne šalje e-poštu. Zalijepite poveznicu u svoj e-mail kupcu, a nakon slanja označite ponudu kao poslanu: tada počinje brojanje dana čekanja.',
    ),
  );
}

function summaryCard(o) {
  const waiting = o.standing === 'waiting' && o.waitingDays;
  return h(
    'section',
    { class: 'rv-card fu-card', 'aria-labelledby': 'fu-offer-title' },
    h('p', { class: 'fu-summary__customer' }, offerParty(o)),
    h('h2', { class: 'fu-summary__title', id: 'fu-offer-title' }, o.title),
    h(
      'div',
      { class: 'fu-badges' },
      standingBadge(o),
      waiting ? h('span', { class: 'rv-badge rv-badge--neutral' }, 'Čeka odgovor') : null,
    ),
    h(
      'dl',
      { class: 'rv-dl' },
      row(
        'Kupac',
        o.customerName
          ? h('a', { href: `/customers/${encodeURIComponent(o.companyId)}` }, o.customerName)
          : o.leadName
            ? 'Još nije kupac (lead)'
            : null,
      ),
      row(
        'Lead',
        o.leadName ? h('a', { href: `/leads/${encodeURIComponent(o.leadId)}` }, o.leadName) : null,
      ),
      row(
        'Prilika',
        o.opportunityTitle
          ? h(
              'a',
              {
                href: o.companyId
                  ? `/customers/${encodeURIComponent(o.companyId)}#prilike`
                  : `/leads/${encodeURIComponent(o.leadId)}#prilike`,
              },
              o.opportunityTitle,
            )
          : 'Bez prilike',
      ),
      row('Kontakt', o.contactName),
      row('Poslano', o.sentAt ? dateTimeLabel(o.sentAt) : 'Još nije označeno kao poslano'),
      row(
        'Čeka odgovor',
        waiting ? `${o.waitingDays} ${daysWord(o.waitingDays)} (dan slanja je 1. dan)` : null,
      ),
      row('Odgovor zabilježen', o.answeredAt ? dateTimeLabel(o.answeredAt) : null),
      row('Povučeno', o.withdrawnAt ? dateTimeLabel(o.withdrawnAt) : null),
      row('Dodano', dateTimeLabel(o.createdAt)),
    ),
    // Right after saving, "Označi kao poslano" is in the success card above.
    (o.standing === 'draft' && !justCreated) || o.standing === 'waiting'
      ? h(
          'div',
          { class: 'fu-actions' },
          o.standing === 'draft'
            ? actionButton('Označi kao poslano', 'primary', async () => markSent(), 'send')
            : actionButton('Označi odgovorenim', 'dark', markAnswered, 'check'),
        )
      : null,
  );
}

function linkCard(o) {
  const link = o.link;
  const active = link?.status === 'active';
  const box = active && o.shareUrl ? linkBox(o.shareUrl) : null;
  let state;
  if (!link) state = 'Ponuda nema poveznicu.';
  else if (active && !box) state = MESSAGES.linkFailed;
  else if (active) state = `Aktivna do ${dateLabel(link.expiresAt)}`;
  else if (link.status === 'revoked')
    state = `Opozvana ${dateTimeLabel(link.revokedAt)}. Kupac je više ne može otvoriti.`;
  else state = `Istekla ${dateTimeLabel(link.expiresAt)}. Kupac je više ne može otvoriti.`;
  return h(
    'section',
    { class: 'rv-card fu-card', 'aria-labelledby': 'fu-link-title' },
    h('h2', { class: 'fu-card__title', id: 'fu-link-title' }, icon('link'), 'Poveznica za kupca'),
    box ??
      h(
        'p',
        { class: 'fu-link fu-link--off' },
        link ? LINK_STATUS_LABEL[link.status] : 'Bez poveznice',
      ),
    box ? demoLinkNote(o.shareUrl) : null,
    h('p', { class: 'fu-note' }, state),
    h(
      'div',
      { class: 'fu-actions fu-actions--row' },
      box ? actionButton('Kopiraj link', 'primary', () => copyLink(o.shareUrl, box), 'copy') : null,
      o.document
        ? h(
            'a',
            { class: 'rv-btn rv-btn--secondary', href: previewHref() },
            icon('eye'),
            'Pregledaj ponudu',
          )
        : null,
    ),
    h(
      'div',
      { class: 'fu-actions' },
      active ? actionButton('Opozovi link', 'ghost', revokeLink, 'ban') : null,
      !active && o.document && o.standing !== 'withdrawn'
        ? actionButton('Generiraj novi link', 'secondary', issueLink, 'link')
        : null,
    ),
    h(
      'p',
      { class: 'fu-note' },
      'Svatko tko ima poveznicu može otvoriti ponudu dok je aktivna, bez prijave. Šaljite je samo kupcu; ako je otišla krivoj osobi, opozovite je i generirajte novu. Vaš „Pregledaj ponudu” ne broji se kao pregled kupca.',
    ),
  );
}

function engagementCard(o, now) {
  const e = o.engagement;
  const stat = (label, value, wide = false) =>
    h(
      'div',
      { class: `fu-stat${wide ? ' fu-stat--wide' : ''}` },
      h('dt', {}, label),
      h('dd', {}, value),
    );
  return h(
    'section',
    { class: 'rv-card fu-card', 'aria-labelledby': 'fu-engagement-title' },
    h('h2', { class: 'fu-card__title', id: 'fu-engagement-title' }, icon('eye'), 'Pregledi ponude'),
    h(
      'dl',
      { class: 'fu-stats' },
      stat('Ukupno pregleda', String(e.viewCount)),
      stat('Sesije pregledavanja', String(e.uniqueSessions)),
      stat(
        'Zadnji pregled',
        e.lastViewAt
          ? `${relativeTime(e.lastViewAt, now)} · ${dateTimeLabel(e.lastViewAt)}`
          : 'Još nema zabilježenog pregleda',
        true,
      ),
      stat('Otvaranja poveznice', String(e.accessCount)),
      stat('Mogući automatski pristup', String(e.suspectedBotCount)),
    ),
    h(
      'p',
      { class: 'fu-note' },
      'Pregled se bilježi kada se prva stranica ponude prikaže u otvorenom prozoru preglednika najmanje 2 sekunde. To znači da je ponuda otvorena, a ne nužno i pročitana. Sigurnosni skeneri e-pošte i pregledi poveznica broje se odvojeno kao mogući automatski pristup.',
    ),
  );
}

function documentCard(o) {
  const d = o.document;
  if (!d) {
    return h(
      'section',
      { class: 'rv-card fu-card' },
      h('h2', { class: 'fu-card__title' }, icon('file'), 'Dokument'),
      h('p', { class: 'fu-note' }, 'Ponuda je zabilježena na prilici bez PDF dokumenta.'),
    );
  }
  return h(
    'section',
    { class: 'rv-card fu-card', 'aria-labelledby': 'fu-document-title' },
    h('h2', { class: 'fu-card__title', id: 'fu-document-title' }, icon('file'), 'Dokument'),
    h(
      'dl',
      { class: 'rv-dl' },
      row('Datoteka', d.fileName),
      row('Veličina', `PDF · ${sizeLabel(d.sizeBytes)} · ${pagesLabel(d.pageCount)}`),
      row('Učitano', dateTimeLabel(d.uploadedAt)),
    ),
    h(
      'div',
      { class: 'fu-actions' },
      actionButton('Preuzmi PDF', 'secondary', downloadPdf, 'arrow-down'),
    ),
  );
}

function historyCard(o) {
  const entries = [];
  const add = (at, iconName, title, sub, className = '') => {
    if (at) entries.push({ at, iconName, title, sub, className });
  };
  add(o.createdAt, 'plus', 'Ponuda dodana', o.document?.fileName ?? null);
  add(o.link?.createdAt, 'link', 'Poveznica generirana', null);
  add(o.sentAt, 'send', 'Označeno kao poslano', null);
  add(o.answeredAt, 'check', 'Odgovor kupca zabilježen', null);
  add(o.link?.revokedAt, 'ban', 'Poveznica opozvana', null);
  for (const e of o.events) {
    if (e.suspectedBot) {
      add(
        e.occurredAt,
        'alert',
        'Mogući automatski pristup',
        BOT_REASON[e.botReason] ?? 'automatski pristup',
        'is-bot',
      );
    } else if (e.type === 'document_view') {
      add(
        e.occurredAt,
        'eye',
        'Pregled ponude zabilježen',
        [e.session ? `Sesija ${e.session}` : null, e.client].filter(Boolean).join(' · '),
        'is-view',
      );
    } else {
      add(e.occurredAt, 'link', 'Poveznica otvorena', e.client);
    }
  }
  entries.sort((a, b) => b.at.localeCompare(a.at));
  return h(
    'section',
    { class: 'rv-card fu-card', 'aria-labelledby': 'fu-history-title' },
    h('h2', { class: 'fu-card__title', id: 'fu-history-title' }, icon('history'), 'Povijest'),
    h(
      'ul',
      { class: 'fu-history', role: 'list' },
      entries.map((entry) =>
        h(
          'li',
          { class: entry.className },
          icon(entry.iconName),
          h(
            'span',
            {},
            h('strong', {}, entry.title),
            h('small', {}, [dateTimeLabel(entry.at), entry.sub].filter(Boolean).join(' · ')),
          ),
        ),
      ),
    ),
  );
}

function noteCard(o) {
  if (!o.note?.trim()) return null;
  return h(
    'section',
    { class: 'rv-card fu-card' },
    h('h2', { class: 'fu-card__title' }, icon('note'), 'Interna bilješka'),
    h('p', { class: 'fu-internal' }, o.note),
    h('p', { class: 'fu-note' }, 'Kupac ne vidi ovu bilješku.'),
  );
}

function render() {
  if (!offer) return;
  document.title = `Renvara · ${offer.title}`;
  const now = new Date();
  body.replaceChildren(
    h(
      'div',
      { class: 'fu-detail' },
      justCreated ? successCard(offer) : null,
      summaryCard(offer),
      justCreated ? null : linkCard(offer),
      engagementCard(offer, now),
      documentCard(offer),
      noteCard(offer),
      historyCard(offer),
    ),
  );
}

let ticket = 0;
async function load({ quiet = false } = {}) {
  const mine = ++ticket;
  try {
    const next = await api.followUpOffer(offerId);
    if (mine !== ticket) return;
    offer = next;
    render();
  } catch (error) {
    if (mine !== ticket || quiet) return;
    body.replaceChildren(
      h(
        'div',
        { class: 'rv-card rv-empty rv-empty--page' },
        h('h2', {}, error instanceof ApiError ? error.message : MESSAGES.unavailable),
        h('a', { class: 'rv-btn rv-btn--secondary', href: '/follow-up' }, 'Follow-up Engine'),
      ),
    );
  }
}

// New views appear while the offer is open and when coming back to it.
setInterval(() => {
  if (document.visibilityState === 'visible') load({ quiet: true });
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load({ quiet: true });
});
onDataChanged(() => load({ quiet: true }));

await load();
if (justCreated) document.getElementById('fu-success-title')?.focus({ preventScroll: true });
consumeFlash();
