// The web app's navigation (ADR-0013): one sidebar on every page, with the
// items, order and addresses of the master prompt; old addresses keep working.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  legacyPath,
  navKeyForPath,
  PAGE_ROUTES,
  pageForPath,
} from '../public/app/js/core/routes.js';

const here = (path: string) => resolve(import.meta.dirname, path);
const read = (path: string) => readFileSync(here(path), 'utf8');
const PAGES = readdirSync(here('../public/app/pages')).map((f) => `../public/app/pages/${f}`);
const HOME = '../../../prototypes/home/index.html';

type Item = { key: string; label: string; href?: string; icon: string; children?: Item[] };

describe('sidebar', () => {
  it('has the items of the master prompt, in its order, with their addresses', async () => {
    const { NAV, SETTINGS } = await import('../public/app/js/ui/app-shell.js');
    const tree = (items: Item[]): unknown[] =>
      items.map((item) =>
        item.children ? [item.label, item.icon, tree(item.children)] : [item.label, item.href],
      );
    expect(tree(NAV)).toEqual([
      ['Početna', '/dashboard'],
      ['Follow-up engine', '/follow-up'],
      [
        'Prodaja',
        'briefcase-business',
        [
          ['Leads', '/sales/leads'],
          ['Prilike', '/sales/opportunities'],
          ['Zadaci', '/sales/tasks'],
          ['Kupci', '/sales/customers'],
        ],
      ],
      [
        'Prikaz više',
        'layout-grid',
        [
          ['Sales kalendar', '/sales-calendar'],
          ['Opportunity pipeline', '/opportunity-pipeline'],
          ['Feedback overview', '/feedback-overview'],
        ],
      ],
      ['Izvještaji', '/reports'],
      ['Korisnici', '/users'],
    ]);
    expect(NAV.find((i: Item) => i.key === 'reports')?.icon).toBe('chart-column');
    expect(NAV.find((i: Item) => i.key === 'users')?.icon).toBe('users');
    expect([SETTINGS.label, SETTINGS.href]).toEqual(['Postavke', '/settings']);
  });

  it('lists every item once, and every item is a page', async () => {
    const { NAV, SETTINGS } = await import('../public/app/js/ui/app-shell.js');
    const leaves = [...NAV.flatMap((i: Item) => i.children ?? [i]), SETTINGS];
    const hrefs = leaves.map((i: Item) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(leaves.map((i: Item) => i.key)).size).toBe(leaves.length);
    for (const item of leaves) {
      if (item.href !== '/dashboard') expect(pageForPath(item.href!), item.href).not.toBeNull();
      expect(navKeyForPath(item.href!), item.href).toBe(item.key);
    }
  });

  it('marks forms and records under their list', () => {
    for (const [path, key] of [
      ['/sales/leads/new', 'leads'],
      ['/sales/leads/5b9ab8be-8c2d-4ac0-81d4-7b0f97876330', 'leads'],
      ['/sales/leads/abc/convert', 'leads'],
      ['/sales/opportunities/new', 'opportunities'],
      ['/sales/opportunities/abc', 'opportunities'],
      ['/sales/tasks/abc/edit', 'tasks'],
      ['/sales/customers/new', 'customers'],
      ['/sales/contacts/new', 'customers'],
      ['/follow-up/abc/preview', 'follow-up'],
    ]) {
      expect(navKeyForPath(path), path).toBe(key);
    }
    expect(navKeyForPath('/login')).toBeNull();
  });

  it('is mounted on every app page; no bottom navigation, no floating "+"', () => {
    const scripts = readdirSync(here('../public/app/js/pages')).filter((f) => f.endsWith('.js'));
    for (const file of scripts) {
      const code = read(`../public/app/js/pages/${file}`);
      // Forms and record screens mount it through ui/screen.js.
      expect(
        code.includes('mountAppShell()') || /from '\.\.\/ui\/screen\.js'/.test(code),
        file,
      ).toBe(true);
    }
    for (const page of [...PAGES, HOME]) {
      const html = read(page);
      expect(html, page).not.toContain('class="tabbar"');
      expect(html, page).not.toContain('class="fab"');
      expect(html, page).not.toContain('id="shell"');
    }
  });
});

describe('addresses', () => {
  it('every page in the table has its HTML shell', () => {
    const files = new Set(readdirSync(here('../public/app/pages')));
    for (const page of new Set(Object.values(PAGE_ROUTES))) {
      expect(files.has(`${page}.html`), page).toBe(true);
    }
  });

  it('old addresses lead to the page they are now', () => {
    expect(legacyPath('/customers')).toBe('/sales/customers');
    expect(legacyPath('/customers/abc')).toBe('/sales/customers/abc');
    expect(legacyPath('/opportunities')).toBe('/opportunity-pipeline');
    expect(legacyPath('/opportunities/new')).toBe('/sales/opportunities/new');
    expect(legacyPath('/calendar')).toBe('/sales-calendar');
    expect(legacyPath('/notifications')).toBe('/settings');
    expect(legacyPath('/more')).toBe('/dashboard');
    expect(legacyPath('/sales/customers')).toBeNull();
    expect(legacyPath('/dashboard')).toBeNull();
    expect(legacyPath('/customers-x')).toBeNull();
  });

  it('the app links to the new addresses, not the old ones', () => {
    const old =
      /['"`=]\/(customers|contacts|opportunities|tasks|leads|calendar|notifications|more)(?=['"`?#/&])/;
    const sources = (dir: string): string[] =>
      readdirSync(here(dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? sources(`${dir}/${entry.name}`)
          : /\.(js|html)$/.test(entry.name)
            ? [`${dir}/${entry.name}`]
            : [],
      );
    for (const file of [...sources('../public/app'), HOME, '../../../prototypes/home/app.js']) {
      if (file.endsWith('core/routes.js')) continue; // the old addresses themselves
      expect(read(file).match(old)?.[0] ?? null, file).toBeNull();
    }
  });
});

describe('web.css', () => {
  it('is the last stylesheet of every app page and of Home', () => {
    for (const page of [...PAGES, HOME]) {
      const links = [...read(page).matchAll(/rel="stylesheet"\s+href="([^"]+)"/g)];
      expect(links.at(-1)?.[1], page).toBe('/app/css/web.css');
    }
  });

  it('switches between the sidebar and the drawer at 1024 px', () => {
    const css = read('../public/app/css/web.css');
    expect(css).toContain('@media (min-width: 1024px)');
    expect(css).toContain('@media (max-width: 1023.98px)');
    expect(css).not.toMatch(/\.tabbar|\.fab\b|\.quick-add/);
  });
});
