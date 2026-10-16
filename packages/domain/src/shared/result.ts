/**
 * Explicit success/failure for business operations. Domain functions never
 * throw for expected rule violations; callers (services, UI, AI tool handlers)
 * must handle the failure case.
 */
export type Result<T, E extends string = string> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E extends string>(error: E): Result<never, E> => ({ ok: false, error });
