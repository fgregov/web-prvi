// Renvara demo runtime: the real BETA pages in one static page.
//
//   - Router: an in-page history stack replaces server routes and page loads.
//     Page modules export run(); the router renders a page's HTML and runs it.
//   - Server: fetch('/api/…') is answered in the page by the same CRM services
//     and API routes as apps/beta-web.
//   - Test database: inside a claude.ai artifact the records live in the
//     artifact's `db` store (one document per record). Elsewhere, or when the
//     store is unavailable, they stay in this browser only.
//   - Login accepts any username and password; nothing is sent anywhere.
import { createCrmApi } from '../server/crm/dispatch.js';
import { createCrmServices } from '../server/crm/index.js';
import { emptyData } from '../server/crm/repository.js';
import { seedDemoData } from '../server/crm/seed.js';
import { DEMO_CONTENT } from '../app/js/core/edition.js';
import { databaseStore } from './database-store.js';
import { LOADERS, PAGES, STYLES } from './pages.js';

const ORIGIN = 'https://demo.renvara.app';
const ORG = 'org-demo';
const USER = {
  id: 'demo-user',
  username: 'demo',
  displayName: 'Demo korisnik',
  role: 'beta_admin',
};
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Zagreb';
const KEYS = { data: 'renvara.demo.crm.v1', auth: 'renvara.demo.auth', nav: 'renvara.demo.nav' };
const COLLECTIONS = [
  'customers',
  'contacts',
  'opportunities',
  'tasks',
  'activities',
  'leads',
  'offers',
  'reminders',
];
const LATENCY_MS = 140; // makes loading states visible, like a real request
const SAVE_FAILED = 'Spremanje u testnu bazu nije uspjelo. Pokušajte ponovno.';

// ------------------------------------------------------ browser storage ---
const memory = new Map();
const local = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* blocked: memory only */
    }
  },
};
const session = {
  get(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return memory.get(`s:${key}`) ?? null;
    }
  },
  set(key, value) {
    memory.set(`s:${key}`, value);
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      /* blocked: memory only */
    }
  },
};

const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
const context = () => ({ organizationId: ORG, user: USER, timeZone: TIME_ZONE, now: new Date() });
const isSignedIn = () => session.get(KEYS.auth) === 'yes';

// ---------------------------------------------------------- data stores ---
/**
 * Browser-only store. Presentation demo: demo data re-seeded once a day (it is
 * dated relative to today). Clean start: empty at first, then kept as entered.
 */
const EDITION = DEMO_CONTENT ? 'demo' : 'clean';
function browserStore() {
  return {
    kind: 'browser',
    async load() {
      try {
        const saved = JSON.parse(local.get(KEYS.data) ?? 'null');
        const current = DEMO_CONTENT ? saved?.seededOn === todayKey() : true;
        // Data saved before a collection existed (e.g. leads) gets it empty.
        if (current && (saved?.edition ?? 'demo') === EDITION && saved.data?.version === 2)
          return { ...emptyData(), ...saved.data };
      } catch {
        /* fall through to a fresh start */
      }
      return DEMO_CONTENT ? seedDemoData(context()) : emptyData();
    },
    async save(data) {
      local.set(KEYS.data, JSON.stringify({ seededOn: todayKey(), edition: EDITION, data }));
    },
  };
}

async function openStore() {
  const use = window.claude?.use;
  if (typeof use !== 'function') return browserStore();
  const db = await use.call(window.claude, 'db').catch(() => null);
  return db ? databaseStore(db, { collections: COLLECTIONS, empty: emptyData }) : browserStore();
}

// ----------------------------------------------------- server, in page ---
let store;
let data;
const repo = {
  data: () => data,
  commit: () => {}, // saved after each request (see answer)
  replace(next) {
    data = next;
  },
  /** All or nothing, as on the server: a failure restores the data from before. */
  transaction(work) {
    const snapshot = structuredClone(data);
    try {
      return work();
    } catch (error) {
      data = snapshot;
      throw error;
    }
  },
};
const api = createCrmApi(createCrmServices(repo));

