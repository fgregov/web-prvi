// Helpers shared by the profile drawers (note, e-mail, edit customer).
import { ApiError } from '../core/api.js';
import { hasErrors } from '../core/validation.js';
import { showToast } from '../ui/toast.js';

/** Builds the drawer submit handler: validate → mark fields → save on the server → report. */
export function saveHandler(form, { validate, save, buildInput = (values) => values }) {
  return async () => {
    const input = buildInput(form.values());
    const errors = validate(input);
    if (hasErrors(errors)) {
      form.setErrors(errors);
      return false;
    }
    try {
      await save(input);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        form.setErrors(error.errors);
        return false;
      }
      showToast(
        error instanceof ApiError ? error.message : 'Došlo je do pogreške. Pokušajte ponovno.',
      );
      return false;
    }
  };
}
