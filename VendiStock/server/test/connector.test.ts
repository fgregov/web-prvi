/**
 * Testovi mehanizma Televend konektora na LOKALNOM TESTNOM PORTALU (test/fixtures/mockPortal.ts).
 * Ovi testovi dokazuju da prijava, prepoznavanje MFA/CAPTCHA, istraživanje, izvoz, uvoz i ponavljanje rade
 * kako je predviđeno – NE dokazuju povezivanje sa stvarnim Televend Cloudom (to nije bilo moguće testirati).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { defaultDatasetConfig, getConnectorConfig, getConnectorStatus, saveConnectorConfig, type DatasetConfig } from '../src/televend/config.js';
import { MOCK_CREDENTIALS, startMockPortal, type MockPortal, type PortalMode } from './fixtures/mockPortal.js';
import { ACTOR, makeContext } from './helpers.js';
import type { AppContext } from '../src/context.js';

const TEST_TELEVEND = { allowedHosts: [], extraNavigationHosts: [], browserExecutable: null, allowTestTargets: true };
const portals: MockPortal[] = [];
afterEach(async () => {
  while (portals.length) await portals.pop()!.close();
});

const today = DateTime.now().setZone('Europe/Zagreb');
const localAt = (daysAgo: number, time: string) => `${today.minus({ days: daysAgo }).toFormat('dd.MM.yyyy')} ${time}`;

async function setup(mode: PortalMode = 'normal', password = MOCK_CREDENTIALS.password, path = '/login') {
  const portal = await startMockPortal(mode);
  portals.push(portal);
  const ctx = await makeContext({ televend: TEST_TELEVEND });
  await ctx.televend.saveSettings(
    { portalUrl: `${portal.url}${path}`, username: MOCK_CREDENTIALS.username, password, autoSync: true, intervalMinutes: 15, navigationTimeoutSeconds: 15 },
    ACTOR,
  );
  return { portal, ctx };
}

function resetManualLimit(ctx: AppContext) {
  (ctx.televend as unknown as { manualAttempts: number[] }).manualAttempts = [];
}

const salesSource = (): DatasetConfig => ({
  ...defaultDatasetConfig(),
  enabled: true,
  method: 'export',
  pageUrl: '/reports/sales?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}',
  exportTrigger: { by: 'text', value: 'Izvoz u CSV' },
  columns: { transactionId: 'Broj', soldAt: 'Vrijeme', machineName: 'Uređaj', productName: 'Proizvod', quantity: 'Količina', amount: 'Iznos', status: 'Status' },
});

const machinesSource = (): DatasetConfig => ({
  ...defaultDatasetConfig(),
  enabled: true,
  method: 'table',
  pageUrl: '/machines',
  tableSelector: 'table#machines',
  nextPageSelector: '#next',
  columns: { machineId: 'ID', machineName: 'Naziv', location: 'Lokacija' },
});

function configureSources(ctx: AppContext) {
  const cfg = getConnectorConfig(ctx.db);
  cfg.datasets.sales = salesSource();
  cfg.datasets.machines = machinesSource();
  saveConnectorConfig(ctx.db, cfg);
}

describe('Prijava u portal (heuristika obrasca, bez zaobilaženja zaštite)', () => {
  it('uspješna prijava sprema šifriranu sesiju i status „Povezano”', async () => {
    const { ctx, portal } = await setup();
    const r = await ctx.televend.testConnection(ACTOR);
    expect(r.result.status).toBe('ok');
    expect(portal.loginAttempts).toBe(1);
    expect(getConnectorStatus(ctx.db)).toMatchObject({ state: 'connected', lastLoginOk: true });
    const raw = ctx.db.prepare("SELECT ciphertext FROM secrets WHERE name = 'televend.session'").get() as { ciphertext: string };
    expect(raw.ciphertext.startsWith('v1:')).toBe(true);
    expect(raw.ciphertext).not.toContain('sid');
    // ponovna uporaba sesije – bez nove prijave
    resetManualLimit(ctx);
    const r2 = await ctx.televend.testConnection(ACTOR);
    expect(r2.result.status).toBe('already_logged_in');
    expect(portal.loginAttempts).toBe(1);
  });

  it('pogrešna lozinka: jedan pokušaj, bez automatskog ponavljanja; nakon 2 neuspjeha obustava automatske sinkronizacije', async () => {
    const { ctx, portal } = await setup('normal', 'KrivaLozinka!9');
    configureSources(ctx);
    const r = await ctx.televend.testConnection(ACTOR);
    expect(r.result.status).toBe('invalid_credentials');
    expect(r.result.message).toContain('Neispravno korisničko ime ili lozinka');
    expect(getConnectorStatus(ctx.db)).toMatchObject({ state: 'auth_failed', consecutiveAuthFailures: 1, autoSyncSuspended: false });
    const s = await ctx.televend.syncNow('auto');
    expect(s?.status).toBe('failed');
    expect(portal.loginAttempts).toBe(2); // točno jedan pokušaj po radnji – nema ponavljanja
    expect(getConnectorStatus(ctx.db)).toMatchObject({ consecutiveAuthFailures: 2, autoSyncSuspended: true });
    expect(ctx.televend.autoSyncDue(Date.now() + 3600_000)).toBe(false);
  });

  it('MFA se prepoznaje i ne zaobilazi; ručna kontrolirana sesija dovršava prijavu', async () => {
    const { ctx, portal } = await setup('mfa');
    const r = await ctx.televend.testConnection(ACTOR);
    expect(r.result.status).toBe('mfa_required');
    expect(getConnectorStatus(ctx.db)).toMatchObject({ state: 'mfa_required', autoSyncSuspended: true });
    // Ručna sesija: korisnik sam unosi podatke i MFA kod
    await ctx.televend.manual.start(ACTOR);
    const page = (ctx.televend.manual as unknown as { session: { page: import('playwright').Page } }).session.page;
    const box = async (sel: string) => {
      const b = (await page.locator(sel).boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    let p = await box('#Email');
    await ctx.televend.manual.click(ACTOR, p.x, p.y);
    await ctx.televend.manual.type(ACTOR, MOCK_CREDENTIALS.username);
    p = await box('#Password');
    await ctx.televend.manual.click(ACTOR, p.x, p.y);
    await ctx.televend.manual.type(ACTOR, MOCK_CREDENTIALS.password);
    await ctx.televend.manual.press(ACTOR, 'Enter');
    await page.waitForURL(/\/mfa/);
    p = await box('input[name=code]');
    await ctx.televend.manual.click(ACTOR, p.x, p.y);
    await ctx.televend.manual.type(ACTOR, '123456');
    await ctx.televend.manual.press(ACTOR, 'Enter');
    await page.waitForURL(/\/dashboard/);
    const shot = await ctx.televend.manual.screenshot(ACTOR);
    expect(shot.length).toBeGreaterThan(1000);
    const fin = await ctx.televend.manual.finish(ACTOR);
    expect(fin).toEqual({ saved: true, confirmed: true });
    expect(getConnectorStatus(ctx.db)).toMatchObject({ state: 'connected', autoSyncSuspended: false });
    // sinkronizacija koristi spremljenu sesiju – bez nove prijave i bez MFA
    configureSources(ctx);
    const before = portal.loginAttempts;
    const s = await ctx.televend.syncNow('auto');
    expect(s?.status).toBe('success');
    expect(portal.loginAttempts).toBe(before);
  });

  it('CAPTCHA se prepoznaje – automatska prijava se ne pokušava', async () => {
    const { ctx, portal } = await setup('captcha');
    const r = await ctx.televend.testConnection(ACTOR);
    expect(r.result.status).toBe('captcha_required');
    expect(portal.loginAttempts).toBe(0);
  });

  it('prijava u dva koraka (korisničko ime → lozinka)', async () => {
    const { ctx } = await setup('twostep');
    const r = await ctx.televend.testConnection(ACTOR);
    expect(r.result.status).toBe('ok');
  });

  it('stranica bez obrasca za prijavu → jasna poruka, bez pogađanja', async () => {
    const { ctx } = await setup('nologinform');
    const r = await ctx.televend.testConnection(ACTOR);
    expect(r.result.status).toBe('form_not_found');
  });

  it('preusmjeravanje na nedopuštenu domenu se blokira', async () => {
    const { ctx } = await setup('normal', MOCK_CREDENTIALS.password, '/redirect-out');
    const r = await ctx.televend.testConnection(ACTOR);
    expect(r.blocked.join(' ')).toContain('phishing.example');
    expect(['error', 'form_not_found']).toContain(r.result.status);
  });
});

describe('Istraživanje portala', () => {
  it('pronalazi stranice, tablice i izvoze; preskače poveznice koje mijenjaju podatke', async () => {
    const { ctx, portal } = await setup();
    portal.sales.push({ id: 'S1', at: localAt(0, '08:00:00'), machine: 'Automat Bolnica', product: 'Kava', qty: 1, amount: '1,20', status: 'OK' });
    await ctx.televend.testConnection(ACTOR);
    const r = await ctx.televend.discover(ACTOR, 10);
    expect(r.report).not.toBeNull();
    const paths = r.report!.pages.map((p) => p.path);
    expect(paths).toContain('/reports/sales');
    expect(paths).toContain('/machines');
    expect(paths.some((p) => p.includes('delete-all'))).toBe(false);
    expect(paths.some((p) => p.includes('logout'))).toBe(false);
    expect(r.report!.skippedLinks.map((s) => s.text)).toEqual(expect.arrayContaining(['Obriši sve podatke', 'Odjava']));
    expect(portal.sales).toHaveLength(1); // opasna stranica nije otvorena
    const sales = r.report!.pages.find((p) => p.path === '/reports/sales')!;
    expect(sales.exports.map((e) => e.text)).toContain('Izvoz u CSV');
    expect(sales.tables[0].headers).toEqual(['Broj', 'Vrijeme', 'Uređaj', 'Proizvod', 'Količina', 'Iznos', 'Status']);
    expect(sales.dateInputs.map((d) => d.selector)).toEqual(expect.arrayContaining(['#from', '#to']));
    expect(ctx.televend.latestDiscovery()?.report.summary.pagesVisited).toBeGreaterThanOrEqual(3);
  });
});

describe('Sinkronizacija: preuzimanje, uvoz, duplikati, ponavljanje i prekid', () => {
  it('bez konfiguriranih izvora sinkronizacija se preskače uz objašnjenje (ništa se ne pretpostavlja)', async () => {
    const { ctx } = await setup();
    const r = await ctx.televend.syncNow('manual', ACTOR);
    expect(r?.status).toBe('skipped');
    expect(r?.message).toMatch(/Istraži portal/);
  });

  it('preuzima CSV izvoz i tablicu s paginacijom; ponovljena sinkronizacija ne stvara duplikate', async () => {
    const { ctx, portal } = await setup();
    configureSources(ctx);
    portal.sales.push(
      { id: 'S1', at: localAt(1, '08:00:00'), machine: 'Automat Bolnica', product: 'Coca-Cola 0,5', qty: 1, amount: '2,50', status: 'OK' },
      { id: 'S2', at: localAt(0, '09:30:00'), machine: 'Automat Fakultet', product: 'Kava', qty: 2, amount: '2,40', status: 'OK' },
      { id: 'S3', at: localAt(60, '09:30:00'), machine: 'Automat Fakultet', product: 'Kava', qty: 1, amount: '1,20', status: 'OK' }, // izvan razdoblja
    );
    const r1 = await ctx.televend.syncNow('manual', ACTOR);
    expect(r1?.status).toBe('success');
    const sales = r1!.results.find((x) => x.dataset === 'sales')!;
    expect(sales.summary).toMatchObject({ inserted: 2, duplicate: 0 });
    const machines = r1!.results.find((x) => x.dataset === 'machines')!;
    expect(machines.summary).toMatchObject({ inserted: 3 }); // 2 + 1 s druge stranice
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM machines').get()).toEqual({ n: 3 });
    const st = getConnectorStatus(ctx.db);
    expect(st.salesSyncedThrough).toBe(today.toISODate());
    expect(st.lastSyncRecords).toBeGreaterThan(0);
    // novi podatak + storno postojećeg
    portal.sales.push({ id: 'S4', at: localAt(0, '10:00:00'), machine: 'Automat Bolnica', product: 'Voda', qty: 1, amount: '1,50', status: 'OK' });
    portal.sales[0].status = 'storno';
    resetManualLimit(ctx);
    const r2 = await ctx.televend.syncNow('manual', ACTOR);
    expect(r2!.results.find((x) => x.dataset === 'sales')!.summary).toMatchObject({ inserted: 1, updated: 1, duplicate: 1 });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM sales_transactions').get()).toEqual({ n: 3 });
    expect(ctx.db.prepare("SELECT status FROM sales_transactions WHERE source_txn_id = 'S1'").get()).toEqual({ status: 'cancelled' });
    // svaki zapis ima izvor, vrijeme preuzimanja i referencu
    const t = ctx.db.prepare("SELECT source, fetched_at, import_batch_id FROM sales_transactions WHERE source_txn_id = 'S2'").get() as Record<string, unknown>;
    expect(t.source).toBe('televend_portal');
    expect(t.fetched_at).toBeTruthy();
    expect(t.import_batch_id).toBeTruthy();
  });

  it('privremena greška (HTTP 500) se sigurno ponavlja', async () => {
    const { ctx, portal } = await setup();
    const cfg = getConnectorConfig(ctx.db);
    cfg.datasets.sales = { ...salesSource(), exportTrigger: null, pageUrl: '/reports/sales/export.csv?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}' };
    saveConnectorConfig(ctx.db, cfg);
    portal.sales.push({ id: 'S1', at: localAt(0, '08:00:00'), machine: 'A', product: 'Kava', qty: 1, amount: '1,20', status: 'OK' });
    portal.failExports = 1;
    const r = await ctx.televend.syncNow('auto');
    expect(r?.status).toBe('success');
    const run = ctx.db.prepare('SELECT attempts, status FROM sync_runs WHERE id = ?').get(r!.runId);
    expect(run).toEqual({ attempts: 2, status: 'success' });
    expect(portal.exportRequests).toBe(2);
  });

  it('trajna greška: neuspjela sinkronizacija se evidentira, razdoblje prodaje se ne pomiče', async () => {
    const { ctx, portal } = await setup();
    const cfg = getConnectorConfig(ctx.db);
    cfg.datasets.sales = { ...salesSource(), exportTrigger: null, pageUrl: '/reports/sales/export.csv?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}' };
    saveConnectorConfig(ctx.db, cfg);
    portal.failExports = 99;
    const r = await ctx.televend.syncNow('auto');
    expect(r?.status).toBe('failed');
    expect(getConnectorStatus(ctx.db)).toMatchObject({ salesSyncedThrough: null, lastSyncStatus: 'failed' });
    const run = ctx.db.prepare('SELECT attempts, status, error_message FROM sync_runs WHERE id = ?').get(r!.runId) as { attempts: number; status: string; error_message: string };
    expect(run.attempts).toBe(3);
    expect(run.error_message).toMatch(/500/);
  });

  it('prekid sinkronizacije: zapis „u tijeku” se pri ponovnom pokretanju označava kao prekinut', async () => {
    const ctx = await makeContext({ televend: TEST_TELEVEND });
    ctx.db.prepare("INSERT INTO sync_runs (kind, trigger, status, started_at) VALUES ('sync', 'auto', 'running', ?)").run(new Date().toISOString());
    expect(ctx.televend.markInterruptedRuns()).toBe(1);
    expect(ctx.db.prepare('SELECT status FROM sync_runs').get()).toEqual({ status: 'interrupted' });
  });

  it('istodobne sinkronizacije nisu moguće (zaštita od preklapanja)', async () => {
    const { ctx } = await setup();
    configureSources(ctx);
    const first = ctx.televend.syncNow('auto');
    const second = await ctx.televend.syncNow('auto');
    expect(second).toBeNull();
    await expect(ctx.televend.syncNow('manual', ACTOR)).rejects.toThrow(/u tijeku/);
    await first;
  });
});
