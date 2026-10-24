import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, conflict, tooMany } from '../lib/errors.js';
import { addDays, nowIso, todayLocal } from '../lib/time.js';
import { audit, SYSTEM_ACTOR, type Actor } from '../modules/audit/audit.js';
import {
  connectorConfigSchema,
  DATASET_LABEL,
  DATASETS,
  datasetConfigSchema,
  getConnectorConfig,
  getConnectorStatus,
  patchConnectorStatus,
  saveConnectorConfig,
  TELEVEND_SECRET_PASSWORD,
  TELEVEND_SECRET_SESSION,
  type ConnectionState,
  type ConnectorConfig,
  type Dataset,
  type DatasetConfig,
} from './config.js';
import { isTransientError, openPortalSession, settle, StepLog, tmpDownloadsDir, type PortalSession, type StorageState } from './browser.js';
import { checkLoggedIn, performLogin, type LoginResult } from './login.js';
import { discoverPortal, type DiscoveryReport } from './discovery.js';
import { extractDataset, type Period } from './extract.js';
import { importDataset, type ImportSummary } from './importers.js';
import { mapRows, tableToCells } from './mapping.js';
import { parseReportFile, type Cell } from './parse.js';
import { type PostingSummary } from './salesPosting.js';
import { runAutomation, type AutomationRunResult } from './automationRunner.js';
import { validatePortalUrl, type PortalPolicy } from './urlPolicy.js';
import { ManualSessionManager } from './manualSession.js';

export const settingsInputSchema = z.object({
  portalUrl: z.string().trim().min(1, 'obavezno').max(500),
  username: z.string().trim().min(1, 'obavezno').max(200),
  /** Prazno = zadrži postojeću lozinku. */
  password: z.string().max(500).optional().nullable(),
  autoSync: z.boolean(),
  intervalMinutes: z.number().int().min(15).max(1440),
  salesOverlapDays: z.number().int().min(0).max(31).optional(),
  initialSalesDays: z.number().int().min(1).max(366).optional(),
  navigationTimeoutSeconds: z.number().int().min(10).max(180).optional(),
  loginSelectors: connectorConfigSchema.shape.loginSelectors.optional(),
});

const MANUAL_ATTEMPT_MIN_GAP_MS = 30_000;
const MANUAL_ATTEMPTS_PER_HOUR = 6;
const AUTH_FAILURES_BEFORE_SUSPEND = 2;

type RunKind = 'test' | 'sync' | 'discovery' | 'manual_session';
type RunTrigger = 'manual' | 'auto' | 'startup';

export interface DatasetRunResult {
  dataset: Dataset;
  ok: boolean;
  summary?: ImportSummary;
  posting?: PostingSummary;
  error?: string;
}

export interface SyncOnceResult {
  results: DatasetRunResult[];
  automation: AutomationRunResult | null;
}

export class AuthError extends Error {
  constructor(public readonly result: LoginResult) {
    super(result.message);
  }
}

/** Orkestracija Televend Cloud konektora: postavke, test prijave, sinkronizacija, istraživanje, ručna sesija. */
export class TelevendService {
  private running: { kind: RunKind; startedAt: string; runId: number } | null = null;
  private manualAttempts: number[] = [];
  /** Kašnjenja ponovnih pokušaja nakon privremene pogreške (ms). */
  retryDelaysMs = [30_000, 120_000];
  discoveryDelayMs = 1_000;
  readonly manual: ManualSessionManager;

  constructor(private readonly ctx: AppContext) {
    this.manual = new ManualSessionManager(ctx, this);
  }

  get db() {
    return this.ctx.db;
  }

  get isRunning() {
    return this.running;
  }

  // ------------------------------------------------------------ Stanje i postavke
  publicState() {
    const cfg = getConnectorConfig(this.db);
    const status = getConnectorStatus(this.db);
    const pw = this.ctx.secrets.info(this.db, TELEVEND_SECRET_PASSWORD);
    const session = this.ctx.secrets.info(this.db, TELEVEND_SECRET_SESSION);
    return {
      config: cfg,
      status: { ...status, running: this.running },
      password: { stored: pw.stored, readable: pw.readable, updatedAt: pw.updatedAt },
      session: { stored: session.stored, readable: session.readable, updatedAt: session.updatedAt },
      secretKey: { status: this.ctx.secrets.status, error: this.ctx.secrets.lastError },
      allowedHosts: this.ctx.config.televend.allowedHosts,
      demoMode: this.ctx.config.mode === 'demo',
      manualSession: this.manual.info(),
    };
  }

