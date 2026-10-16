// Outgoing e-mail of the server (IZVJEŠTAJI → "Pošalji e-mail"), through an
// e-mail service's HTTP API. Today: Resend (https://resend.com). The API key
// lives only in the server's environment and is never sent to a browser,
// written to a log or stored with the data.
//
//   RESEND_API_KEY          the key ("re_…"); without it, e-mail is not configured
//   RENVARA_EMAIL_FROM      sender, e.g. "RENVARA CRM <izvjestaji@vasa-domena.hr>"
//                           (a domain verified at the e-mail service)
//   RENVARA_EMAIL_REPLY_TO  optional reply address
//   RENVARA_EMAIL_PROVIDER  optional, "resend" (the only one now)
//   RENVARA_RESEND_API_URL  tests only: another address of the same API
//                           (https, or http on 127.0.0.1/localhost)
//
// Not configured is a state, not an error: the app runs, and sending says
// plainly that the service must be set up — it never pretends to send.

export interface MailAttachment {
  readonly filename: string;
  readonly content: Uint8Array;
  readonly contentType: string;
}

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly attachments: readonly MailAttachment[];
  /** The service drops a repeat with the same key (one click, one e-mail). */
  readonly idempotencyKey: string;
}

export type SendResult =
  | { readonly ok: true; readonly id: string | null }
  | { readonly ok: false; readonly error: string; readonly retryable: boolean };

export interface Mailer {
  readonly configured: boolean;
  readonly provider: string | null;
  /** Why it is not configured (for the server log and the administrator), else null. */
  readonly problem: string | null;
  /** The sender address as configured (shown to the user before sending). */
  readonly from: string | null;
  send(message: MailMessage): Promise<SendResult>;
}

const SENDER = /^(?:[^<>\r\n"]{1,100}\s<)?[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}>?$/;
const NOT_CONFIGURED: SendResult = { ok: false, error: 'not_configured', retryable: false };

export function notConfiguredMailer(problem: string): Mailer {
  return {
    configured: false,
    provider: null,
    problem,
    from: null,
    send: async () => NOT_CONFIGURED,
  };
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Resend: POST /emails with the attachment in base64. */
export function resendMailer(options: {
  apiKey: string;
  from: string;
  replyTo?: string | null;
  apiUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Mailer {
  const url = options.apiUrl ?? 'https://api.resend.com/emails';
  const doFetch = options.fetch ?? fetch;
  return {
    configured: true,
    provider: 'resend',
    problem: null,
    from: options.from,
    async send(message) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': message.idempotencyKey,
            'User-Agent': 'RENVARA-CRM',
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(options.replyTo ? { reply_to: options.replyTo } : {}),
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: toBase64(a.content),
              content_type: a.contentType,
            })),
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
        });
      } catch (error) {
        const timeout = (error as Error)?.name === 'TimeoutError';
        return { ok: false, error: timeout ? 'timeout' : 'network', retryable: true };
      }
      const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;
      if (response.ok) {
        return { ok: true, id: typeof payload?.id === 'string' ? payload.id : null };
      }
      // The status tells enough (401/403 key, 422 sender or address, 429 limit); the
      // service's message may repeat addresses, so it is not kept.
      return {
        ok: false,
        error: `http_${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    },
  };
}

/** The mailer the environment describes (see the top of this file). */
export function mailerFromEnv(
  env: Record<string, string | undefined>,
  { fetch: doFetch }: { fetch?: typeof fetch } = {},
): Mailer {
  const provider = (env.RENVARA_EMAIL_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = (env.RESEND_API_KEY ?? '').trim();
  const from = (env.RENVARA_EMAIL_FROM ?? '').trim();
  if (provider && provider !== 'resend') {
    return notConfiguredMailer(
      `RENVARA_EMAIL_PROVIDER="${provider}" nije podržan (podržano: resend).`,
    );
  }
  if (!apiKey) return notConfiguredMailer('RESEND_API_KEY nije postavljen.');
  if (!from) return notConfiguredMailer('RENVARA_EMAIL_FROM nije postavljen.');
  if (!SENDER.test(from))
    return notConfiguredMailer('RENVARA_EMAIL_FROM nije ispravna adresa pošiljatelja.');
  const replyTo = (env.RENVARA_EMAIL_REPLY_TO ?? '').trim() || null;
  if (replyTo && !SENDER.test(replyTo)) {
    return notConfiguredMailer('RENVARA_EMAIL_REPLY_TO nije ispravna adresa.');
  }
  const apiUrl = (env.RENVARA_RESEND_API_URL ?? '').trim();
  if (apiUrl) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(apiUrl);
    } catch {
      parsed = null;
    }
    const loopback =
      parsed?.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if (!parsed || (parsed.protocol !== 'https:' && !loopback)) {
      return notConfiguredMailer('RENVARA_RESEND_API_URL mora biti https adresa.');
    }
  }
  return resendMailer({
    apiKey,
    from,
    replyTo,
    ...(apiUrl ? { apiUrl } : {}),
    ...(doFetch ? { fetch: doFetch } : {}),
  });
}
