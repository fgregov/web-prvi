// Customer offer viewer (/o/{token}): no Renvara account, no cookies, no
// third-party requests. Shows the offer's PDF and reports one "document view"
// after the first page is drawn in a visible tab for 2 seconds (once per tab
// session; the server ignores repeats within 30 minutes).
import { renderPdf } from './pdf-pages.js';

const VIEW_AFTER_MS = 2000;
const root = document.getElementById('viewer');
const token = (window.location.pathname.match(/^\/o\/([A-Za-z0-9_-]{43})\/?$/) ?? [])[1] ?? null;
const base = token ? `/o/${token}` : null;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function message(text) {
  document.title = 'Ponuda';
  root.replaceChildren(
    el('section', { class: 'ov-card ov-message' }, el('h1', {}, 'Ponuda'), el('p', {}, text)),
  );
}

const size = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toLocaleString('hr-HR', { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const pages = (n) =>
  n === 1 ? '1 stranica' : n >= 2 && n <= 4 ? `${n} stranice` : `${n} stranica`;

/** A random id for this tab only (sessionStorage): no cookie, nothing across visits. */
function viewingSession() {
  const key = 'renvara-offer-session';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && /^[A-Za-z0-9-]{16,64}$/.test(existing)) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** Reports the view once the document has been visible for VIEW_AFTER_MS in total. */
function reportViewWhenSeen() {
  let visibleFor = 0;
  let since = document.visibilityState === 'visible' ? performance.now() : null;
  let sent = false;
  const tick = () => {
    if (sent) return;
    const now = performance.now();
    const total = visibleFor + (since === null ? 0 : now - since);
    if (total >= VIEW_AFTER_MS) {
      sent = true;
      fetch(`${base}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'view',
          sessionId: viewingSession(),
          automation: navigator.webdriver === true,
        }),
        keepalive: true,
        credentials: 'same-origin',
      }).catch(() => {});
      return;
    }
    setTimeout(tick, 250);
  };
  document.addEventListener('visibilitychange', () => {
    const now = performance.now();
    if (document.visibilityState === 'visible') since = now;
    else if (since !== null) {
      visibleFor += now - since;
      since = null;
    }
  });
  tick();
}

async function start() {
  if (!base) return message('Ova poveznica više nije dostupna.');
  let info;
  try {
    const response = await fetch(`${base}/info`, { credentials: 'same-origin' });
    if (response.status === 404) return message('Ova poveznica više nije dostupna.');
    if (!response.ok) return message('Ponuda trenutno nije dostupna. Pokušajte ponovno kasnije.');
    info = (await response.json()).offer;
  } catch {
    return message('Ponuda trenutno nije dostupna. Pokušajte ponovno kasnije.');
  }

  document.title = `Ponuda · ${info.title}`;
  const pagesBox = el('div', { class: 'ov-pages', 'aria-label': 'Dokument ponude' });
  const status = el('p', { class: 'ov-status' }, 'Učitavanje dokumenta…');
  root.replaceChildren(
    el(
      'section',
      { class: 'ov-card ov-intro' },
      el('p', { class: 'ov-eyebrow' }, 'PONUDA'),
      el('h1', { class: 'ov-title' }, info.title),
      el('p', { class: 'ov-meta' }, `PDF · ${pages(info.pageCount)} · ${size(info.sizeBytes)}`),
      el(
        'a',
        {
          class: 'ov-download',
          href: `${base}/document`,
          download: info.fileName,
          rel: 'noopener',
        },
        'Preuzmi PDF',
      ),
    ),
    status,
    pagesBox,
  );

  let data;
  try {
    const response = await fetch(`${base}/document`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(String(response.status));
    data = await response.arrayBuffer();
  } catch {
    status.textContent = 'Ponuda trenutno nije dostupna. Pokušajte ponovno kasnije.';
    return;
  }
  try {
    await renderPdf(pagesBox, data);
    status.remove();
    reportViewWhenSeen();
  } catch {
    status.textContent =
      'Dokument se ne može prikazati u pregledniku. Preuzmite PDF i otvorite ga na uređaju.';
  }
}

start();
