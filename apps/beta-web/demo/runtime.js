// Renvara demo runtime: the real BETA pages in one static page.
//
//   - Router: an in-page history stack replaces server routes and page loads.
//     Page modules export run(); the router renders a page's HTML and runs it.
//   - Server: fetch('/api/…') is answered in the page by the same CRM services
//     and API routes as apps/beta-web, on data kept in this browser.
//   - Login accepts any username and password; nothing is sent anywhere.
import { createCrmApi } from '../server/crm/dispatch.js';
import { createCrmServices } from '../server/crm/index.js';
import { seedDemoData } from '../server/crm/seed.js';
import { PAGES } from './pages.js';

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
const LATENCY_MS = 140; // makes loading states visible, like a real request

// ------------------------------------------------------------- storage ---
const memory = new Map();
const storage = {
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
      /* private mode: memory only */
    }
  },
};

const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
const context = () => ({ organizationId: ORG, user: USER, timeZone: TIME_ZONE, now: new Date() });

// ----------------------------------------------------- server, in page ---
/** Demo data is dated relative to "today", so it is re-seeded once a day. */
function loadData() {
  try {
    const saved = JSON.parse(storage.get(KEYS.data) ?? 'null');
    if (saved?.seededOn === todayKey() && saved.data?.version === 2) return saved.data;
  } catch {
    /* fall through to a fresh seed */
  }
  return seedDemoData(context());
}

let data = loadData();
const save = () => storage.set(KEYS.data, JSON.stringify({ seededOn: todayKey(), data }));
save();
const repo = {
  data: () => data,
  commit: save,
  replace(next) {
    data = next;
    save();
  },
};
const api = createCrmApi(createCrmServices(repo));

const isSignedIn = () => storage.get(KEYS.auth) === 'yes';

function answer(method, path, query, body) {
  if (path === '/api/auth/session') {
    return isSignedIn()
      ? [200, { authenticated: true, user: USER }]
      : [200, { authenticated: false }];
  }
  if (path === '/api/auth/login') {
    if (!String(body.username ?? '').trim() || !body.password) {
      return [400, { success: false, message: 'Unesite korisničko ime i lozinku.' }];
    }
    storage.set(KEYS.auth, 'yes');
    return [200, { success: true, redirectTo: '/dashboard' }];
  }
  if (path === '/api/auth/logout') {
    storage.set(KEYS.auth, 'no');
    return [200, { success: true, redirectTo: '/login' }];
  }
  const hit = api.match(method, path);
  if (hit.kind === 'none') return [404, api.badRequest];
  if (hit.kind === 'method_not_allowed') return [405, api.badRequest];
  if (!isSignedIn())
    return [401, { success: false, message: 'Sesija je istekla. Prijavite se ponovno.' }];
  const result = api.run(hit, context(), query, body);
  return [result.status, result.body];
}

const jsonResponse = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  const parsed = new URL(url, ORIGIN);
  let body = {};
  try {
    body = init.body ? JSON.parse(init.body) : {};
  } catch {
    return jsonResponse(400, api.badRequest);
  }
  const [status, payload] = answer(
    (init.method ?? 'GET').toUpperCase(),
    parsed.pathname,
    parsed.searchParams,
    body,
  );
  return jsonResponse(status, payload);
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
};
const PATTERNS = [
  [/^\/customers\/[A-Za-z0-9_-]{1,64}$/, 'customer'],
  [/^\/tasks\/[A-Za-z0-9_-]{1,64}$/, 'task'],
  [/^\/tasks\/[A-Za-z0-9_-]{1,64}\/edit$/, 'task-form'],
];

let nav = { stack: ['/login'], index: 0 };
try {
  const saved = JSON.parse(window.sessionStorage.getItem(KEYS.nav) ?? 'null');
  if (Array.isArray(saved?.stack) && saved.stack.length) nav = saved;
} catch {
  /* start at the login */
}
const current = () => nav.stack[nav.index];
const remember = () => {
  try {
    window.sessionStorage.setItem(KEYS.nav, JSON.stringify(nav));
  } catch {
    /* memory only */
  }
};
const parse = (url) => new URL(url, ORIGIN);
const normalize = (url) => {
  const u = new URL(url, ORIGIN + current());
  return `${u.pathname}${u.search}${u.hash}`;
};

let pending = null;
function navigate(url, mode) {
  const next = normalize(url);
  if (mode === 'replace') nav.stack[nav.index] = next;
  else {
    nav.stack = nav.stack.slice(0, nav.index + 1);
    nav.stack.push(next);
    nav.index += 1;
  }
  remember();
  // Like a real navigation: code after location.replace() still runs first.
  clearTimeout(pending);
  pending = setTimeout(render, 0);
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
    reload: () => render(),
  },
  history: {
    get length() {
      return nav.index + 1;
    },
    back() {
      if (nav.index === 0) return;
      nav.index -= 1;
      remember();
      clearTimeout(pending);
      pending = setTimeout(render, 0);
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
const styleLinks = new Map();
function useStyles(hrefs) {
  for (const href of hrefs) {
    if (styleLinks.has(href)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
    styleLinks.set(href, link);
  }
  // Fixed order keeps the cascade identical to the real pages.
  const order = [
    'https://fonts',
    'login/',
    'home/',
    'app/css/components',
    'app/css/pages',
    'app/css/screen',
  ];
  const rank = (href) => order.findIndex((prefix) => href.startsWith(prefix));
  for (const [href, link] of [...styleLinks].sort((a, b) => rank(a[0]) - rank(b[0]))) {
    link.disabled = !hrefs.includes(href);
    document.head.append(link);
  }
}

function pageFor(pathname) {
  if (pathname === '/' || pathname === '') return isSignedIn() ? 'dashboard' : 'login';
  return ROUTES[pathname] ?? PATTERNS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

let generation = 0;
async function render() {
  const run = ++generation;
  const { pathname } = parse(current());
  let page = pageFor(pathname);
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
    if (node !== root && node.tagName !== 'SCRIPT' && !node.hasAttribute('data-rv-keep'))
      node.remove();
  }
  document.documentElement.classList.remove('rv-scroll-lock');

  const def = PAGES[page];
  useStyles(def.styles);
  document.title = def.title;
  root.innerHTML = def.html;
  window.scrollTo(0, 0);

  for (const script of def.scripts) {
    const module = await import(`../${script.src}`);
    if (run !== generation) return; // navigated away while loading
    try {
      await Promise.resolve(module.default()).catch((error) => console.error(error));
    } catch (error) {
      console.error(error);
    }
  }
}

render();
