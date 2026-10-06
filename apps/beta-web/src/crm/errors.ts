import { MESSAGES } from '../../public/app/js/core/validation.js';

export type FieldErrors = Record<string, string>;

/** Invalid input → HTTP 422 with per-field messages (shown next to the field). */
export class CrmValidationError extends Error {
  override name = 'CrmValidationError';
  readonly errors: FieldErrors;
  constructor(errors: FieldErrors, message = 'Provjerite označena polja.') {
    super(message);
    this.errors = errors;
  }
}

/**
 * The record does not exist *in the caller's organization*. Records of other
 * organizations get the same answer, so ids from another tenant reveal nothing.
 */
export class CrmNotFoundError extends Error {
  override name = 'CrmNotFoundError';
  constructor() {
    super(MESSAGES.unavailable);
  }
}
