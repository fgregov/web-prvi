import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { requestDecision, type PortalPolicy } from './urlPolicy.js';

export interface StepEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** Dnevnik koraka jedne sesije (sprema se uz sinkronizaciju i prikazuje u sučelju). Nikad ne sadrži lozinke. */
export class StepLog {
  readonly steps: StepEntry[] = [];
  readonly blocked: string[] = [];
  private add(level: StepEntry['level'], message: string) {
    this.steps.push({ at: new Date().toISOString(), level, message: message.slice(0, 1000) });
    if (this.steps.length > 400) this.steps.splice(0, this.steps.length - 400);
  }
  info(m: string) {
    this.add('info', m);
  }
  warn(m: string) {
    this.add('warn', m);
  }
  error(m: string) {
    this.add('error', m);
  }
}

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export interface PortalSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  policy: PortalPolicy;
  log: StepLog;
  downloadsDir: string;
  close(): Promise<void>;
}

export interface OpenSessionOptions {
  policy: PortalPolicy;
  storageState: StorageState | null;
  executablePath: string | null;
  navigationTimeoutMs: number;
  downloadsDir: string;
  log: StepLog;
  viewport?: { width: number; height: number };
}

/**
 * Pokreće izolirani Chromium (headless) samo za backend. Kolačići portala žive u ovom kontekstu
 * i spremaju se šifrirano – nikad se ne prosljeđuju pregledniku korisnika VendiStocka.
 */
export async function openPortalSession(opts: OpenSessionOptions): Promise<PortalSession> {
  fs.mkdirSync(opts.downloadsDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: opts.executablePath ?? undefined,
    downloadsPath: opts.downloadsDir,
    args: ['--disable-dev-shm-usage', '--disable-extensions'],
  });
  try {
    const context = await browser.newContext({
      storageState: opts.storageState ?? undefined,
      acceptDownloads: true,
      locale: 'hr-HR',
      timezoneId: 'Europe/Zagreb',
      viewport: opts.viewport ?? { width: 1366, height: 900 },
      serviceWorkers: 'block',
      ignoreHTTPSErrors: false,
    });
    context.setDefaultNavigationTimeout(opts.navigationTimeoutMs);
    context.setDefaultTimeout(Math.min(opts.navigationTimeoutMs, 30_000));
    const block = (reason: string) => {
      const msg = `Blokiran zahtjev: ${reason}`;
      if (!opts.log.blocked.includes(msg)) {
        opts.log.blocked.push(msg);
        opts.log.warn(msg);
      }
    };
    await context.route('**/*', async (route) => {
      const req = route.request();
      const nav = req.isNavigationRequest();
      const decision = requestDecision(opts.policy, req.url(), nav);
      if (!decision.allow) {
        block(decision.reason);
        await route.abort('blockedbyclient');
        return;
      }
      if (!nav) {
        await route.continue();
        return;
      }
      // Navigacije se izvršavaju bez automatskog praćenja preusmjeravanja kako bi se svako odredište
      // provjerilo PRIJE slanja (npr. 307 nakon slanja obrasca ne smije proslijediti lozinku drugoj domeni).
      let resp;
      try {
        resp = await route.fetch({ maxRedirects: 0 });
      } catch {
        await route.abort('failed').catch(() => undefined);
        return;
      }
      const status = resp.status();
      if (status >= 300 && status < 400) {
        const loc = resp.headers()['location'];
        if (loc) {
          const target = new URL(loc, req.url()).toString();
          const d = requestDecision(opts.policy, target, true);
          if (!d.allow) {
            block(d.reason);
            await route.abort('blockedbyclient');
            return;
          }
        }
      }
      await route.fulfill({ response: resp });
    });
    const page = await context.newPage();
    return {
      browser,
      context,
      page,
      policy: opts.policy,
      log: opts.log,
      downloadsDir: opts.downloadsDir,
      async close() {
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
        fs.rmSync(opts.downloadsDir, { recursive: true, force: true });
      },
    };
  } catch (e) {
    await browser.close().catch(() => undefined);
    throw e;
  }
}

export async function settle(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
}

export function tmpDownloadsDir(dataDir: string): string {
  return path.join(dataDir, 'tmp', `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/** Razlikuje privremene pogreške (mreža, vremensko ograničenje) od trajnih. */
export function isTransientError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return /timeout|timed out|net::ERR_(CONNECTION|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|NETWORK|TIMED_OUT|ADDRESS_UNREACHABLE|CONNECTION_RESET|SSL_PROTOCOL)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|HTTP 5\d\d|Target page, context or browser has been closed/i.test(
    m,
  );
}
