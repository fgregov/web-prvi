import type { AppContext } from '../../context.js';
import type { DB } from '../../db/index.js';
import { nowLocal, todayLocal } from '../../lib/time.js';
import { emailConfigProblem, sendEmail } from '../email/mailer.js';
import { lowStockEmail, type LowStockItem } from '../email/templates.js';
import { recommendations } from '../procurement/service.js';
import { getSetting, setSetting } from '../settings/store.js';

export interface AlertSettings {
  enabled: boolean;
  /** Pričekaj ovoliko sekundi nakon prvog pada kako bi se više artikala objedinilo u jednu poruku. */
  debounceSeconds: number;
  dailyReminderEnabled: boolean;
  dailyReminderTime: string;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  debounceSeconds: 60,
  dailyReminderEnabled: false,
  dailyReminderTime: '08:00',
};

export const alertSettings = (db: DB) => getSetting(db, 'alerts.config', DEFAULT_ALERT_SETTINGS);

function itemsFor(db: DB, productIds: number[] | null): LowStockItem[] {
  const recs = recommendations(db, { onlyBelowMin: true });
  return recs
    .filter((r) => productIds === null || productIds.includes(r.productId))
    .map((r) => ({
      name: r.name,
      code: r.code,
      unit: r.unit,
      available: r.available,
      minStock: r.minStock,
      orderQty: r.orderQty,
      supplierName: r.supplierName,
    }));
}

/**
 * Šalje jedno upozorenje za sve artikle koji su NOVO ušli u status niske zalihe.
 * Događaj se obrađuje točno jednom (notify_status) – nema ponovljenih poruka za isto razdoblje niske zalihe.
 */
export async function flushLowStockNotifications(ctx: AppContext, opts: { force?: boolean } = {}) {
  const db = ctx.db;
  const settings = alertSettings(db);
  const pending = db
    .prepare(
      `SELECT e.id, e.product_id, e.created_at, s.is_low, s.low_since
       FROM stock_alert_events e LEFT JOIN stock_alert_state s ON s.product_id = e.product_id
       WHERE e.event = 'entered_low' AND e.notify_status = 'pending' ORDER BY e.id`,
    )
    .all() as { id: number; product_id: number; created_at: string; is_low: number | null; low_since: string | null }[];
  if (!pending.length) return { sent: 0, skipped: 0 };

  const markSkipped = db.prepare("UPDATE stock_alert_events SET notify_status = 'skipped' WHERE id = ?");
  if (!settings.enabled) {
    db.transaction(() => pending.forEach((p) => markSkipped.run(p.id)))();
    return { sent: 0, skipped: pending.length };
  }
  const oldest = new Date(pending[0].created_at).getTime();
  if (!opts.force && Date.now() - oldest < settings.debounceSeconds * 1000) return { sent: 0, skipped: 0 };

  // Artikl koji se u međuvremenu oporavio ne treba upozorenje za ovu epizodu.
  const stillLow = pending.filter((p) => p.is_low === 1 && p.low_since !== null && p.low_since <= p.created_at);
  const obsolete = pending.filter((p) => !stillLow.includes(p));
  db.transaction(() => obsolete.forEach((p) => markSkipped.run(p.id)))();
  if (!stillLow.length) return { sent: 0, skipped: obsolete.length };

  const problem = emailConfigProblem(ctx);
  if (problem) {
    db.transaction(() => stillLow.forEach((p) => markSkipped.run(p.id)))();
    ctx.log.warn({ problem, events: stillLow.length }, 'Upozorenje o niskim zalihama nije poslano – e-mail nije konfiguriran');
    return { sent: 0, skipped: pending.length };
  }
  const items = itemsFor(db, [...new Set(stillLow.map((p) => p.product_id))]);
  if (!items.length) {
    db.transaction(() => stillLow.forEach((p) => markSkipped.run(p.id)))();
    return { sent: 0, skipped: pending.length };
  }
  const { subject, text, html } = lowStockEmail(items, 'alert');
  // Događaji se vežu na zapis poruke prije slanja; ponovni pokušaji koriste isti zapis, pa nema duplikata.
  const link = db.prepare("UPDATE stock_alert_events SET email_id = ?, notify_status = 'failed' WHERE id = ? AND notify_status = 'pending'");
  const result = await sendEmail(ctx, {
    kind: 'low_stock',
    subject,
    text,
    html,
    onQueued: (emailId) => db.transaction(() => stillLow.forEach((p) => link.run(emailId, p.id)))(),
  });
  return { sent: result.status === 'sent' ? 1 : 0, skipped: obsolete.length, emailId: result.emailId, status: result.status };
}

/** Opcionalni dnevni podsjetnik: jedna poruka dnevno sa svim artiklima koji su i dalje ispod minimuma. */
export async function dailyReminder(ctx: AppContext, opts: { force?: boolean } = {}) {
  const db = ctx.db;
  const settings = alertSettings(db);
  if (!opts.force) {
    if (!settings.enabled || !settings.dailyReminderEnabled) return { sent: false, reason: 'disabled' };
    const last = getSetting<string | null>(db, 'alerts.lastReminderDate', null);
    const today = todayLocal();
    if (last === today) return { sent: false, reason: 'already_sent' };
    const now = nowLocal().toFormat('HH:mm');
    if (now < settings.dailyReminderTime) return { sent: false, reason: 'not_yet' };
  }
  if (emailConfigProblem(ctx)) return { sent: false, reason: 'email_not_configured' };
  const items = itemsFor(db, null);
  setSetting(db, 'alerts.lastReminderDate', todayLocal());
  if (!items.length) return { sent: false, reason: 'nothing_low' };
  const { subject, text, html } = lowStockEmail(items, 'reminder');
  const r = await sendEmail(ctx, { kind: 'daily_reminder', subject, text, html });
  return { sent: r.status === 'sent', reason: r.error ?? null, emailId: r.emailId };
}

export function alertHistory(db: DB, limit = 500) {
  return db
    .prepare(
      `SELECT e.id, e.event, e.available_qty, e.min_qty, e.notify_status, e.created_at, e.email_id,
              p.code, p.name, p.unit, m.status AS email_status, m.sent_at
       FROM stock_alert_events e JOIN products p ON p.id = e.product_id
       LEFT JOIN email_log m ON m.id = e.email_id
       ORDER BY e.id DESC LIMIT ?`,
    )
    .all(limit);
}

export function emailHistory(db: DB, limit = 300) {
  return db
    .prepare(
      'SELECT id, kind, to_addresses, subject, status, attempts, error, created_at, sent_at, next_attempt_at FROM email_log ORDER BY id DESC LIMIT ?',
    )
    .all(limit);
}

