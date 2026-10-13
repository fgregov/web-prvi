// /notifications · MOBILNE OBAVIJESTI ("Obavijesti" in the bottom navigation):
// the signed-in user's own switches for seven event types, each saved on the
// server on its own (a failed save puts the switch back and says so), whether
// this device can actually receive push notifications (permission is asked
// when a switch is turned on, never on load, at most once per visit), and the
// time used for deadlines that have a date but no time.
import { api, ApiError } from '../core/api.js';
import {
  deviceState,
  enablePush,
  isIos,
  isStandalone,
  preloadPushStatus,
} from '../features/reminders/push.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderTabbar } from '../ui/tabbar.js';

renderTabbar(document.getElementById('tabbar'), 'notifications');
const root = document.getElementById('notifications');

const TYPES = [
  {
    type: 'offer_viewed',
    label: 'Pregled ponude',
    text: 'Obavijest kada kupac pregleda poslanu ponudu.',
    icon: 'eye',
  },
  {
    type: 'reminder_due',
    label: 'Podsjetnik',
    text: 'Obavijest u zakazano vrijeme podsjetnika.',
    icon: 'clock',
  },
  {
    type: 'task_deadline',
    label: 'Rok za izvršenje zadatka',
    text: 'Obavijest kada zadatak dosegne zadani rok.',
    icon: 'check-square',
  },
  {
    type: 'opportunity_deadline',
    label: 'Rok za izvršenje prilike',
    text: 'Obavijest kada prodajna prilika dosegne zadani rok.',
    icon: 'target',
  },
  // The Feedback Overview bands, shown with their own wait badges.
  {
    type: 'feedback_low',
    label: 'Feedback Overview — niski prioritet',
    text: 'Ponude koje čekaju odgovor 1–4 dana.',
    band: ['yellow', '1–4D'],
  },
  {
    type: 'feedback_medium',
    label: 'Feedback Overview — srednji prioritet',
    text: 'Ponude koje čekaju odgovor 5–9 dana.',
    band: ['red', '5–9D'],
  },
  {
    type: 'feedback_high',
    label: 'Feedback Overview — visoki prioritet',
    text: 'Ponude koje čekaju odgovor 10 ili više dana.',
    band: ['black', '10D+'],
  },
];
const SAVE_FAILED = 'Postavku nije moguće spremiti. Pokušajte ponovno.';

/** Whether push can reach this device, in the user's words (never claims more than is true). */
const DEVICE = {
  on: { ok: true, text: 'Ovaj uređaj prima mobilne obavijesti.' },
  off: { ok: false, text: 'Ovaj uređaj još ne prima mobilne obavijesti.' },
  denied: {
    ok: false,
    text: 'Mobilne obavijesti nisu dopuštene na ovom uređaju. Omogućite ih u postavkama uređaja.',
  },
  homeScreen: {
    ok: false,
    text: 'Na iPhoneu obavijesti stižu samo u Renvari dodanoj na početni zaslon: u Safariju Dijeli → Dodaj na početni zaslon, zatim je otvorite s ikone.',
  },
  unsupported: { ok: false, text: 'Ovaj preglednik ne prima mobilne obavijesti.' },
  server: {
    ok: false,
    text: 'Slanje obavijesti na ovom poslužitelju nije uključeno: postavke se spremaju, ali obavijesti ne stižu na uređaj.',
  },
  demo: {
    ok: false,
    text: 'U demou se obavijesti ne šalju: postavke se spremaju, ali obavijesti ne stižu na uređaj.',
  },
  failed: { ok: false, text: 'Uređaj se nije uspio prijaviti za obavijesti. Pokušajte ponovno.' },
};

let confirmed = null; // the switches as the server last confirmed them
let device = 'off';
let askedThisVisit = false;

const deviceBox = h('div', { class: 'nt-device', role: 'status' });
const enableButton = h(
  'button',
  { type: 'button', class: 'rv-btn rv-btn--secondary nt-device__action', hidden: true },
  'Uključi na ovom uređaju',
);

async function readDevice() {
  const status = await preloadPushStatus({ fresh: true });
  if (status?.demo) return 'demo';
  if (!status?.configured || !status.publicKey) return 'server';
  const state = await deviceState();
  if (state === 'unsupported' && isIos() && !isStandalone()) return 'homeScreen';
  return state;
}

function showDevice(state) {
  device = state;
  const info = DEVICE[state] ?? DEVICE.off;
  deviceBox.classList.toggle('is-warning', !info.ok);
  deviceBox.replaceChildren(
    icon(info.ok ? 'check' : 'info', 'rv-icon rv-icon--sm'),
    h('span', {}, info.text),
  );
  enableButton.hidden = !(state === 'off' || state === 'failed');
}

/** In the tap that turns a switch on: ask for permission and register the device. */
function connectDevice() {
  if (askedThisVisit || !(device === 'off' || device === 'failed')) return null;
  askedThisVisit = true;
  return enablePush(); // asks synchronously inside this tap (iOS requires it)
}

async function afterConnect(asking) {
  if (!asking) return;
  const outcome = await asking;
  showDevice(outcome.ok ? 'on' : outcome.reason === 'failed' ? 'failed' : await readDevice());
}

enableButton.addEventListener('click', () => {
  askedThisVisit = false;
  afterConnect(connectDevice());
});

