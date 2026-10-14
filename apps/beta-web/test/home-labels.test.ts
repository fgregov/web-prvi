// Home dashboard labels: the priority tasks module and its link (UI text only,
// same destination), and the Feedback overview link to its own screen.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), 'utf8');
const home = read('../../../prototypes/home/index.html');
const history = read('../public/app/js/features/dashboard/history-view.js');

/** The module's <section> in the Home page, by its heading id. */
const moduleOf = (headingId: string) => {
  const start = home.indexOf(`aria-labelledby="${headingId}"`);
  return home.slice(start, home.indexOf('</section>', start));
};

describe('PRIORITETNI ZADACI (Home)', () => {
  const module = moduleOf('prioriteti-title');

  it('is labelled "Prioritetni zadaci" (shown upper-case) with "Pogledaj sve zadatke"', () => {
    expect(module).toContain(
      '<h2 class="module__title" id="prioriteti-title">Prioritetni zadaci</h2>',
    );
    expect(module).toMatch(/<a class="module__link" href="\/tasks"\s*>Pogledaj sve zadatke<svg/);
    expect(module).not.toMatch(/>Pogledaj sve<svg/);
  });

  it('the historical view uses the same labels and the same destination', () => {
    expect(history).toContain("title: 'Prioritetni zadaci'");
    expect(history).toContain("link: { label: 'Pogledaj sve zadatke', href: '/tasks' }");
    expect(history).not.toContain("title: 'Zadaci'");
  });

  it('leaves "Zadaci" elsewhere as it is (navigation, task list, customer profile)', () => {
    expect(read('../public/app/js/ui/shell.js')).toContain("label: 'Zadaci'");
    expect(read('../public/app/js/pages/tasks.js')).toContain("'Zadaci'");
    expect(read('../public/app/js/features/customers/profile/customer-tasks.js')).toContain(
      "title: 'Zadaci'",
    );
  });
});

describe('Home header (UPDATE 08)', () => {
  const header = home.slice(home.indexOf('<header class="app-header">'), home.indexOf('</header>'));

  it('has no notification bell; logo, title and avatar stay', () => {
    expect(header).not.toMatch(/bell|Obavijesti/);
    expect(home).not.toContain('i-bell');
    expect(header).toContain('class="brand__name">RENVARA</span>');
    expect(header).toContain('class="avatar"');
  });

  it('the avatar menu keeps the name and Odjava, without Obavijesti', () => {
    const menu = header.slice(header.indexOf('id="account-menu"'));
    expect(menu).not.toContain('data-notifications');
    expect(
      [...menu.matchAll(/role="menuitem"[^>]*>[\s\S]*?<\/svg>([^<]+)</g)].map((m) =>
        (m[1] ?? '').trim(),
      ),
    ).toEqual(['Odjava']);
    expect(menu).toContain('data-account-name');
  });
});

describe('Feedback overview (Home) links to its own screen', () => {
  it('"Svi" opens /feedback-overview, not the customer list', () => {
    const module = moduleOf('odgovor-title');
    expect(module).toMatch(/<a class="module__link" href="\/feedback-overview"\s*>Svi<svg/);
    expect(module).not.toContain('href="/customers"');
    expect(history).toContain("link: { label: 'Svi', href: '/feedback-overview' }");
  });

  it('a row opens the offer on its customer, with the offer id', async () => {
    const { offerHref } = await import('../public/app/js/features/dashboard/feedback-overview.js');
    expect(offerHref({ companyId: 'c 1', offerId: 'o/2' })).toBe(
      '/customers/c%201?offer=o%2F2#prilike',
    );
  });

  it('the bottom navigation: five items, Obavijesti in place of Izvještaji (now under Više)', async () => {
    const { TABS } = await import('../public/app/js/ui/tabbar.js');
    type Tab = { href: string; label: string; icon: string };
    expect(TABS.map((t: Tab) => [t.href, t.label, t.icon])).toEqual([
      ['/dashboard', 'Početna', 'home'],
      ['/follow-up', 'Follow-up Engine', 'repeat'],
      ['/leads', 'Leads', 'users'],
      ['/notifications', 'Obavijesti', 'bell'],
      ['/more', 'Više', 'ellipsis'],
    ]);
  });
});
