import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { DB } from '../../db/index.js';
import { badRequest } from '../../lib/errors.js';
import { nowIso } from '../../lib/time.js';
import { getSetting } from '../settings/store.js';

export const EMAIL_SECRET_PASSWORD = 'email.password';
export const EMAIL_SECRET_OAUTH_CLIENT_SECRET = 'email.oauth2.clientSecret';
export const EMAIL_SECRET_OAUTH_REFRESH_TOKEN = 'email.oauth2.refreshToken';

const zEmail = z.email('neispravna e-mail adresa');

export const emailConfigSchema = z.object({
  host: z.string().trim().max(200),
  port: z.number().int().min(1).max(65535),
  security: z.enum(['starttls', 'tls', 'none']),
  authMethod: z.enum(['password', 'oauth2', 'none']),
  username: z.string().trim().max(200).nullable(),
  fromAddress: z.union([zEmail, z.literal('')]),
  fromName: z.string().trim().max(100),
  toAddress: z.union([zEmail, z.literal('')]),
  ccAddresses: z.array(zEmail).max(20),
  oauth2ClientId: z.string().trim().max(300).nullable(),
  oauth2AccessUrl: z.url().nullable(),
  /** Provjera TLS certifikata SMTP poslužitelja (isključivanje samo za interne poslužitelje). */
  tlsRejectUnauthorized: z.boolean(),
});
export type EmailConfig = z.infer<typeof emailConfigSchema>;

export const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  host: '',
  port: 587,
  security: 'starttls',
  authMethod: 'password',
  username: null,
  fromAddress: '',
  fromName: 'VendiStock',
  toAddress: '',
  ccAddresses: [],
  oauth2ClientId: null,
  oauth2AccessUrl: null,
  tlsRejectUnauthorized: true,
};

export const getEmailConfig = (db: DB): EmailConfig => getSetting(db, 'email.config', DEFAULT_EMAIL_CONFIG);

export interface MailMessage {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export interface MailTransport {
  sendMail(msg: MailMessage): Promise<unknown>;
  verify?(): Promise<unknown>;
}

export type MailTransportFactory = (options: Record<string, unknown>) => MailTransport;

export function emailConfigProblem(ctx: AppContext): string | null {
  const cfg = getEmailConfig(ctx.db);
  if (!cfg.host) return 'SMTP poslužitelj nije postavljen.';
  if (!cfg.fromAddress) return 'Adresa pošiljatelja nije postavljena.';
  if (!cfg.toAddress) return 'Adresa primatelja nije postavljena.';
  if (cfg.authMethod === 'password') {
    if (!cfg.username) return 'Korisničko ime za SMTP nije postavljeno.';
    if (!ctx.secrets.info(ctx.db, EMAIL_SECRET_PASSWORD).readable) return 'Lozinka za SMTP nije spremljena ili nije čitljiva.';
  }
  if (cfg.authMethod === 'oauth2') {
    if (!cfg.username || !cfg.oauth2ClientId) return 'OAuth2 postavke nisu potpune.';
    if (!ctx.secrets.info(ctx.db, EMAIL_SECRET_OAUTH_REFRESH_TOKEN).readable) return 'OAuth2 refresh token nije spremljen.';
  }
  return null;
}

function transportOptions(ctx: AppContext, cfg: EmailConfig): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.security === 'tls',
    requireTLS: cfg.security === 'starttls',
    ignoreTLS: cfg.security === 'none',
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: { rejectUnauthorized: cfg.tlsRejectUnauthorized, minVersion: 'TLSv1.2' },
  };
  if (cfg.authMethod === 'password') {
    opts.auth = { user: cfg.username, pass: ctx.secrets.get(ctx.db, EMAIL_SECRET_PASSWORD) ?? '' };
  } else if (cfg.authMethod === 'oauth2') {
    opts.auth = {
      type: 'OAuth2',
      user: cfg.username,
      clientId: cfg.oauth2ClientId,
      clientSecret: ctx.secrets.get(ctx.db, EMAIL_SECRET_OAUTH_CLIENT_SECRET) ?? undefined,
      refreshToken: ctx.secrets.get(ctx.db, EMAIL_SECRET_OAUTH_REFRESH_TOKEN) ?? undefined,
      accessUrl: cfg.oauth2AccessUrl ?? undefined,
    };
  }
  return opts;
}

function createTransport(ctx: AppContext, cfg: EmailConfig): MailTransport {
  const options = transportOptions(ctx, cfg);
  if (ctx.mailTransportFactory) return ctx.mailTransportFactory(options);
  return nodemailer.createTransport(options) as unknown as MailTransport;
}

export const MAX_EMAIL_ATTEMPTS = 3;

export interface SendResult {
  emailId: number;
  status: 'sent' | 'failed';
  error?: string;
}

/**
 * Šalje e-mail i bilježi ga u email_log. Neuspjela slanja se ponavljaju (najviše 3 pokušaja)
 * putem planera – uvijek isti zapis, pa ista poruka ne može nastati dvaput.
 */
