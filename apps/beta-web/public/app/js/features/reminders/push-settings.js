// "Obavijesti" (account menu on Home): whether this server sends push
// reminders and whether this device receives them, turning them on here, and
// a test notification to check the whole path (server → push service → device).
import { api, ApiError } from '../../core/api.js';
import { h } from '../../ui/dom.js';
import { openSheet } from '../../ui/sheet.js';
import {
  deviceState,
  enablePush,
  isIos,
  isStandalone,
  preloadPushStatus,
  PUSH_UNAVAILABLE,
} from './push.js';

const DEVICE_TEXT = {
  on: 'Prima obavijesti',
  off: 'Obavijesti nisu uključene',
  denied: 'Blokirano u postavkama (Postavke → Obavijesti → Renvara)',
  unsupported: 'Ovaj preglednik ne prima push obavijesti',
};
const HOME_SCREEN_HINT =
  'Na iPhoneu: u Safariju dodirnite Dijeli → Dodaj na početni zaslon, otvorite Renvaru s ikone na početnom zaslonu i ovdje uključite obavijesti.';

const DEMO_NOTE =
  'Ovo je demo bez poslužitelja: podsjetnike možete postavljati i vide se na zapisima, ali obavijesti ne stižu na uređaj. Za prave obavijesti Renvara mora raditi na vlastitom poslužitelju.';

const devicesText = (n) => `${n} ${n === 1 ? 'uređaj' : 'uređaja'}`;

function testMessage(result) {
  switch (result.status) {
    case 'sent':
      return `Probna obavijest je poslana na ${devicesText(result.delivered)}. Ako ne stigne za minutu, provjerite Postavke → Obavijesti → Renvara i način Fokus.`;
    case 'no_device':
      return 'Nijedan uređaj nije prijavljen. Najprije uključite obavijesti na ovom uređaju.';
    case 'not_configured':
      return PUSH_UNAVAILABLE.server;
    default:
      return `Servis za obavijesti nije prihvatio poruku${result.error ? ` (${result.error})` : ''}. Isključite i ponovno uključite obavijesti na ovom uređaju.`;
  }
}

export function openPushSettings() {
  preloadPushStatus();
  const server = h('dd', {}, 'Provjera…');
  const device = h('dd', {}, 'Provjera…');
  const hint = h('p', { class: 'rv-reminder__note is-warning', hidden: true });
  const result = h('p', { class: 'rv-push__result', role: 'status', hidden: true });
  const close = h('button', { type: 'button', class: 'rv-btn rv-btn--secondary' }, 'Zatvori');
  const enable = h(
    'button',
    { type: 'button', class: 'rv-btn rv-btn--primary' },
    'Uključi obavijesti',
  );
  const test = h(
    'button',
    { type: 'button', class: 'rv-btn rv-btn--primary', hidden: true },
    'Pošalji probnu obavijest',
  );
  const sheet = openSheet({
    title: 'Obavijesti',
    className: 'rv-sheet--form',
    content: h(
      'div',
      { class: 'rv-sheet__body' },
      h(
        'div',
        { class: 'rv-sheet__scroll rv-push' },
        h(
          'p',
          { class: 'rv-push__intro' },
          'Podsjetnike za zadatke, leadove i prilike šalje poslužitelj, i kada je Renvara zatvorena.',
        ),
        h(
          'dl',
          { class: 'rv-push__status' },
          h('div', {}, h('dt', {}, 'Poslužitelj'), server),
          h('div', {}, h('dt', {}, 'Ovaj uređaj'), device),
        ),
        hint,
        result,
      ),
      h('div', { class: 'rv-sheet__actions' }, close, enable, test),
    ),
  });

  const say = (text) => {
    result.textContent = text;
    result.hidden = !text;
  };

  async function refresh() {
    const status = await preloadPushStatus({ fresh: true }); // device count changes here
    if (status?.demo) {
      server.textContent = 'Demo: obavijesti se ne šalju';
      device.textContent = 'Nije dostupno u demou';
      hint.textContent = DEMO_NOTE;
      hint.hidden = false;
      enable.hidden = true;
      test.hidden = true;
      return;
    }
    const state = await deviceState();
    const configured = Boolean(status?.configured);
    server.textContent = !status
      ? 'Nije dostupno'
      : configured
        ? `Uključeno · prijavljeno ${devicesText(status.devices ?? 0)}`
        : 'Isključeno: na poslužitelju nisu postavljeni ključevi za obavijesti';
    const needsHomeScreen = state === 'unsupported' && isIos() && !isStandalone();
    device.textContent = needsHomeScreen
      ? 'Otvorite Renvaru s početnog zaslona'
      : DEVICE_TEXT[state];
    hint.textContent = needsHomeScreen ? HOME_SCREEN_HINT : '';
    hint.hidden = !needsHomeScreen;
    enable.hidden = state === 'on';
    enable.disabled = !configured || state === 'unsupported' || state === 'denied';
    test.hidden = state !== 'on';
    test.disabled = !configured;
  }

  close.addEventListener('click', () => sheet.close());
  enable.addEventListener('click', async () => {
    enable.disabled = true;
    const outcome = await enablePush(); // asks for permission in this tap (iOS)
    await refresh();
    say(outcome.ok ? 'Obavijesti su uključene na ovom uređaju.' : PUSH_UNAVAILABLE[outcome.reason]);
  });
  test.addEventListener('click', async () => {
    test.disabled = true;
    say('Šaljem…');
    try {
      say(testMessage(await api.testPush()));
    } catch (failure) {
      say(
        failure instanceof ApiError && failure.status === 404
          ? 'Probna obavijest ovdje nije dostupna (demo nema poslužitelja).'
          : 'Slanje nije uspjelo. Provjerite vezu i pokušajte ponovno.',
      );
    }
    test.disabled = false;
  });
  refresh();
  return sheet;
}