  async saveSettings(input: z.infer<typeof settingsInputSchema>, actor: Actor) {
    this.assertNotDemo();
    const policy = await validatePortalUrl(input.portalUrl, this.ctx.config.televend);
    const prev = getConnectorConfig(this.db);
    const identityChanged = prev.portalUrl !== input.portalUrl || prev.username !== input.username;
    if (input.password) {
      if (!this.ctx.secrets.available) throw badRequest('Ključ za šifriranje nije dostupan – lozinka se ne može sigurno spremiti.');
      this.ctx.secrets.set(this.db, TELEVEND_SECRET_PASSWORD, input.password);
    } else if (!this.ctx.secrets.info(this.db, TELEVEND_SECRET_PASSWORD).readable) {
      throw badRequest('Unesite lozinku za Televend Cloud.');
    }
    const next: ConnectorConfig = {
      ...prev,
      portalUrl: new URL(input.portalUrl).toString(),
      username: input.username,
      autoSync: input.autoSync,
      intervalMinutes: input.intervalMinutes,
      salesOverlapDays: input.salesOverlapDays ?? prev.salesOverlapDays,
      initialSalesDays: input.initialSalesDays ?? prev.initialSalesDays,
      navigationTimeoutSeconds: input.navigationTimeoutSeconds ?? prev.navigationTimeoutSeconds,
      loginSelectors: input.loginSelectors ?? prev.loginSelectors,
    };
    saveConnectorConfig(this.db, next);
    if (identityChanged || input.password) {
      this.ctx.secrets.delete(this.db, TELEVEND_SECRET_SESSION);
      patchConnectorStatus(this.db, {
        state: 'configured',
        message: 'Postavke spremljene. Pokrenite „Testiraj povezivanje”.',
        consecutiveAuthFailures: 0,
        autoSyncSuspended: false,
        suspendedReason: null,
      });
    }
    audit(this.db, actor, 'televend.settings', 'televend', null, {
      host: policy.host,
      username: input.username,
      passwordChanged: !!input.password,
      autoSync: input.autoSync,
      intervalMinutes: input.intervalMinutes,
    });
    return this.publicState();
  }

  saveDatasetConfig(dataset: Dataset, input: DatasetConfig, actor: Actor) {
    const parsed = datasetConfigSchema.parse(input);
    const cfg = getConnectorConfig(this.db);
    cfg.datasets[dataset] = parsed;
    saveConnectorConfig(this.db, cfg);
    audit(this.db, actor, 'televend.dataset_config', 'televend', dataset, { enabled: parsed.enabled, method: parsed.method, pageUrl: parsed.pageUrl });
    return cfg.datasets[dataset];
  }

  disconnect(actor: Actor) {
    this.ctx.secrets.delete(this.db, TELEVEND_SECRET_PASSWORD);
    this.ctx.secrets.delete(this.db, TELEVEND_SECRET_SESSION);
    const cfg = getConnectorConfig(this.db);
    saveConnectorConfig(this.db, { ...cfg, autoSync: false });
    void this.manual.cancel();
    patchConnectorStatus(this.db, { state: 'disconnected', message: 'Veza je prekinuta. Lozinka i sesija su obrisane.', autoSyncSuspended: false });
    audit(this.db, actor, 'televend.disconnect', 'televend');
    return this.publicState();
  }

  resumeAutoSync(actor: Actor) {
    patchConnectorStatus(this.db, { autoSyncSuspended: false, suspendedReason: null, consecutiveAuthFailures: 0 });
    audit(this.db, actor, 'televend.resume_auto_sync', 'televend');
    return this.publicState();
  }

  // ------------------------------------------------------------ Pomoćne
  private assertNotDemo() {
    if (this.ctx.config.mode === 'demo') {
      throw badRequest('U demo načinu rada povezivanje s Televend Cloudom je isključeno kako se demo i stvarni podaci ne bi miješali.');
    }
  }

  private credentials(): { username: string; password: string } {
    const cfg = getConnectorConfig(this.db);
    const password = this.ctx.secrets.get(this.db, TELEVEND_SECRET_PASSWORD);
    if (!cfg.portalUrl || !cfg.username) throw badRequest('Televend Cloud nije konfiguriran (URL i korisničko ime).');
    if (!password) throw badRequest('Lozinka za Televend Cloud nije spremljena ili nije čitljiva. Ponovno je unesite.');
    return { username: cfg.username, password };
  }