export async function sendEmail(
  ctx: AppContext,
  msg: {
    kind: 'low_stock' | 'daily_reminder' | 'test' | 'procurement_list';
    subject: string;
    text: string;
    html?: string;
    to?: string[];
    attachments?: MailMessage['attachments'];
    /** Poziva se nakon upisa u email_log, a prije slanja (npr. za povezivanje događaja upozorenja). */
    onQueued?: (emailId: number) => void;
  },
): Promise<SendResult> {
  const problem = emailConfigProblem(ctx);
  if (problem) throw badRequest(`E-mail nije konfiguriran: ${problem}`);
  const cfg = getEmailConfig(ctx.db);
  const to = msg.to?.length ? msg.to : [cfg.toAddress];
  const r = ctx.db
    .prepare(
      `INSERT INTO email_log (kind, to_addresses, subject, body_text, body_html, status, attempts)
       VALUES (?, ?, ?, ?, ?, 'pending', 0)`,
    )
    .run(msg.kind, [...to, ...cfg.ccAddresses].join(', '), msg.subject, msg.text, msg.html ?? null);
  const emailId = Number(r.lastInsertRowid);
  msg.onQueued?.(emailId);
  return deliver(ctx, emailId, msg.attachments);
}

async function deliver(ctx: AppContext, emailId: number, attachments?: MailMessage['attachments']): Promise<SendResult> {
  const row = ctx.db.prepare('SELECT * FROM email_log WHERE id = ?').get(emailId) as {
    id: number;
    kind: string;
    to_addresses: string;
    subject: string;
    body_text: string;
    body_html: string | null;
    attempts: number;
    status: string;
  };
  if (row.status === 'sent') return { emailId, status: 'sent' };
  const cfg = getEmailConfig(ctx.db);
  const attempts = row.attempts + 1;
  try {
    const transport = createTransport(ctx, cfg);
    await transport.sendMail({
      from: cfg.fromName ? `"${cfg.fromName.replace(/"/g, '')}" <${cfg.fromAddress}>` : cfg.fromAddress,
      to: row.to_addresses
        .split(',')
        .map((s) => s.trim())
        .filter((a) => a && !cfg.ccAddresses.includes(a)),
      cc: cfg.ccAddresses,
      subject: row.subject,
      text: row.body_text,
      html: row.body_html ?? undefined,
      attachments,
    });
    ctx.db
      .prepare("UPDATE email_log SET status = 'sent', attempts = ?, sent_at = ?, error = NULL, next_attempt_at = NULL WHERE id = ?")
      .run(attempts, nowIso(), emailId);
    ctx.db.prepare("UPDATE stock_alert_events SET notify_status = 'sent' WHERE email_id = ?").run(emailId);
    ctx.log.info({ emailId, kind: row.kind }, 'E-mail poslan');
    return { emailId, status: 'sent' };
  } catch (e) {
    const error = (e as Error).message.slice(0, 500);
    const next = attempts < MAX_EMAIL_ATTEMPTS ? new Date(Date.now() + attempts * 5 * 60_000).toISOString() : null;
    ctx.db
      .prepare("UPDATE email_log SET status = 'failed', attempts = ?, error = ?, next_attempt_at = ? WHERE id = ?")
      .run(attempts, error, next, emailId);
    ctx.db.prepare("UPDATE stock_alert_events SET notify_status = 'failed' WHERE email_id = ?").run(emailId);
    ctx.log.warn({ emailId, error }, 'Slanje e-maila nije uspjelo');
    return { emailId, status: 'failed', error };
  }
}

/** Ponovno slanje neuspjelih poruka kojima je došlo vrijeme (poziva planer). */
export async function retryFailedEmails(ctx: AppContext): Promise<number> {
  if (emailConfigProblem(ctx)) return 0;
  const due = ctx.db
    .prepare(
      "SELECT id FROM email_log WHERE status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ? AND attempts < ? AND kind <> 'test'",
    )
    .all(nowIso(), MAX_EMAIL_ATTEMPTS) as { id: number }[];
  for (const d of due) await deliver(ctx, d.id);
  return due.length;
}

/** Ručno ponovno slanje (iz povijesti e-mailova). */
export async function resendEmail(ctx: AppContext, emailId: number): Promise<SendResult> {
  const problem = emailConfigProblem(ctx);
  if (problem) throw badRequest(`E-mail nije konfiguriran: ${problem}`);
  const row = ctx.db.prepare('SELECT status FROM email_log WHERE id = ?').get(emailId) as { status: string } | undefined;
  if (!row) throw badRequest('E-mail nije pronađen.');
  if (row.status === 'sent') throw badRequest('Poruka je već uspješno poslana.');
  return deliver(ctx, emailId);
}

export async function verifySmtp(ctx: AppContext): Promise<void> {
  const problem = emailConfigProblem(ctx);
  if (problem) throw badRequest(problem);
  const transport = createTransport(ctx, getEmailConfig(ctx.db));
  if (transport.verify) await transport.verify();
}
