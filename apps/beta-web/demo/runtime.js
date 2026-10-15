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
//   - Korisnici: the same user service, rules and API as the server. The demo
//     account is the organization's owner; members created here have no
//     password and never sign in (kept in this browser only).
import { createCrmApi } from '../server/crm/dispatch.js';
import { createFollowUpApi, VIEWER_PAGE } from '../server/crm/follow-up-api.js';
import { createCrmServices } from '../server/crm/index.js';
import { emptyData, normalizeData } from '../server/crm/repository.js';
import { seedDemoData } from '../server/crm/seed.js';
import { deriveShareKey } from '../server/crm/share-token.js';
import { ensureBootstrapOwner } from '../server/identity/bootstrap.js';
import { createLocalDirectory } from '../server/identity/local-directory.js';
import { createUserService, displayName } from '../server/identity/user-service.js';
import { createUsersApi } from '../server/identity/users-api.js';
import { DEMO_CONTENT } from '../app/js/core/edition.js';
import { legacyPath, pageForPath } from '../app/js/core/routes.js';
import { databaseStore } from './database-store.js';
import { indexedDbDocumentStore } from './document-store-idb.js';
import { LOADERS, PAGES, STYLES } from './pages.js';

const ORIGIN = 'https://demo.renvara.app';
const ORG = 'org-demo';
const USER = { id: 'demo-user', displayName: 'Demo korisnik' };
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Zagreb';
// Storage per edition: pages opened from disk share one browser storage, so the
// clean start and the presentation demo must not overwrite each other.
const PREFIX = DEMO_CONTENT ? 'renvara.demo' : 'renvara.clean';
const KEYS = {
  data: `${PREFIX}.crm.v1`,
  auth: `${PREFIX}.auth`,
  nav: `${PREFIX}.nav`,
  users: `${PREFIX}.users.v1`,
};
/** Where the clean start kept its records before it had a key of its own. */
const SHARED_DATA_KEY = 'renvara.demo.crm.v1';
const COLLECTIONS = [
  'customers',
  'contacts',
  'opportunities',
  'tasks',
  'activities',
  'leads',
  'offers',
  'offerDocuments',
  'offerShareLinks',
  'offerEvents',
  'reminders',
  'notificationPreferences',
  'notificationSettings',
  'notificationDeliveries',
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
        let saved = JSON.parse(local.get(KEYS.data) ?? 'null');
        if (!saved && !DEMO_CONTENT) {
          const shared = JSON.parse(local.get(SHARED_DATA_KEY) ?? 'null');
          if (shared?.edition === 'clean') saved = shared; // taken over once, then kept apart
        }
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

/** "Saving takes longer than usual": shown while the test database answers slowly. */
const slowNote = document.createElement('p');
slowNote.dataset.rvKeep = '';
slowNote.setAttribute('role', 'status');
slowNote.hidden = true;
slowNote.textContent = 'Testna baza odgovara sporo. Spremanje je u tijeku, ne zatvarajte stranicu.';
slowNote.setAttribute(
  'style',
  'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 12px);transform:translateX(-50%);' +
    'z-index:2147483000;max-width:calc(100% - 32px);box-sizing:border-box;margin:0;padding:10px 14px;' +
    'border-radius:12px;background:#111;color:#fff;font:600 13px/1.35 -apple-system,BlinkMacSystemFont,sans-serif;' +
    'box-shadow:0 8px 24px rgba(0,0,0,.2);text-align:center',
);
function showSlow(slow) {
  if (!slowNote.isConnected) document.body.append(slowNote);
  slowNote.hidden = !slow;
}

async function openStore() {
  const use = window.claude?.use;
  if (typeof use !== 'function') return browserStore();
  const db = await use.call(window.claude, 'db').catch(() => null);
  if (!db) return browserStore();
  return databaseStore(db, {
    collections: COLLECTIONS,
    empty: emptyData,
    onSlow: showSlow,
    // A write the save had given up on landed after all: continue from the
    // database (between requests, never during one).
    onLate: () => {
      writes = writes.then(() => {
        data = normalizeData(store.current());
      });
    },
  });
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
// Follow-up Engine: PDFs in this browser's IndexedDB. The link key is fixed and
// public (it is in this page): demo links protect nothing and open only here.
// Nothing delivers push here: MOBILNE OBAVIJESTI preferences are saved, nothing is queued.
const services = createCrmServices(repo, {
  notificationDelivery: false,
  followUp: {
    documents: indexedDbDocumentStore(),
    shareKey: deriveShareKey('renvara-demo-share-links:not-a-secret:v1'),
  },
});
// No server behind the demo: reminders are saved, push is never delivered (and says so).
const api = createCrmApi(services, {
  push: { configured: false, publicKey: null, demo: true },
});
const followUpApi = createFollowUpApi(services);

// ------------------------------------------------- Korisnici, in page ---
// Members, rights and their log: this browser only (never the shared test
// database). The rules are the server's: the user service checks every call.
function loadPeople() {
  try {
    const saved = JSON.parse(local.get(KEYS.users) ?? 'null');
    if (saved && Array.isArray(saved.users)) {
      return {
        users: saved.users,
        userPermissions: Array.isArray(saved.userPermissions) ? saved.userPermissions : [],
        auditLog: Array.isArray(saved.auditLog) ? saved.auditLog : [],
      };
    }
  } catch {
    /* a fresh start */
  }
  return { users: [], userPermissions: [], auditLog: [] };
}
let people = loadPeople();
const peopleRepo = {
  data: () => people,
  commit: () => local.set(KEYS.users, JSON.stringify(people)),
  replace(next) {
    people = next;
  },
  transaction(work) {
    const snapshot = structuredClone(people);
    try {
      return work();
    } catch (error) {
      people = snapshot;
      throw error;
    }
  },
};
ensureBootstrapOwner(peopleRepo, ORG, {
  userId: USER.id,
  displayName: USER.displayName,
  email: 'demo@renvara.app',
});
/** No accounts in the demo: nobody signs in with a password, no links are sent. */
const DEMO_ACCOUNTS = {
  kind: 'demo',
  verify: async () => null,
  confirm: async () => false,
  create: async () => ({ userId: globalThis.crypto.randomUUID(), link: { delivery: 'none' } }),
  remove: async () => {},
  setEmail: async () => {},
  setPassword: async () => {},
  passwordLink: async () => ({ delivery: 'none' }),
  linkUser: async () => null,
  completeLink: async () => null,
  setBlocked: async () => {},
  passwordState: async () => 'unavailable',
};
const users = createUserService({
  directory: createLocalDirectory(peopleRepo),
  accounts: DEMO_ACCOUNTS,
  sessions: { validAfter: () => 0, revokeAll() {} },
});
const usersApi = createUsersApi(users);

/** The demo account's rights, read for every request (as on the server). */
async function member() {
  return isSignedIn() ? users.access(ORG, USER.id) : null;
}
async function signedInContext() {
  const me = await member();
  return me ? { ...context(), access: me.access } : null;
}

async function answer(method, path, query, body) {
  if (path === '/api/auth/session') {
    const me = await member();
    if (!me) return [200, { authenticated: false }];
    const { id, firstName, lastName, email } = me.user;
    return [
      200,
      {
        authenticated: true,
        user: {
          id,
          displayName: displayName(me.user),
          firstName,
          lastName,
          email,
          role: me.access.role,
        },
        permissions: [...me.access.permissions],
      },
    ];
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
  if (path === '/api/users' || path.startsWith('/api/users/')) {
    const found = usersApi.match(method, path);
    if (found.kind === 'none') return [404, usersApi.badRequest];
    if (found.kind === 'method_not_allowed') return [405, usersApi.badRequest];
    const me = await member();
    if (!me) return [401, { success: false, message: 'Sesija je istekla. Prijavite se ponovno.' }];
    const result = await usersApi.run(found, {
      actor: { id: me.user.id, organizationId: ORG, ...me.access },
      query,
      body,
      origin: ORIGIN,
    });
    return [result.status, result.body];
  }
  const hit = api.match(method, path);
  if (hit.kind === 'none') return [404, api.badRequest];
  if (hit.kind === 'method_not_allowed') return [405, api.badRequest];
  const ctx = await signedInContext();
  if (!ctx) return [401, { success: false, message: 'Sesija je istekla. Prijavite se ponovno.' }];
  if (method === 'GET') {
    const result = api.run(hit, ctx, query, body);
    return [result.status, result.body];
  }

  // A write is only reported as saved once the store has it. Otherwise the page
  // continues from what the store really holds (the test database undoes a
  // partial save; browser storage simply keeps the state from before).
  const before = JSON.stringify(data);
  const result = api.run(hit, ctx, query, body);
  if (result.status < 400) {
    try {
      await store.save(data);
    } catch (error) {
      console.error('Test database write failed', error);
      data = store.current ? normalizeData(store.current()) : JSON.parse(before);
      return [503, { success: false, message: SAVE_FAILED }];
    }
  }
  return [result.status, result.body];
}

/** Saves after a write that succeeded; on failure continues from what the store holds. */
async function persist(before) {
  try {
    await store.save(data);
    return null;
  } catch (error) {
    console.error('Test database write failed', error);
    data = store.current ? normalizeData(store.current()) : JSON.parse(before);
    return [503, { success: false, message: SAVE_FAILED }];
  }
}

/** What the server reads from a request's headers to tell people from scanners. */
const clientHeaders = () => ({ userAgent: navigator.userAgent, purpose: null });

/**
 * Follow-up Engine requests (/api/follow-up/…, /o/{token}/…): the same API as
 * the BETA server, with files and binary bodies. Links are relative (/o/…):
 * the demo has no public address, so they open only inside this demo.
 */
async function answerFollowUp(method, path, query, headers, bytes) {
  const hit = followUpApi.match(method, path);
  if (hit.kind === 'none') return [404, followUpApi.badRequest];
  if (hit.kind === 'method_not_allowed') return [405, followUpApi.badRequest];
  let json = null;
  if (hit.route.body === 'json') {
    try {
      json = bytes?.length ? JSON.parse(new TextDecoder().decode(bytes)) : {};
    } catch {
      return [400, followUpApi.badRequest];
    }
  }
  const before = JSON.stringify(data);
  const result = await followUpApi.run(hit, {
    method,
    path,
    query,
    ctx: await signedInContext(),
    json,
    bytes: hit.route.body === 'pdf' ? bytes : null,
    headers: {
      contentType: headers.get('Content-Type'),
      fileName: headers.get('X-File-Name'),
      ...clientHeaders(),
    },
    internal: false, // in the demo the viewer plays the customer
    origin: '',
    now: new Date(),
  });
  if (method !== 'GET' && result.status < 400 && JSON.stringify(data) !== before) {
    const failed = await persist(before);
    if (failed) return failed;
  }
  if ('bytes' in result) {
    return [
      result.status,
      new Response(result.bytes, {
        status: result.status,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    ];
  }
  return [result.status, result.json];
}

/** Opening /o/{token} counts as "link opened", as on the server (saved like a write). */
function recordViewerAccess(token) {
  writes = writes.then(async () => {
    const before = JSON.stringify(data);
    try {
      await followUpApi.pageAccess(token, {
        method: 'GET',
        headers: clientHeaders(),
        now: new Date(),
        internal: false,
      });
    } catch (error) {
      console.error(error);
      return;
    }
    if (JSON.stringify(data) !== before) await persist(before);
  });
  return writes;
}

const jsonResponse = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

let writes = Promise.resolve(); // writes run one at a time, like a single server process
const realFetch = window.fetch.bind(window);
const isFollowUp = (url) => url.startsWith('/api/follow-up/') || url.startsWith('/o/');
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/') && !url.startsWith('/o/')) return realFetch(input, init);
  const method = (init.method ?? 'GET').toUpperCase();
  const run = async () => {
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
    const parsed = new URL(url, ORIGIN);
    if (isFollowUp(url)) {
      let bytes = null;
      if (init.body !== undefined && init.body !== null) {
        bytes =
          typeof init.body === 'string'
            ? new TextEncoder().encode(init.body)
            : new Uint8Array(await new Response(init.body).arrayBuffer());
      }
      const [status, payload] = await answerFollowUp(
        method,
        parsed.pathname,
        parsed.searchParams,
        new Headers(init.headers ?? {}),
        bytes,
      );
      return payload instanceof Response ? payload : jsonResponse(status, payload);
    }
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
// The app's pages and old addresses: core/routes.js, shared with the BETA server.
const ROUTES = { '/login': 'login', '/dashboard': 'dashboard' };

let nav = { stack: ['/login'], states: [null], index: 0 };
try {
  const saved = JSON.parse(session.get(KEYS.nav) ?? 'null');
  if (Array.isArray(saved?.stack) && saved.stack.length && Number.isInteger(saved.index))
    nav = { ...saved, states: Array.isArray(saved.states) ? saved.states : [] };
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
  if (mode === 'replace') {
    nav.stack[nav.index] = next;
    nav.states[nav.index] = null; // a new page in this entry: its own state
  } else {
    nav.stack = nav.stack.slice(0, nav.index + 1);
    nav.states = nav.states.slice(0, nav.index + 1);
    nav.stack.push(next);
    nav.states[nav.index + 1] = null;
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
    /** Per-entry state, like the browser's (e.g. which accordions are open). */
    get state() {
      return nav.states[nav.index] ?? null;
    },
    replaceState(state, _title, url) {
      nav.states[nav.index] = state === undefined ? null : JSON.parse(JSON.stringify(state));
      if (url) nav.stack[nav.index] = normalize(url);
      remember();
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
  if (VIEWER_PAGE.test(pathname)) return 'viewer'; // the customer's link: no sign-in
  return ROUTES[pathname] ?? pageForPath(pathname);
}

/** Like the server: an old address or a trailing slash → the page's address. */
function movedPath(pathname) {
  const trimmed = pathname.replace(/(.)\/+$/, '$1');
  return legacyPath(trimmed) ?? (trimmed !== pathname && pageFor(trimmed) ? trimmed : null);
}

const STORE_NOTE = {
  database:
    'Demo: prijava prihvaća bilo koje korisničko ime i lozinku. Kupci, kontakti, prilike, zadaci, leadovi i ponude spremaju se u testnu bazu ovog demoa; PDF dokumenti ponuda ostaju samo u ovom pregledniku.',
  browser: DEMO_CONTENT
    ? 'Demo s primjerima podataka: prijava prihvaća bilo koje korisničko ime i lozinku. Promjene se spremaju samo u ovom pregledniku, a primjeri se svaki dan vraćaju na početno stanje.'
    : 'Demo: prijava prihvaća bilo koje korisničko ime i lozinku. Testna baza ovdje nije dostupna, pa se podaci spremaju samo u ovom pregledniku.',
};

let generation = 0;
async function render() {
  const run = ++generation;
  const { pathname, search, hash } = parse(current());
  const moved = pathname === '/' ? null : movedPath(pathname);
  if (moved) return navigate(`${moved}${search}${hash}`, 'replace');
  // What the server does: unknown → page not found, protected → login, login while signed in → dashboard.
  const page = pageFor(pathname) ?? 'not-found';
  const open = ['login', 'viewer', 'not-found'];
  if (!open.includes(page) && !isSignedIn()) return navigate('/login', 'replace');
  if (page === 'login' && isSignedIn()) return navigate('/dashboard', 'replace');
  if (pathname === '/') return navigate(`/${page}`, 'replace');

  // Leave the previous page: its listeners, overlays and scroll lock.
  for (const [target, type, listener, options] of pageListeners) {
    target.removeEventListener(type, listener, options);
  }
  pageListeners = [];
  for (const node of [...document.body.children]) {
    if (node === root || 'rvKeep' in node.dataset) continue;
    if (!['SCRIPT', 'STYLE', 'TITLE', 'META'].includes(node.tagName)) node.remove();
  }
  document.documentElement.classList.remove('rv-scroll-lock');

  if (page === 'viewer') {
    const token = VIEWER_PAGE.exec(pathname)?.[1] ?? '';
    await recordViewerAccess(token);
    if (run !== generation) return;
  }

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
    data = normalizeData(await store.load());
  } catch (error) {
    console.error('Test database read failed; using browser storage', error);
    store = browserStore();
    data = normalizeData(await store.load());
  }
  if (store.kind === 'browser') await store.save(data); // keep the seeded ids stable across reloads
  // Back from the background: other tabs or devices may have written meanwhile.
  // Reload what the database holds, between requests (never during a save).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || store.kind !== 'database') return;
    writes = writes.then(async () => {
      try {
        data = normalizeData(await store.load());
      } catch (error) {
        console.error('Test database refresh failed', error);
      }
    });
  });
  render();
}

start();
