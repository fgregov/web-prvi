/**
 * Fixed-window limiter for FAILED login attempts, keyed by client IP.
 * In memory and per process: enough to stop unrestricted guessing against a
 * single BETA server, not a distributed defence.
 */
export class FailedLoginLimiter {
  readonly #attempts = new Map<string, { count: number; windowStart: number }>();

  readonly maxFailures: number;
  readonly windowMs: number;

  constructor(maxFailures = 10, windowMs = 60_000) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  /** Seconds until the key may try again, or 0 when not blocked. */
  retryAfterSeconds(key: string, nowMs: number): number {
    const entry = this.#attempts.get(key);
    if (!entry || nowMs - entry.windowStart >= this.windowMs) return 0;
    if (entry.count < this.maxFailures) return 0;
    return Math.ceil((entry.windowStart + this.windowMs - nowMs) / 1000);
  }

  recordFailure(key: string, nowMs: number): void {
    const entry = this.#attempts.get(key);
    if (!entry || nowMs - entry.windowStart >= this.windowMs) {
      this.#attempts.set(key, { count: 1, windowStart: nowMs });
    } else {
      entry.count += 1;
    }
    if (this.#attempts.size > 10_000) this.#prune(nowMs);
  }

  reset(key: string): void {
    this.#attempts.delete(key);
  }

  #prune(nowMs: number): void {
    for (const [key, entry] of this.#attempts) {
      if (nowMs - entry.windowStart >= this.windowMs) this.#attempts.delete(key);
    }
  }
}
