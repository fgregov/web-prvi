/**
 * Fixed-window request limiter, keyed by client address (public routes) or by
 * user (uploads). In memory and per process, like the login limiter: it stops
 * a single client from flooding one BETA server, not a distributed attack.
 */
export class RequestLimiter {
  readonly #hits = new Map<string, { count: number; windowStart: number }>();
  readonly max: number;
  readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Counts one request; false when the key is over its limit for this window. */
  allow(key: string, nowMs: number): boolean {
    const entry = this.#hits.get(key);
    if (!entry || nowMs - entry.windowStart >= this.windowMs) {
      this.#hits.set(key, { count: 1, windowStart: nowMs });
      if (this.#hits.size > 10_000) this.#prune(nowMs);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  #prune(nowMs: number): void {
    for (const [key, entry] of this.#hits) {
      if (nowMs - entry.windowStart >= this.windowMs) this.#hits.delete(key);
    }
  }
}