  private loadStorageState(): StorageState | null {
    const raw = this.ctx.secrets.get(this.db, TELEVEND_SECRET_SESSION);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StorageState;
    } catch {
      return null;
    }
  }

  async saveStorageState(session: PortalSession) {
    const state = await session.context.storageState();
    this.ctx.secrets.set(this.db, TELEVEND_SECRET_SESSION, JSON.stringify(state));
  }

  async policy(): Promise<PortalPolicy> {
    return validatePortalUrl(getConnectorConfig(this.db).portalUrl, this.ctx.config.televend);
  }

  async openSession(log: StepLog, opts: { useStoredState: boolean; viewport?: { width: number; height: number } }) {
    const cfg = getConnectorConfig(this.db);
    return openPortalSession({
      policy: await this.policy(),
      storageState: opts.useStoredState ? this.loadStorageState() : null,
      executablePath: this.ctx.config.televend.browserExecutable,
      navigationTimeoutMs: cfg.navigationTimeoutSeconds * 1000,
      downloadsDir: tmpDownloadsDir(this.ctx.config.dataDir),
      log,
      viewport: opts.viewport,
    });
  }

  private startRun(kind: RunKind, trigger: RunTrigger, actor: Actor): number {
    const r = this.db
      .prepare("INSERT INTO sync_runs (kind, trigger, status, started_at, user_id) VALUES (?, ?, 'running', ?, ?)")
      .run(kind, trigger, nowIso(), actor.id);
    return Number(r.lastInsertRowid);
  }

  private finishRun(
    runId: number,
    fields: {
      status: 'success' | 'partial' | 'failed' | 'skipped';
      attempts?: number;
      fetched?: number;
      inserted?: number;
      updated?: number;
      duplicate?: number;
      rejected?: number;
      errorCode?: string | null;
      errorMessage?: string | null;
      log: StepLog;
      details?: unknown;
    },
  ) {
    const run = this.db.prepare('SELECT started_at FROM sync_runs WHERE id = ?').get(runId) as { started_at: string };
    const finishedAt = nowIso();
    const duration = new Date(finishedAt).getTime() - new Date(run.started_at).getTime();
    this.db
      .prepare(
        `UPDATE sync_runs SET status = ?, finished_at = ?, duration_ms = ?, attempts = ?, records_fetched = ?, records_inserted = ?,
           records_updated = ?, records_duplicate = ?, records_rejected = ?, error_code = ?, error_message = ?, log = ? WHERE id = ?`,
      )
      .run(
        fields.status,
        finishedAt,
        duration,
        fields.attempts ?? 1,
        fields.fetched ?? 0,
        fields.inserted ?? 0,
        fields.updated ?? 0,
        fields.duplicate ?? 0,
        fields.rejected ?? 0,
        fields.errorCode ?? null,
        fields.errorMessage ?? null,
        JSON.stringify({ steps: fields.log.steps, blocked: fields.log.blocked, details: fields.details ?? null }),
        runId,
      );
    return { finishedAt, duration };
  }

  private rateLimitManual() {
    const now = Date.now();
    this.manualAttempts = this.manualAttempts.filter((t) => now - t < 3600_000);
    const last = this.manualAttempts[this.manualAttempts.length - 1];
    if (last && now - last < MANUAL_ATTEMPT_MIN_GAP_MS) {
      throw tooMany('Pričekajte 30 sekundi između pokušaja povezivanja.');
    }
    if (this.manualAttempts.length >= MANUAL_ATTEMPTS_PER_HOUR) {
      throw tooMany('Previše pokušaja povezivanja u zadnjih sat vremena. Pokušajte kasnije kako se račun na portalu ne bi zaključao.');
    }
    this.manualAttempts.push(now);
  }

  private stateForLogin(r: LoginResult): ConnectionState {
    switch (r.status) {
      case 'ok':
      case 'already_logged_in':
        return 'connected';
      case 'invalid_credentials':
        return 'auth_failed';
      case 'mfa_required':
        return 'mfa_required';
      case 'captcha_required':
        return 'captcha_required';
      case 'form_not_found':
        return 'form_not_found';
      default:
        return 'error';
    }
  }

  /** Bilježi ishod prijave; nakon uzastopnih neuspjeha automatska sinkronizacija se obustavlja. */
  private recordLogin(r: LoginResult) {
    const ok = r.status === 'ok' || r.status === 'already_logged_in';
    const status = getConnectorStatus(this.db);
    const authProblem = ['invalid_credentials', 'mfa_required', 'captcha_required'].includes(r.status);
    const failures = ok ? 0 : authProblem ? status.consecutiveAuthFailures + 1 : status.consecutiveAuthFailures;
    const suspend = !ok && (r.status === 'mfa_required' || r.status === 'captcha_required' || failures >= AUTH_FAILURES_BEFORE_SUSPEND);
    patchConnectorStatus(this.db, {
      state: this.stateForLogin(r),
      message: r.message,
      lastLoginAt: nowIso(),
      lastLoginOk: ok,
      lastError: ok ? status.lastError : r.message,
      consecutiveAuthFailures: failures,
      // Uspješna prijava (npr. ručni test nakon ispravka lozinke) ponovno omogućuje automatsku sinkronizaciju.
      autoSyncSuspended: ok ? false : suspend || status.autoSyncSuspended,
      suspendedReason: ok ? null : suspend ? 'Automatska sinkronizacija obustavljena zbog neuspjele prijave – potrebna je provjera korisnika.' : status.suspendedReason,
    });
  }

  /** Otvara sesiju i osigurava prijavu (najviše jedan pokušaj prijave). */
  private async loginSession(log: StepLog): Promise<{ session: PortalSession; login: LoginResult }> {
    const cfg = getConnectorConfig(this.db);
    const creds = this.credentials();
    const stored = this.loadStorageState();
    const session = await this.openSession(log, { useStoredState: !!stored });
    try {
      log.info('Otvaram portal…');
      await session.page.goto(cfg.portalUrl, { waitUntil: 'domcontentloaded' });
      await settle(session.page, cfg.navigationTimeoutSeconds * 1000);
      if (stored) {
        const chk = await checkLoggedIn(session.page, cfg.loginSelectors);
        if (chk.loggedIn) {
          log.info('Spremljena sesija je valjana – prijava nije potrebna.');
          return { session, login: { status: 'already_logged_in', message: 'Sesija je valjana.', finalUrl: session.page.url(), evidence: {} } };
        }
        log.info('Spremljena sesija je istekla – potrebna je prijava.');
      }
      const login = await performLogin(session.page, creds, cfg, log);
      log.info(`Ishod prijave: ${login.status} – ${login.message}`);
      return { session, login };
    } catch (e) {
      await session.close();
      throw e;
    }
  }

  // ------------------------------------------------------------ Test povezivanja
  async testConnection(actor: Actor) {
    this.assertNotDemo();
    if (this.running) throw conflict('Druga operacija s portalom je u tijeku. Pričekajte da završi.');
    this.rateLimitManual();
    const log = new StepLog();
    const runId = this.startRun('test', 'manual', actor);
    this.running = { kind: 'test', startedAt: nowIso(), runId };
    patchConnectorStatus(this.db, { lastAttemptAt: nowIso() });
    try {
      const { session, login } = await this.loginSession(log);
      try {
        this.recordLogin(login);
        const ok = login.status === 'ok' || login.status === 'already_logged_in';
        if (ok) await this.saveStorageState(session);
        this.finishRun(runId, {
          status: ok ? 'success' : 'failed',
          errorCode: ok ? null : login.status,
          errorMessage: ok ? null : login.message,
          log,
          details: { login: { status: login.status, finalUrl: login.finalUrl, evidence: login.evidence } },
        });
        audit(this.db, actor, 'televend.test', 'televend', runId, { result: login.status });
        return { runId, result: login, steps: log.steps, blocked: log.blocked };
      } finally {
        await session.close();
      }
    } catch (e) {
      const message = this.describeError(e);
      patchConnectorStatus(this.db, { state: 'error', message, lastError: message, lastLoginAt: nowIso(), lastLoginOk: false });
      log.error(message);
      this.finishRun(runId, { status: 'failed', errorCode: 'error', errorMessage: message, log });
      if ((e as { status?: number }).status === 400) throw e;
      return { runId, result: { status: 'error', message, finalUrl: null, evidence: {} } as LoginResult, steps: log.steps, blocked: log.blocked };
    } finally {
      this.running = null;
    }
  }

  private describeError(e: unknown): string {
    const m = (e as Error)?.message ?? String(e);
    if (/Executable doesn't exist|browserType\.launch/i.test(m)) {
      return 'Preglednik za automatizaciju nije instaliran. Na serveru pokrenite: npx playwright install chromium';
    }
    if (/net::ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(m)) return 'Adresa portala se ne može razriješiti (DNS). Provjerite URL i internetsku vezu.';
    if (/net::ERR_CERT|SSL|certificate/i.test(m)) return 'TLS certifikat portala nije valjan – veza je odbijena iz sigurnosnih razloga.';
    if (/Timeout|timed out/i.test(m)) return 'Portal nije odgovorio na vrijeme (timeout).';
    if (/blockedbyclient|ERR_BLOCKED_BY_CLIENT/i.test(m)) return 'Zahtjev je blokiran sigurnosnim pravilom (nedopuštena domena ili preusmjeravanje).';
    return m.slice(0, 500);
  }

  // ------------------------------------------------------------ Istraživanje portala
  async discover(actor: Actor, maxPages = 40): Promise<{ runId: number; report: DiscoveryReport | null; login: LoginResult; steps: StepLog['steps'] }> {
    this.assertNotDemo();
    if (this.running) throw conflict('Druga operacija s portalom je u tijeku.');
    const log = new StepLog();
    const runId = this.startRun('discovery', 'manual', actor);
    this.running = { kind: 'discovery', startedAt: nowIso(), runId };
    try {
      const { session, login } = await this.loginSession(log);
      try {
        this.recordLogin(login);
        if (!(login.status === 'ok' || login.status === 'already_logged_in')) {
          this.finishRun(runId, { status: 'failed', errorCode: login.status, errorMessage: login.message, log });
          return { runId, report: null, login, steps: log.steps };
        }
        await this.saveStorageState(session);
        const report = await discoverPortal(session.page, session.policy, { maxPages, delayMs: this.discoveryDelayMs, log });
        this.db.prepare('INSERT INTO televend_discovery_reports (sync_run_id, report) VALUES (?, ?)').run(runId, JSON.stringify(report));
        await this.saveStorageState(session);
        this.finishRun(runId, { status: 'success', fetched: report.pages.length, log, details: report.summary });
        audit(this.db, actor, 'televend.discovery', 'televend', runId, report.summary);
        return { runId, report, login, steps: log.steps };
      } finally {
        await session.close();
      }
    } catch (e) {
      const message = this.describeError(e);
      log.error(message);
      this.finishRun(runId, { status: 'failed', errorCode: 'error', errorMessage: message, log });
      throw badRequest(message);
    } finally {
      this.running = null;
    }
  }

  latestDiscovery() {
    const row = this.db.prepare('SELECT id, created_at, report FROM televend_discovery_reports ORDER BY id DESC LIMIT 1').get() as
      | { id: number; created_at: string; report: string }
      | undefined;
    return row ? { id: row.id, createdAt: row.created_at, report: JSON.parse(row.report) as DiscoveryReport } : null;
  }

  // ------------------------------------------------------------ Sinkronizacija
  periodFor(dataset: Dataset): Period {
    const cfg = getConnectorConfig(this.db);
    const status = getConnectorStatus(this.db);
    const today = todayLocal();
    if (dataset === 'sales' || dataset === 'refills') {
      const from = status.salesSyncedThrough ? addDays(status.salesSyncedThrough, -cfg.salesOverlapDays) : addDays(today, -cfg.initialSalesDays);
      return { from, to: today };
    }
    return { from: today, to: today };
  }

  enabledDatasets(): Dataset[] {
    const cfg = getConnectorConfig(this.db);
    return DATASETS.filter((d) => cfg.datasets[d].enabled);
  }

  async syncNow(trigger: RunTrigger, actor: Actor = SYSTEM_ACTOR) {
    this.assertNotDemo();
    if (this.running) {
      if (trigger === 'auto') return null;
      throw conflict('Sinkronizacija ili druga operacija s portalom je već u tijeku.');
    }
    if (trigger === 'manual') this.rateLimitManual();
    const log = new StepLog();
    const runId = this.startRun('sync', trigger, actor);
    this.running = { kind: 'sync', startedAt: nowIso(), runId };
    patchConnectorStatus(this.db, { lastAttemptAt: nowIso() });
    try {
      return await this.syncWithRetry(runId, log, actor);
    } finally {
      this.running = null;
    }
  }

  private async syncWithRetry(runId: number, log: StepLog, actor: Actor) {
    const datasets = this.enabledDatasets();
    if (!datasets.length) {
      const msg = 'Nijedan izvor podataka nije uključen. Pokrenite „Istraži portal” i konfigurirajte izvore podataka prema stvarnim stranicama portala.';
      log.warn(msg);
      const t = this.finishRun(runId, { status: 'skipped', errorCode: 'no_datasets', errorMessage: msg, log });
      patchConnectorStatus(this.db, { lastSyncAt: t.finishedAt, lastSyncDurationMs: t.duration, lastSyncRecords: 0, lastSyncStatus: 'skipped', message: msg });
      return { runId, status: 'skipped' as const, message: msg, results: [] as DatasetRunResult[] };
    }
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        log.info(`Pokušaj ${attempt}: sinkronizacija (${datasets.map((d) => DATASET_LABEL[d]).join(', ')})`);
        const { results, automation } = await this.runSyncOnce(log, datasets, runId, actor);
        const ok = results.filter((r) => r.ok);
        const status: 'success' | 'partial' | 'failed' = ok.length === results.length ? 'success' : ok.length ? 'partial' : 'failed';
        const sum = (k: 'inserted' | 'updated' | 'duplicate' | 'rejected' | 'rowsTotal') => ok.reduce((n, r) => n + (r.summary?.[k] ?? 0), 0);
        const errors = results.filter((r) => !r.ok).map((r) => `${DATASET_LABEL[r.dataset]}: ${r.error}`);
        const t = this.finishRun(runId, {
          status,
          attempts: attempt,
          fetched: sum('rowsTotal'),
          inserted: sum('inserted'),
          updated: sum('updated'),
          duplicate: sum('duplicate'),
          rejected: sum('rejected'),
          errorCode: errors.length ? 'dataset_error' : null,
          errorMessage: errors.join(' | ') || null,
          log,
          details: { results, automation },
        });
        const salesOk = results.find((r) => r.dataset === 'sales' && r.ok);
        const status0 = getConnectorStatus(this.db);
        patchConnectorStatus(this.db, {
          lastSyncAt: t.finishedAt,
          lastSyncOkAt: status !== 'failed' ? t.finishedAt : status0.lastSyncOkAt,
          lastSyncDurationMs: t.duration,
          lastSyncRecords: sum('rowsTotal'),
          lastSyncStatus: status,
          lastError: errors.join(' | ') || null,
          state: 'connected',
          message: status === 'success' ? 'Sinkronizacija uspješna.' : 'Sinkronizacija djelomično uspješna – pogledajte detalje.',
          // Razdoblje prodaje pomiče se samo nakon uspješnog uvoza (prekinuta sinkronizacija ponovno dohvaća isto razdoblje)
          salesSyncedThrough: salesOk ? this.periodFor('sales').to : status0.salesSyncedThrough,
        });
        return { runId, status, results, automation, message: errors.join(' | ') || null };
      } catch (e) {
        if (e instanceof AuthError) {
          const t = this.finishRun(runId, { status: 'failed', attempts: attempt, errorCode: e.result.status, errorMessage: e.message, log });
          patchConnectorStatus(this.db, { lastSyncAt: t.finishedAt, lastSyncDurationMs: t.duration, lastSyncRecords: 0, lastSyncStatus: 'failed' });
          return { runId, status: 'failed' as const, message: e.message, results: [] as DatasetRunResult[] };
        }
        const message = this.describeError(e);
        const transient = isTransientError(e);
        if (transient && attempt <= this.retryDelaysMs.length) {
          const delay = this.retryDelaysMs[attempt - 1];
          log.warn(`Privremena pogreška: ${message}. Novi pokušaj za ${Math.round(delay / 1000)} s.`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        log.error(message);
        const t = this.finishRun(runId, { status: 'failed', attempts: attempt, errorCode: transient ? 'transient' : 'error', errorMessage: message, log });
        patchConnectorStatus(this.db, {
          lastSyncAt: t.finishedAt,
          lastSyncDurationMs: t.duration,
          lastSyncRecords: 0,
          lastSyncStatus: 'failed',
          lastError: message,
          state: (e as { status?: number }).status === 400 ? getConnectorStatus(this.db).state : 'error',
          message,
        });
        return { runId, status: 'failed' as const, message, results: [] as DatasetRunResult[] };
      }
    }
  }

  private async runSyncOnce(log: StepLog, datasets: Dataset[], runId: number, actor: Actor): Promise<SyncOnceResult> {
    const cfg = getConnectorConfig(this.db);
    const { session, login } = await this.loginSession(log);
    try {
      this.recordLogin(login);
      if (!(login.status === 'ok' || login.status === 'already_logged_in')) throw new AuthError(login);
      await this.saveStorageState(session);
      const results: DatasetRunResult[] = [];
      for (const d of datasets) {
        const period = this.periodFor(d);
        try {
          log.info(`${DATASET_LABEL[d]}: preuzimanje (razdoblje ${period.from} – ${period.to})`);
          const ex = await extractDataset(session, cfg.datasets[d], period, cfg.navigationTimeoutSeconds * 1000);
          const rows: Cell[][] = ex.kind === 'file' ? (await parseReportFile(ex.buffer, ex.fileName)).rows : tableToCells(ex.rows);
          const summary = importDataset(this.db, d, rows, cfg.datasets[d], {
            source: 'televend_portal',
            fileName: ex.kind === 'file' ? ex.fileName : `tablica:${ex.sourceUrl}`,
            fileBuffer: ex.kind === 'file' ? ex.buffer : Buffer.from(JSON.stringify(ex.rows)),
            period,
            syncRunId: runId,
            userId: actor.id,
            fetchedAt: nowIso(),
          });
          if (summary.status !== 'committed') {
            log.warn(`${DATASET_LABEL[d]}: izvještaj odbijen – ${summary.message}`);
            results.push({ dataset: d, ok: false, summary, error: summary.message ?? 'izvještaj odbijen' });
            continue;
          }
          log.info(`${DATASET_LABEL[d]}: novih ${summary.inserted}, ažuriranih ${summary.updated}, duplikata ${summary.duplicate}, odbijenih ${summary.rejected}`);
          results.push({ dataset: d, ok: true, summary });
        } catch (e) {
          if (isTransientError(e) && results.length === 0 && d === datasets[0]) throw e;
          const message = this.describeError(e);
          log.error(`${DATASET_LABEL[d]}: ${message}`);
          results.push({ dataset: d, ok: false, error: message });
        }
      }
      await this.saveStorageState(session);
      const imports = results.filter((r) => r.ok && r.summary).map((r) => ({ dataset: r.dataset, summary: r.summary! }));
      const automation = imports.length ? runAutomation(this.db, imports, actor) : null;
      if (automation) {
        log.info(
          `Automatika: novih artikala ${automation.createdProducts}, knjiženo prodaja ${automation.sales?.posted ?? 0}, dopuna ${automation.refills?.booked ?? 0} (povezano ${automation.refills?.reconciled ?? 0}), usklađenja stanja automata ${automation.machineStock?.movements ?? 0}`,
        );
      }
      return { results, automation };
    } finally {
      await session.close();
    }
  }

  /** Dohvat jednog izvora s portala bez uvoza – za provjeru konfiguracije i mapiranja. */
  async previewPortalDataset(dataset: Dataset, override: DatasetConfig | null, actor: Actor) {
    this.assertNotDemo();
    if (this.running) throw conflict('Druga operacija s portalom je u tijeku.');
    this.rateLimitManual();
    const log = new StepLog();
    const runId = this.startRun('test', 'manual', actor);
    this.running = { kind: 'test', startedAt: nowIso(), runId };
    try {
      const cfg = getConnectorConfig(this.db);
      const dcfg = override ?? cfg.datasets[dataset];
      const { session, login } = await this.loginSession(log);
      try {
        this.recordLogin(login);
        if (!(login.status === 'ok' || login.status === 'already_logged_in')) throw new AuthError(login);
        await this.saveStorageState(session);
        const period = this.periodFor(dataset);
        const ex = await extractDataset(session, dcfg, period, cfg.navigationTimeoutSeconds * 1000);
        const parsed = ex.kind === 'file' ? await parseReportFile(ex.buffer, ex.fileName) : { format: 'table' as const, rows: tableToCells(ex.rows) };
        const preview = previewRows(dataset, parsed.rows, dcfg);
        this.finishRun(runId, { status: 'success', fetched: preview.totalRows, log, details: { preview: true, dataset } });
        return { ...preview, source: ex.kind === 'file' ? { kind: 'file', fileName: ex.fileName, format: parsed.format } : { kind: 'table', pages: ex.pages }, steps: log.steps };
      } finally {
        await session.close();
      }
    } catch (e) {
      const message = e instanceof AuthError ? e.message : this.describeError(e);
      log.error(message);
      this.finishRun(runId, { status: 'failed', errorCode: 'error', errorMessage: message, log });
      throw badRequest(message, { steps: log.steps });
    } finally {
      this.running = null;
    }
  }

  // ------------------------------------------------------------ Ručni uvoz datoteke izvoza
  async previewUpload(dataset: Dataset, buf: Buffer, fileName: string, override: DatasetConfig | null) {
    const parsed = await parseReportFile(buf, fileName);
    const dcfg = override ?? getConnectorConfig(this.db).datasets[dataset];
    return { ...previewRows(dataset, parsed.rows, dcfg), format: parsed.format, encoding: parsed.encoding ?? null, delimiter: parsed.delimiter ?? null };
  }

  async importUpload(dataset: Dataset, buf: Buffer, fileName: string, override: DatasetConfig | null, actor: Actor) {
    const parsed = await parseReportFile(buf, fileName);
    const dcfg = override ?? getConnectorConfig(this.db).datasets[dataset];
    const summary = importDataset(this.db, dataset, parsed.rows, dcfg, {
      source: 'manual_upload',
      fileName,
      fileBuffer: buf,
      period: null,
      syncRunId: null,
      userId: actor.id,
      fetchedAt: nowIso(),
    });
    const automation = runAutomation(this.db, [{ dataset, summary }], actor);
    const posting = automation.sales;
    audit(this.db, actor, 'televend.upload_import', 'import_batch', summary.batchId, {
      dataset,
      fileName,
      status: summary.status,
      inserted: summary.inserted,
      updated: summary.updated,
      duplicate: summary.duplicate,
      rejected: summary.rejected,
    });
    return { summary, posting, automation };
  }

  // ------------------------------------------------------------ Održavanje
  /** Pri pokretanju servera: sinkronizacije koje su ostale „u tijeku” označavaju se kao prekinute. */
  markInterruptedRuns(): number {
    const r = this.db
      .prepare("UPDATE sync_runs SET status = 'interrupted', finished_at = ?, error_message = 'Prekinuto (server je zaustavljen tijekom izvođenja)' WHERE status = 'running'")
      .run(nowIso());
    return r.changes;
  }

  listRuns(limit = 100) {
    return this.db
      .prepare(
        `SELECT id, kind, trigger, status, started_at, finished_at, duration_ms, attempts, records_fetched, records_inserted,
                records_updated, records_duplicate, records_rejected, error_code, error_message
         FROM sync_runs ORDER BY id DESC LIMIT ?`,
      )
      .all(limit);
  }

  runDetail(id: number) {
    const row = this.db.prepare('SELECT * FROM sync_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { ...row, log: row.log ? JSON.parse(String(row.log)) : null };
  }

  /** Je li automatska sinkronizacija dospjela (poziva planer). */
  autoSyncDue(now = Date.now()): boolean {
    if (this.ctx.config.mode === 'demo') return false;
    const cfg = getConnectorConfig(this.db);
    const status = getConnectorStatus(this.db);
    if (!cfg.autoSync || status.autoSyncSuspended || !cfg.portalUrl) return false;
    if (!this.enabledDatasets().length) return false;
    if (!['connected', 'configured', 'error'].includes(status.state)) return false;
    const last = status.lastAttemptAt ? new Date(status.lastAttemptAt).getTime() : 0;
    return now - last >= cfg.intervalMinutes * 60_000;
  }
}

export function previewRows(dataset: Dataset, rows: Cell[][], cfg: DatasetConfig) {
  const mapped = mapRows(dataset, rows, cfg);
  const ser = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Date ? x.toISOString() : x)));
  return {
    headerRowIndex: mapped.headerRowIndex,
    headers: mapped.headers,
    sampleRows: ser(rows.slice(mapped.headerRowIndex + 1, mapped.headerRowIndex + 11)),
    missingColumns: mapped.missingColumns,
    totalRows: mapped.totalRows,
    validRows: mapped.records.length,
    rejectedRows: mapped.rejected.slice(0, 20).map((r) => ({ rowNo: r.rowNo, reason: r.reason })),
    sampleRecords: ser(mapped.records.slice(0, 10).map((r) => r.record)),
  };
}
