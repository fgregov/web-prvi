import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import type { BrowserContext, Download, Page } from 'playwright';
import { TIMEZONE } from '../config.js';
import { settle, type PortalSession } from './browser.js';
import type { DatasetConfig } from './config.js';
import { resolvePortalPath } from './urlPolicy.js';

export interface Period {
  from: string; // YYYY-MM-DD (Europe/Zagreb)
  to: string;
}

export type Extracted =
  | { kind: 'file'; fileName: string; buffer: Buffer; sourceUrl: string }
  | { kind: 'table'; rows: string[][]; sourceUrl: string; pages: number };

/** Zamjenjuje {from:FORMAT} i {to:FORMAT} datumima razdoblja (lokalno vrijeme). */
export function applyTemplate(template: string, period: Period | null, encode: boolean): string {
  return template.replace(/\{(from|to)(?::([^}]+))?\}/g, (_m, which: 'from' | 'to', fmt?: string) => {
    if (!period) throw new Error('Predložak traži razdoblje, a razdoblje nije zadano.');
    const d = DateTime.fromISO(period[which], { zone: TIMEZONE });
    const out = fmt ? d.toFormat(fmt) : d.toISODate()!;
    return encode ? encodeURIComponent(out) : out;
  });
}

function triggerLocator(page: Page, t: NonNullable<DatasetConfig['exportTrigger']>) {
  if (t.by === 'selector') return page.locator(t.value).first();
  return page
    .getByRole('button', { name: t.value, exact: false })
    .or(page.getByRole('link', { name: t.value, exact: false }))
    .or(page.getByText(t.value, { exact: false }))
    .first();
}

async function waitDownloadAnywhere(context: BrowserContext, page: Page, timeout: number): Promise<Download> {
  return new Promise<Download>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Izvoz nije pokrenuo preuzimanje datoteke (timeout).')), timeout);
    const done = (d: Download) => {
      clearTimeout(timer);
      resolve(d);
    };
    page.once('download', done);
    context.once('page', (p) => p.once('download', done));
  });
}

const FILE_TYPES = /text\/csv|application\/vnd\.ms-excel|spreadsheetml|application\/octet-stream|text\/plain|application\/csv/i;

/**
 * Preuzima podatke jednog skupa prema konfiguraciji izvora: izvozom datoteke (CSV/XLSX – prednost)
 * ili čitanjem tablice sa stranice. Sve adrese se provjeravaju prema dopuštenoj domeni portala.
 */
export async function extractDataset(
  session: PortalSession,
  cfg: DatasetConfig,
  period: Period | null,
  timeoutMs: number,
): Promise<Extracted> {
  const { page, context, policy, log } = session;
  if (!cfg.pageUrl) throw new Error('Za ovaj skup podataka nije postavljena adresa stranice.');
  const url = resolvePortalPath(policy, applyTemplate(cfg.pageUrl, period, true));

  // Izravna poveznica na datoteku (bez gumba): preuzimanje kroz isti kontekst (isti kolačići)
  if (cfg.method === 'export' && !cfg.exportTrigger && !cfg.fills.length && !cfg.applyTrigger) {
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      const resp = await context.request.get(current, { maxRedirects: 0, timeout: timeoutMs });
      if (resp.status() >= 300 && resp.status() < 400) {
        const loc = resp.headers()['location'];
        if (!loc) throw new Error('Preusmjeravanje bez odredišta.');
        current = resolvePortalPath(policy, new URL(loc, current).toString());
        continue;
      }
      if (resp.status() >= 500) throw new Error(`HTTP ${resp.status()} pri preuzimanju izvoza.`);
      if (resp.status() !== 200) throw new Error(`Portal je vratio HTTP ${resp.status()} za adresu izvoza.`);
      const ct = resp.headers()['content-type'] ?? '';
      const cd = resp.headers()['content-disposition'] ?? '';
      if (/text\/html/i.test(ct) && !/attachment/i.test(cd)) {
        throw new Error('Adresa izvoza vratila je HTML stranicu umjesto datoteke (možda je sesija istekla).');
      }
      if (!FILE_TYPES.test(ct) && !/attachment/i.test(cd)) log.warn(`Neočekivan tip sadržaja izvoza: ${ct}`);
      const nameMatch = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const fileName = decodeURIComponent(nameMatch?.[1] ?? path.basename(new URL(current).pathname) ?? 'izvoz');
      const body = await resp.body();
      log.info(`Preuzeta datoteka ${fileName} (${body.length} B).`);
      return { kind: 'file', fileName, buffer: body, sourceUrl: current };
    }
    throw new Error('Previše preusmjeravanja pri preuzimanju izvoza.');
  }

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await settle(page, timeoutMs);
  for (const f of cfg.fills) {
    const value = applyTemplate(f.value, period, false);
    await page.locator(f.selector).first().fill(value);
    log.info(`Popunjeno polje ${f.selector}.`);
  }
  if (cfg.applyTrigger) {
    await triggerLocator(page, cfg.applyTrigger).click();
    await settle(page, timeoutMs);
  }

  if (cfg.method === 'export') {
    if (!cfg.exportTrigger) throw new Error('Nije definiran gumb za izvoz.');
    const dlPromise = waitDownloadAnywhere(context, page, timeoutMs);
    await triggerLocator(page, cfg.exportTrigger).click();
    const download = await dlPromise;
    const failure = await download.failure();
    if (failure) throw new Error(`Preuzimanje izvoza nije uspjelo: ${failure}`);
    const target = path.join(session.downloadsDir, `export-${Date.now()}`);
    await download.saveAs(target);
    const buffer = fs.readFileSync(target);
    fs.rmSync(target, { force: true });
    log.info(`Preuzeta datoteka ${download.suggestedFilename()} (${buffer.length} B).`);
    return { kind: 'file', fileName: download.suggestedFilename(), buffer, sourceUrl: download.url() };
  }

  // Čitanje tablice (kad izvoz nije dostupan)
  if (!cfg.tableSelector) throw new Error('Nije definiran selektor tablice.');
  const all: string[][] = [];
  let pages = 0;
  for (let i = 0; i < cfg.maxPages; i++) {
    const table = page.locator(cfg.tableSelector).first();
    await table.waitFor({ state: 'visible', timeout: timeoutMs });
    const rows = await table.evaluate((t: Element) =>
      Array.from(t.querySelectorAll('tr'))
        .map((tr) => Array.from(tr.children).map((c) => ((c as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ')))
        .filter((r) => r.some((c) => c !== '')),
    );
    pages++;
    if (i === 0) all.push(...rows);
    else all.push(...rows.slice(1)); // zaglavlje se ponavlja na svakoj stranici
    if (!cfg.nextPageSelector) break;
    const next = page.locator(cfg.nextPageSelector).first();
    if (!(await next.isVisible().catch(() => false)) || !(await next.isEnabled().catch(() => false))) break;
    const signature = JSON.stringify(rows.slice(1, 3));
    await next.click();
    await settle(page, timeoutMs);
    const after = await page
      .locator(cfg.tableSelector)
      .first()
      .evaluate((t: Element) => Array.from(t.querySelectorAll('tr')).slice(1, 3).map((tr) => Array.from(tr.children).map((c) => ((c as HTMLElement).innerText || '').trim().replace(/\s+/g, ' '))))
      .catch(() => []);
    if (JSON.stringify(after) === signature) break; // stranica se nije promijenila
  }
  log.info(`Pročitana tablica: ${Math.max(0, all.length - 1)} redaka (${pages} str.).`);
  return { kind: 'table', rows: all, sourceUrl: page.url(), pages };
}
