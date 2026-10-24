import type { AppContext } from '../context.js';
import { nowLocal, todayLocal } from '../lib/time.js';
import { purgeExpiredSessions } from '../auth/sessions.js';
import { dailyReminder, flushLowStockNotifications } from '../modules/alerts/notifier.js';
import { backupSettings, createBackup } from '../modules/backup/service.js';
import { retryFailedEmails } from '../modules/email/mailer.js';
import { getSetting, setSetting } from '../modules/settings/store.js';

/**
 * Pozadinski planer na backendu. Radi neovisno o tome je li preglednik VendiStocka otvoren –
 * dovoljno je da lokalni server radi. Svaki posao ima zaštitu od preklapanja.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private busy = new Set<string>();
  private lastSessionPurge = 0;
  tickMs = 20_000;

  constructor(private readonly ctx: AppContext) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref();
    setTimeout(() => void this.tick(), 5_000).unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async job(name: string, fn: () => Promise<unknown>) {
    if (this.busy.has(name)) return;
    this.busy.add(name);
    try {
      await fn();
    } catch (e) {
      this.ctx.log.error({ job: name, err: (e as Error).message }, 'Pozadinski posao nije uspio');
    } finally {
      this.busy.delete(name);
    }
  }

  async tick() {
    if (this.ctx.maintenance) return;
    const ctx = this.ctx;
    await Promise.all([
      this.job('alerts', () => flushLowStockNotifications(ctx)),
      this.job('emailRetry', () => retryFailedEmails(ctx)),
      this.job('dailyReminder', () => dailyReminder(ctx)),
      this.job('backup', async () => {
        const s = backupSettings(ctx);
        if (!s.autoEnabled) return;
        const today = todayLocal();
        if (getSetting<string | null>(ctx.db, 'backup.lastAutoDate', null) === today) return;
        if (nowLocal().toFormat('HH:mm') < s.time) return;
        setSetting(ctx.db, 'backup.lastAutoDate', today);
        await createBackup(ctx, 'auto', null);
      }),
      this.job('sessions', async () => {
        if (Date.now() - this.lastSessionPurge < 3600_000) return;
        this.lastSessionPurge = Date.now();
        purgeExpiredSessions(ctx.db);
      }),
    ]);
    // Sinkronizacija s Televendom (može trajati dulje – ne blokira ostale poslove)
    if (ctx.televend.autoSyncDue()) {
      void this.job('televendSync', async () => {
        const r = await ctx.televend.syncNow('auto');
        if (r) ctx.log.info({ runId: r.runId, status: r.status }, 'Automatska sinkronizacija završena');
      });
    }
  }
}
