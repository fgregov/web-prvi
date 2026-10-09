// Field components for createForm(): each returns a field definition, so every
// screen gets the same labels, touch sizes, error display and accessibility.
const field =
  (type) =>
  (name, label, options = {}) => ({
    name,
    label,
    type,
    full: true,
    ...options,
  });

/** Text-like input (type: text by default; pass { type: 'email' | 'tel' | 'url' | 'number' }). */
export const FormField = (name, label, options = {}) =>
  field(options.type ?? 'text')(name, label, options);
export const TextAreaField = field('textarea');
/** options: [{ value, label }] */
export const SelectField = field('select');
export const SegmentedField = field('segmented');
export const SwitchField = field('switch');
/** Native date picker (YYYY-MM-DD); opens the platform's calendar sheet on iOS/Android. */
export const DatePickerField = field('date');
/** Native time picker (HH:MM, 24 h). */
export const TimePickerField = (name, label, options = {}) =>
  field('time')(name, label, { step: 300, full: false, ...options });
/** Wraps a picker component ({ element, focusTarget, read, write }). */
export const CustomField = (name, label, control, options = {}) =>
  field('custom')(name, label, { control, ...options });
