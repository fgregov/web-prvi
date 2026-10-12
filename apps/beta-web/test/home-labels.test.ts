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

  it('the bottom navigation is unchanged (the same five items, no new one)', async () => {
    const { TABS } = await import('../public/app/js/ui/tabbar.js');
    expect(TABS.map((t: { href: string }) => t.href)).toEqual([
      '/dashboard',
      '/follow-up',
      '/leads',
      '/reports',
      '/more',
    ]);
  });
});