function row(item) {
  const input = h('input', {
    class: 'rv-switch__input',
    type: 'checkbox',
    role: 'switch',
    id: `nt-${item.type}`,
    checked: Boolean(confirmed[item.type]),
    'aria-describedby': `nt-${item.type}-text nt-${item.type}-status`,
  });
  const note = h('span', { class: 'nt-row__status', id: `nt-${item.type}-status`, role: 'status' });
  let saved = 0;
  input.addEventListener('change', async () => {
    const want = input.checked;
    const asking = want ? connectDevice() : null;
    input.disabled = true;
    note.className = 'nt-row__status';
    note.textContent = 'Spremanje…';
    try {
      const result = await api.updateNotificationPreferences({
        preferences: { [item.type]: want },
      });
      confirmed = result.preferences;
      input.checked = Boolean(confirmed[item.type]);
      note.textContent = 'Spremljeno.';
      const mine = ++saved;
      setTimeout(() => {
        if (mine === saved && note.textContent === 'Spremljeno.') note.textContent = '';
      }, 2500);
    } catch {
      input.checked = Boolean(confirmed[item.type]); // back to the last confirmed state
      note.className = 'nt-row__status is-error';
      note.textContent = SAVE_FAILED;
    } finally {
      input.disabled = false;
    }
    await afterConnect(asking);
  });
  return h(
    'li',
    { dataset: { type: item.type } },
    h(
      'label',
      { class: 'rv-switch nt-row', for: input.id },
      item.band
        ? h('span', { class: `rv-wait rv-wait--${item.band[0]} nt-row__band` }, item.band[1])
        : h('span', { class: 'nt-row__icon' }, icon(item.icon, 'rv-icon')),
      h(
        'span',
        { class: 'nt-row__text' },
        h('span', { class: 'rv-switch__text nt-row__label' }, item.label),
        h('span', { class: 'nt-row__desc', id: `nt-${item.type}-text` }, item.text),
        note,
      ),
      input,
      h('span', { class: 'rv-switch__track', 'aria-hidden': 'true' }),
    ),
  );
}

function deadlineCard(time) {
  const input = h('input', {
    class: 'rv-input nt-time__input',
    type: 'time',
    id: 'nt-deadline-time',
    value: time ?? '',
    'aria-describedby': 'nt-deadline-text nt-deadline-status',
  });
  const note = h('p', { class: 'nt-row__status', id: 'nt-deadline-status', role: 'status' });
  let last = time ?? '';
  input.addEventListener('change', async () => {
    const value = input.value;
    if (value === last) return;
    input.disabled = true;
    note.className = 'nt-row__status';
    note.textContent = 'Spremanje…';
    try {
      const result = await api.updateNotificationPreferences({ deadlineTime: value || null });
      last = result.deadlineTime ?? '';
      input.value = last;
      note.textContent = last ? 'Spremljeno.' : 'Spremljeno: bez vremena.';
    } catch {
      input.value = last;
      note.className = 'nt-row__status is-error';
      note.textContent = SAVE_FAILED;
    } finally {
      input.disabled = false;
    }
  });
  return h(
    'section',
    { class: 'card module nt-time', 'aria-labelledby': 'nt-time-title' },
    h(
      'div',
      { class: 'module__head' },
      h('span', { class: 'module__icon' }, icon('calendar', 'icon')),
      h('h2', { class: 'module__title', id: 'nt-time-title' }, 'Rokovi bez vremena'),
    ),
    h(
      'div',
      { class: 'nt-time__body' },
      h(
        'p',
        { class: 'nt-time__text', id: 'nt-deadline-text' },
        'Zadatak s rokom samo po datumu i očekivani datum zatvaranja prilike javljaju se toga dana u odabrano vrijeme. Bez odabranog vremena za njih se obavijest ne šalje.',
      ),
      h('label', { class: 'rv-field__label', for: input.id }, 'Vrijeme obavijesti'),
      input,
      note,
    ),
  );
}

function render(data) {
  root.replaceChildren(
    h(
      'section',
      { class: 'nt-head', 'aria-labelledby': 'nt-title' },
      h('h1', { class: 'nt-title', id: 'nt-title' }, 'Mobilne obavijesti'),
      h('p', { class: 'nt-sub' }, 'Odaberite za koje događaje želite primati mobilne obavijesti.'),
      deviceBox,
      enableButton,
    ),
    h(
      'section',
      { class: 'card module nt-settings', 'aria-labelledby': 'nt-list-title' },
      h(
        'div',
        { class: 'module__head' },
        h('span', { class: 'module__icon' }, icon('bell', 'icon')),
        h('h2', { class: 'module__title', id: 'nt-list-title' }, 'Obavijesti'),
      ),
      h('ul', { class: 'nt-list', role: 'list' }, TYPES.map(row)),
    ),
    deadlineCard(data.deadlineTime),
  );
}

async function load() {
  root.replaceChildren(
    h('p', { class: 'nt-loading', role: 'status' }, 'Učitavanje postavki obavijesti…'),
  );
  try {
    const data = await api.notificationPreferences();
    confirmed = data.preferences;
    render(data);
  } catch (error) {
    const retry = h(
      'button',
      { type: 'button', class: 'rv-btn rv-btn--secondary' },
      'Pokušaj ponovno',
    );
    retry.addEventListener('click', load);
    root.replaceChildren(
      h(
        'div',
        { class: 'card nt-error', role: 'alert' },
        h(
          'p',
          {},
          error instanceof ApiError && error.message
            ? error.message
            : 'Postavke obavijesti nije moguće učitati.',
        ),
        retry,
      ),
    );
    return;
  }
  showDevice(await readDevice());
}

await load();
