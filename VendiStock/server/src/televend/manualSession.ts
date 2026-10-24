import type { AppContext } from '../context.js';
import { badRequest, conflict } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { audit, type Actor } from '../modules/audit/audit.js';
import { settle, StepLog, type PortalSession } from './browser.js';
import { getConnectorConfig, patchConnectorStatus } from './config.js';
import { checkLoggedIn } from './login.js';
import type { TelevendService } from './service.js';

const IDLE_TIMEOUT_MS = 10 * 60_000;
export const MANUAL_VIEWPORT = { width: 1280, height: 800 };

const ALLOWED_KEYS = new Set(['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Shift+Tab']);

/**
 * Ručna prijava kroz kontroliranu sesiju preglednika (za MFA ili kad automatska prijava ne uspije).
 * Preglednik radi na serveru; korisnik VendiStocka vidi snimku zaslona i šalje klikove i tipkanje.
 * Sigurnosne provjere portala (MFA, CAPTCHA) rješava sam korisnik – ništa se ne zaobilazi.
 * Nakon završetka sprema se samo sesija (kolačići), šifrirano.
 */
export class ManualSessionManager {
  private session: PortalSession | null = null;
  private owner: number | null = null;
  private startedAt: string | null = null;
  private lastActivity = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ctx: AppContext,
    private readonly svc: TelevendService,
  ) {}

  info() {
    return this.session
      ? { active: true, startedAt: this.startedAt, ownerId: this.owner, url: this.session.page.url(), viewport: MANUAL_VIEWPORT }
      : { active: false };
  }

  private touch() {
    this.lastActivity = Date.now();
  }

  private require(actor: Actor): PortalSession {
    if (!this.session) throw badRequest('Ručna sesija nije pokrenuta.');
    if (this.owner !== actor.id) throw conflict('Ručnu sesiju je pokrenuo drugi korisnik.');
    this.touch();
    return this.session;
  }

  async start(actor: Actor) {
    if (this.ctx.config.mode === 'demo') throw badRequest('Ručna sesija nije dostupna u demo načinu rada.');
    if (this.session) throw conflict('Ručna sesija je već pokrenuta.');
    if (this.svc.isRunning) throw conflict('Druga operacija s portalom je u tijeku.');
    const cfg = getConnectorConfig(this.ctx.db);
    if (!cfg.portalUrl) throw badRequest('Najprije spremite web adresu portala.');
    const log = new StepLog();
    const session = await this.svc.openSession(log, { useStoredState: false, viewport: MANUAL_VIEWPORT });
    try {
      await session.page.goto(cfg.portalUrl, { waitUntil: 'domcontentloaded' });
      await settle(session.page, 15_000);
    } catch (e) {
      await session.close();
      throw badRequest(`Portal se ne može otvoriti: ${(e as Error).message.slice(0, 200)}`);
    }
    this.session = session;
    this.owner = actor.id;
    this.startedAt = nowIso();
    this.touch();
    this.timer = setInterval(() => {
      if (Date.now() - this.lastActivity > IDLE_TIMEOUT_MS) void this.cancel();
    }, 30_000);
    this.timer.unref();
    audit(this.ctx.db, actor, 'televend.manual_session_start', 'televend');
    return this.info();
  }

  async screenshot(actor: Actor): Promise<Buffer> {
    const s = this.require(actor);
    return s.page.screenshot({ type: 'jpeg', quality: 70 });
  }

  async click(actor: Actor, x: number, y: number) {
    const s = this.require(actor);
    if (x < 0 || y < 0 || x > MANUAL_VIEWPORT.width || y > MANUAL_VIEWPORT.height) throw badRequest('Koordinate izvan zaslona.');
    await s.page.mouse.click(x, y);
    await settle(s.page, 5_000);
  }

  async type(actor: Actor, text: string) {
    const s = this.require(actor);
    if (text.length > 500) throw badRequest('Tekst je predugačak.');
    await s.page.keyboard.type(text, { delay: 20 });
  }

  async press(actor: Actor, key: string) {
    const s = this.require(actor);
    if (!ALLOWED_KEYS.has(key)) throw badRequest('Tipka nije dopuštena.');
    await s.page.keyboard.press(key);
    await settle(s.page, 5_000);
  }

  async scroll(actor: Actor, dy: number) {
    const s = this.require(actor);
    await s.page.mouse.wheel(0, Math.max(-2000, Math.min(2000, dy)));
  }

  /** Završetak: provjera prijave i šifrirano spremanje sesije za kasnije sinkronizacije. */
  async finish(actor: Actor) {
    const s = this.require(actor);
    const cfg = getConnectorConfig(this.ctx.db);
    const chk = await checkLoggedIn(s.page, cfg.loginSelectors);
    if (!chk.loggedIn && !chk.a.logoutFound) {
      if (chk.a.passwordVisible || chk.a.mfa || chk.a.captcha) {
        throw badRequest('Prijava još nije dovršena (obrazac za prijavu ili provjera je i dalje prikazana).');
      }
    }
    await this.svc.saveStorageState(s);
    patchConnectorStatus(this.ctx.db, {
      state: 'connected',
      message: 'Sesija spremljena nakon ručne prijave.',
      lastLoginAt: nowIso(),
      lastLoginOk: true,
      consecutiveAuthFailures: 0,
      autoSyncSuspended: false,
      suspendedReason: null,
    });
    audit(this.ctx.db, actor, 'televend.manual_session_finish', 'televend', null, { confirmedByIndicator: chk.loggedIn });
    await this.cancel();
    return { saved: true, confirmed: chk.loggedIn };
  }

  async cancel() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const s = this.session;
    this.session = null;
    this.owner = null;
    this.startedAt = null;
    if (s) await s.close();
  }
}
