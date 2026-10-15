// The server's connection to Supabase: Auth (GoTrue) and the database's
// admin_* functions (PostgREST). The service role key is used only here, on
// the server; it never reaches a browser, a log line or an error message.

export interface SupabaseConfig {
  /** https://<project>.supabase.co (or http://127.0.0.1:54321 locally) */
  readonly url: string;
  /** The public (anon) key: sign-in checks. */
  readonly anonKey: string;
  /** The service role key: account administration and the admin_* functions. */
  readonly serviceRoleKey: string;
}

/** A failed call. `code`: Postgres SQLSTATE or GoTrue error code; `reason` after "renvara: ". */
export class SupabaseError extends Error {
  override name = 'SupabaseError';
  readonly status: number;
  readonly code: string;
  readonly reason: string;
  constructor(status: number, code: string, message: string) {
    super(`Supabase ${status} ${code}`);
    this.status = status;
    this.code = code;
    this.reason = /^renvara: (.+)$/.exec(message)?.[1] ?? '';
  }
}

const TIMEOUT_MS = 10_000;

export function createSupabaseClient(config: SupabaseConfig, fetchImpl: typeof fetch = fetch) {
  const base = config.url.replace(/\/+$/, '');

  async function call(
    path: string,
    init: { method?: string; body?: unknown; key: 'anon' | 'service'; bearer?: string },
  ): Promise<unknown> {
    const key = init.key === 'service' ? config.serviceRoleKey : config.anonKey;
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          apikey: key,
          Authorization: `Bearer ${init.bearer ?? key}`,
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : null,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new SupabaseError(0, 'network', 'unreachable');
    }
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const p = (payload ?? {}) as Record<string, unknown>;
      const code = String(p.code ?? p.error_code ?? p.error ?? response.status);
      const message = String(p.message ?? p.msg ?? p.error_description ?? '');
      throw new SupabaseError(response.status, code, message);
    }
    return payload;
  }

  return {
    /** A database function (POST /rest/v1/rpc/<name>) as the service role. */
    rpc: <T>(name: string, args: Record<string, unknown>) =>
      call(`/rest/v1/rpc/${name}`, { method: 'POST', body: args, key: 'service' }) as Promise<T>,
    /** A table request (PostgREST) as the service role, e.g. for the first owner. */
    rest: <T>(path: string, method: string, body?: unknown) =>
      call(`/rest/v1/${path}`, { method, body, key: 'service' }) as Promise<T>,
    /** Supabase Auth. `key`: anon for sign-in and recovery, service for administration. */
    auth: <T>(
      path: string,
      init: { method?: string; body?: unknown; key: 'anon' | 'service'; bearer?: string },
    ) => call(`/auth/v1${path}`, init) as Promise<T>,
  };
}

export type SupabaseClient = ReturnType<typeof createSupabaseClient>;
