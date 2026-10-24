import type { Page } from 'playwright';
import { settle, type StepLog } from './browser.js';
import { ANALYZE_PAGE_SCRIPT, type PageAnalysis } from './pageScripts.js';
import { hostMatches, type PortalPolicy } from './urlPolicy.js';

export interface DiscoveredPage {
  url: string;
  path: string;
  linkText: string | null;
  title: string;
  heading: string | null;
  tables: PageAnalysis['tables'];
  grids: PageAnalysis['grids'];
  exports: PageAnalysis['exports'];
  dateInputs: PageAnalysis['dateInputs'];
  error?: string;
}

export interface DiscoveryReport {
  startedAt: string;
  finishedAt: string;
  landingUrl: string;
  landingTitle: string;
  navigation: { text: string; path: string }[];
  pages: DiscoveredPage[];
  skippedLinks: { text: string; path: string; reason: string }[];
  blockedRequests: string[];
  summary: {
    pagesVisited: number;
    pagesWithTables: number;
    pagesWithExports: number;
    exportCandidates: number;
  };
}

/**
 * Istraživanje portala nakon prijave: obilazi poveznice iz izbornika (samo GET navigacija,
 * bez klikanja na gumbe) i bilježi tablice, mogućnosti izvoza i polja za razdoblje.
 * Poveznice koje bi mogle mijenjati podatke (odjava, brisanje, spremanje...) se preskaču.
 * Ništa se ne pretpostavlja – izvještaj služi korisniku za konfiguraciju izvora podataka.
 */
export async function discoverPortal(
  page: Page,
  policy: PortalPolicy,
  opts: { maxPages: number; delayMs: number; log: StepLog },
): Promise<DiscoveryReport> {
  const startedAt = new Date().toISOString();
  await settle(page);
  const landing = (await page.evaluate(ANALYZE_PAGE_SCRIPT)) as PageAnalysis;
  const allowed = (href: string) => {
    try {
      const u = new URL(href);
      return policy.navigationHosts.some((p) => hostMatches(u.hostname, p)) && (u.protocol === 'https:' || policy.allowTestTargets);
    } catch {
      return false;
    }
  };
  const keyOf = (href: string) => {
    const u = new URL(href);
    return `${u.pathname}${u.search}`;
  };
  const seen = new Set<string>([keyOf(page.url())]);
  const queue: { text: string; href: string }[] = [];
  const skipped: DiscoveryReport['skippedLinks'] = [];
  const nav: DiscoveryReport['navigation'] = [];
  // Najprije poveznice iz navigacije, zatim ostale
  const ordered = [...landing.links.filter((l) => l.inNav), ...landing.links.filter((l) => !l.inNav)];
  for (const l of ordered) {
    if (!allowed(l.href)) continue;
    const k = keyOf(l.href);
    if (l.dangerous) {
      skipped.push({ text: l.text, path: k, reason: 'moguća izmjena podataka ili odjava' });
      continue;
    }
    if (/\.(csv|xlsx?|zip|pdf)(\?|$)/i.test(k)) {
      skipped.push({ text: l.text, path: k, reason: 'izravna poveznica na datoteku (kandidat za izvoz)' });
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    if (l.inNav) nav.push({ text: l.text, path: k });
    queue.push({ text: l.text, href: l.href });
  }
  const pages: DiscoveredPage[] = [
    {
      url: landing.url,
      path: keyOf(landing.url),
      linkText: null,
      title: landing.title,
      heading: landing.heading,
      tables: landing.tables,
      grids: landing.grids,
      exports: landing.exports,
      dateInputs: landing.dateInputs,
    },
  ];
  opts.log.info(`Početna stranica: „${landing.title}”, pronađeno ${queue.length} poveznica za obilazak.`);
  for (const item of queue.slice(0, opts.maxPages)) {
    await page.waitForTimeout(opts.delayMs);
    try {
      await page.goto(item.href, { waitUntil: 'domcontentloaded' });
      await settle(page, 15_000);
      const a = (await page.evaluate(ANALYZE_PAGE_SCRIPT)) as PageAnalysis;
      pages.push({
        url: a.url,
        path: keyOf(a.url),
        linkText: item.text,
        title: a.title,
        heading: a.heading,
        tables: a.tables,
        grids: a.grids,
        exports: a.exports,
        dateInputs: a.dateInputs,
      });
      opts.log.info(`Obiđeno: ${keyOf(a.url)} – tablica: ${a.tables.length}, izvoza: ${a.exports.length}`);
    } catch (e) {
      pages.push({
        url: item.href,
        path: keyOf(item.href),
        linkText: item.text,
        title: '',
        heading: null,
        tables: [],
        grids: [],
        exports: [],
        dateInputs: [],
        error: (e as Error).message.slice(0, 300),
      });
      opts.log.warn(`Stranica ${keyOf(item.href)} nije učitana: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  for (const item of queue.slice(opts.maxPages)) {
    skipped.push({ text: item.text, path: keyOf(item.href), reason: 'dosegnut maksimalan broj stranica' });
  }
  const exportCandidates = pages.reduce((n, p) => n + p.exports.length, 0);
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    landingUrl: landing.url,
    landingTitle: landing.title,
    navigation: nav,
    pages,
    skippedLinks: skipped,
    blockedRequests: [...opts.log.blocked],
    summary: {
      pagesVisited: pages.length,
      pagesWithTables: pages.filter((p) => p.tables.length || p.grids.length).length,
      pagesWithExports: pages.filter((p) => p.exports.length).length,
      exportCandidates,
    },
  };
}