async function answer(method, path, query, body) {
  if (path === '/api/auth/session') {
    return isSignedIn()
      ? [200, { authenticated: true, user: USER }]
      : [200, { authenticated: false }];
  }
  if (path === '/api/auth/login') {
    if (!String(body.username ?? '').trim() || !body.password) {
      return [400, { success: false, message: 'Unesite korisničko ime i lozinku.' }];
    }
    session.set(KEYS.auth, 'yes');
    return [200, { success: true, redirectTo: '/dashboard' }];
  }
  if (path === '/api/auth/logout') {
    session.set(KEYS.auth, 'no');
    return [200, { success: true, redirectTo: '/login' }];
  }
  const hit = api.match(method, path);
  if (hit.kind === 'none') return [404, api.badRequest];
  if (hit.kind === 'method_not_allowed') return [405, api.badRequest];
  if (!isSignedIn())
    return [401, { success: false, message: 'Sesija je istekla. Prijavite se ponovno.' }];
  if (method === 'GET') {
    const result = api.run(hit, context(), query, body);
    return [result.status, result.body];
  }

  // A write is only reported as saved once the store has it. Otherwise the page
  // continues from what the store really holds (the test database undoes a
  // partial save; browser storage simply keeps the state from before).
  const before = JSON.stringify(data);
  const result = api.run(hit, context(), query, body);
  if (result.status < 400) {
    try {
      await store.save(data);
    } catch (error) {
      console.error('Test database write failed', error);
      data = store.current ? store.current() : JSON.parse(before);
      return [503, { success: false, message: SAVE_FAILED }];
    }
  }
  return [result.status, result.body];
}

const jsonResponse = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

let writes = Promise.resolve(); // writes run one at a time, like a single server process
const realFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  const method = (init.method ?? 'GET').toUpperCase();
  const run = async () => {
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
    const parsed = new URL(url, ORIGIN);
    let body = {};
    try {
      body = init.body ? JSON.parse(init.body) : {};
    } catch {
      return jsonResponse(400, api.badRequest);
    }
    const [status, payload] = await answer(method, parsed.pathname, parsed.searchParams, body);
    return jsonResponse(status, payload);
  };
  if (method === 'GET') return run();
  const response = writes.then(run, run);
  writes = response.catch(() => {});
  return response;
};

// -------------------------------------------------------------- router ---
const ROUTES = {
  '/login': 'login',
  '/dashboard': 'dashboard',
  '/customers': 'customers',
  '/customers/new': 'customer-new',
  '/contacts/new': 'contact-new',
  '/opportunities': 'opportunities',
  '/opportunities/new': 'opportunity-new',
  '/tasks': 'tasks',
  '/tasks/new': 'task-form',
  '/calendar': 'calendar',
  '/leads': 'leads',
  '/leads/new': 'lead-new',
  '/follow-up': 'module',
  '/reports': 'module',
  '/more': 'module',
};
const PATTERNS = [
  [/^\/customers\/[A-Za-z0-9_-]{1,64}$/, 'customer'],
  [/^\/tasks\/[A-Za-z0-9_-]{1,64}$/, 'task'],
  [/^\/tasks\/[A-Za-z0-9_-]{1,64}\/edit$/, 'task-form'],
  [/^\/leads\/[A-Za-z0-9_-]{1,64}$/, 'lead'],
  [/^\/leads\/[A-Za-z0-9_-]{1,64}\/convert$/, 'lead-convert'],
];

let nav = { stack: ['/login'], index: 0 };
try {
  const saved = JSON.parse(session.get(KEYS.nav) ?? 'null');
  if (Array.isArray(saved?.stack) && saved.stack.length && Number.isInteger(saved.index))
    nav = saved;
} catch {
  /* start at the login */
}
const current = () => nav.stack[nav.index];
const remember = () => session.set(KEYS.nav, JSON.stringify(nav));
const parse = (url) => new URL(url, ORIGIN);
const normalize = (url) => {
  const u = new URL(url, ORIGIN + current());
  return `${u.pathname}${u.search}${u.hash}`;
};

let pending = null;
const scheduleRender = () => {
  clearTimeout(pending);
  // Like a real navigation: code after location.replace() still runs first.
  pending = setTimeout(render, 0);
};
function navigate(url, mode) {
  const next = normalize(url);
  if (mode === 'replace') nav.stack[nav.index] = next;
  else {
    nav.stack = nav.stack.slice(0, nav.index + 1);
    nav.stack.push(next);
    nav.index += 1;
  }
  remember();
  scheduleRender();
}

// What the app's code sees instead of window.location / window.history / document.referrer.
globalThis.__rv = {
  location: {
    get pathname() {
      return parse(current()).pathname;
    },
    get search() {
      return parse(current()).search;
    },
    get hash() {
      return parse(current()).hash;
    },
    get origin() {
      return ORIGIN;
    },
    get href() {
      return ORIGIN + current();
    },
    assign: (url) => navigate(url, 'push'),
    replace: (url) => navigate(url, 'replace'),
    reload: () => scheduleRender(),
  },
  history: {
    get length() {
      return nav.index + 1;
    },
    back() {
      if (nav.index === 0) return;
      nav.index -= 1;
      remember();
      scheduleRender();
    },
    replaceState(_state, _title, url) {
      if (url) {
        nav.stack[nav.index] = normalize(url);
        remember();
      }
    },
  },
  get referrer() {
    return nav.index > 0 ? ORIGIN + nav.stack[nav.index - 1] : '';
  },
};

// Listeners a page adds to window/document are removed when it is left.
const addListener = EventTarget.prototype.addEventListener;
let pageListeners = [];
for (const target of [window, document]) {
  target.addEventListener = function (type, listener, options) {
    pageListeners.push([this, type, listener, options]);
    return addListener.call(this, type, listener, options);
  };
}

// App links are absolute paths ("/tasks/new"): route them in the page.
addListener.call(
  document,
  'click',
  (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const href = link.getAttribute('href');
    if (href.startsWith('#')) {
      event.preventDefault();
      if (href.length > 1)
        document.getElementById(href.slice(1))?.scrollIntoView({ block: 'start' });
    } else if (href.startsWith('/') && !href.startsWith('//')) {
      event.preventDefault();
      navigate(href, 'push');
    }
  },
  true,
);

const root = document.getElementById('rv-root');

// Stylesheets in the cascade order of the real pages; each page enables its own.
const styleNodes = new Map();
for (const [name, css] of Object.entries(STYLES)) {
  const node = document.createElement('style');
  node.dataset.rvStyle = name;
  node.textContent = css;
  node.disabled = true;
  document.head.append(node);
  styleNodes.set(name, node);
}
let fontLink = null;
function useStyles(names) {
  for (const [name, node] of styleNodes) node.disabled = !names.includes(name);
  const font = names.find((name) => name.startsWith('https://'));
  if (font && !fontLink) {
    fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = font;
    document.head.append(fontLink);
  }
}

function pageFor(pathname) {
  if (pathname === '/' || pathname === '') return isSignedIn() ? 'dashboard' : 'login';
  return ROUTES[pathname] ?? PATTERNS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

const STORE_NOTE = {
  database:
    'Demo: prijava prihvaća bilo koje korisničko ime i lozinku. Kupci, kontakti, prilike, zadaci i leadovi spremaju se u testnu bazu ovog demoa.',
  browser:
    'Demo: prijava prihvaća bilo koje korisničko ime i lozinku. Testna baza ovdje nije dostupna, pa se podaci spremaju samo u ovom pregledniku.',
};

let generation = 0;
async function render() {
  const run = ++generation;
  const { pathname } = parse(current());
  const page = pageFor(pathname);
  // What the server does: unknown → dashboard, protected → login, login while signed in → dashboard.
  if (!page) return navigate('/dashboard', 'replace');
  if (page !== 'login' && !isSignedIn()) return navigate('/login', 'replace');
  if (page === 'login' && isSignedIn()) return navigate('/dashboard', 'replace');
  if (pathname === '/') return navigate(`/${page}`, 'replace');

  // Leave the previous page: its listeners, overlays and scroll lock.
  for (const [target, type, listener, options] of pageListeners) {
    target.removeEventListener(type, listener, options);
  }
  pageListeners = [];
  for (const node of [...document.body.children]) {
    if (node !== root && !['SCRIPT', 'STYLE', 'TITLE', 'META'].includes(node.tagName))
      node.remove();
  }
  document.documentElement.classList.remove('rv-scroll-lock');

  const def = PAGES[page];
  useStyles(def.styles);
  document.title = def.title;
  root.innerHTML = def.html;
  const note = root.querySelector('.demo-note');
  if (note) note.textContent = STORE_NOTE[store.kind];
  window.scrollTo(0, 0);

  for (const script of def.scripts) {
    const module = await LOADERS[script.src]();
    if (run !== generation) return; // navigated away while loading
    try {
      await Promise.resolve(module.default()).catch((error) => console.error(error));
    } catch (error) {
      console.error(error);
    }
  }
}

async function start() {
  store = await openStore();
  try {
    data = await store.load();
  } catch (error) {
    console.error('Test database read failed; using browser storage', error);
    store = browserStore();
    data = await store.load();
  }
  if (store.kind === 'browser') await store.save(data); // keep the seeded ids stable across reloads
  // Back from the background: other tabs or devices may have written meanwhile.
  // Reload what the database holds, between requests (never during a save).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || store.kind !== 'database') return;
    writes = writes.then(async () => {
      try {
        data = await store.load();
      } catch (error) {
        console.error('Test database refresh failed', error);
      }
    });
  });
  render();
}

start();
