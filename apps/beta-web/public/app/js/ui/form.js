// Declarative form sections (screens and drawers): labels, required markers, inline errors,
// a11y wiring. Field definitions come from ui/fields.js (FormField, SelectField, ...).
import { h, uid } from './dom.js';
import { icon } from './icons.js';

/**
 * Field definition:
 *   { name, label, type: 'text'|'email'|'tel'|'url'|'number'|'date'|'time'|'select'|'textarea'|'readonly'|'segmented'|'switch'|'custom',
 *     value, required, placeholder, options: [{value,label}], full, hint, inputmode, autocomplete, min, max, step, rows,
 *     hidden, onChange(value),
 *     control (custom only): { element, focusTarget, read(), write(value) } }
 */
export function createForm(sections, { notice, single = false } = {}) {
  const controls = new Map(); // name → { field, control, error, def }
  const element = h(
    'div',
    { class: single ? 'rv-form rv-form--single' : 'rv-form' },
    notice ? h('p', { class: 'rv-notice' }, icon('info'), h('span', {}, notice)) : null,
    sections.map((section) =>
      h(
        'section',
        { class: 'rv-form__section' },
        section.title ? h('h3', { class: 'rv-form__section-title' }, section.title) : null,
        h('div', { class: 'rv-form__grid' }, section.fields.map(buildField)),
      ),
    ),
  );

  function buildField(def) {
    const id = uid(`f-${def.name}`);
    const errorId = `${id}-error`;
    const hintId = def.hint ? `${id}-hint` : null;
    const error = h('p', { class: 'rv-field__error', id: errorId, hidden: true });
    let control;

    if (def.type === 'custom') {
      control = def.control.element;
      (def.control.focusTarget ?? control).id = id;
    } else if (def.type === 'switch') {
      control = h('input', {
        class: 'rv-switch__input',
        id,
        name: def.name,
        type: 'checkbox',
        role: 'switch',
        checked: Boolean(def.value),
      });
    } else if (def.type === 'segmented') {
      control = h(
        'div',
        { class: 'rv-segmented', role: 'radiogroup', 'aria-labelledby': `${id}-label` },
        def.options.map((option) =>
          h(
            'label',
            { class: 'rv-segmented__option' },
            h('input', {
              type: 'radio',
              name: `${id}-${def.name}`,
              value: option.value,
              checked: option.value === def.value,
            }),
            h('span', {}, option.label),
          ),
        ),
      );
    } else if (def.type === 'select') {
      control = h(
        'select',
        { class: 'rv-input', id, name: def.name },
        def.options.map((option) =>
          h('option', { value: option.value, selected: option.value === def.value }, option.label),
        ),
      );
    } else if (def.type === 'textarea') {
      control = h('textarea', {
        class: 'rv-input',
        id,
        name: def.name,
        rows: def.rows ?? 3,
        placeholder: def.placeholder,
      });
      control.value = def.value ?? '';
    } else {
      control = h('input', {
        class: 'rv-input',
        id,
        name: def.name,
        type: def.type === 'readonly' ? 'text' : (def.type ?? 'text'),
        readonly: def.type === 'readonly',
        placeholder: def.placeholder,
        inputmode: def.inputmode,
        autocomplete: def.autocomplete ?? 'off',
        min: def.min,
        max: def.max,
        step: def.step,
        maxlength: def.maxlength,
      });
      control.value = def.value ?? '';
    }

    const focusTarget = def.type === 'custom' ? (def.control.focusTarget ?? control) : control;
    if (def.type !== 'segmented') {
      if (def.required) focusTarget.setAttribute('aria-required', 'true');
      focusTarget.setAttribute('aria-describedby', [hintId, errorId].filter(Boolean).join(' '));
    }
    control.addEventListener('input', () => clearError(def.name));
    control.addEventListener('change', () => {
      clearError(def.name);
      def.onChange?.(readValue({ control, def }));
    });

    const labelEl =
      def.type === 'switch'
        ? null
        : def.type === 'segmented'
          ? h('span', { class: 'rv-field__label', id: `${id}-label` }, def.label)
          : h(
              'label',
              { class: 'rv-field__label', for: id },
              def.label,
              def.required
                ? h('span', { class: 'rv-field__req', 'aria-hidden': 'true' }, ' *')
                : null,
            );

    const body =
      def.type === 'switch'
        ? h(
            'label',
            { class: 'rv-switch', for: id },
            h('span', { class: 'rv-switch__text' }, def.label),
            control,
            h('span', { class: 'rv-switch__track', 'aria-hidden': 'true' }),
          )
        : control;
    const field = h(
      'div',
      {
        class: `rv-field${def.full ? ' rv-field--full' : ''}${def.type === 'switch' ? ' rv-field--switch' : ''}`,
        dataset: { field: def.name },
        hidden: def.hidden,
      },
      labelEl,
      body,
      def.hint ? h('p', { class: 'rv-field__hint', id: hintId }, def.hint) : null,
      error,
    );
    controls.set(def.name, { field, control, error, def, focusTarget });
    return field;
  }

  function readValue({ control, def }) {
    if (def.type === 'custom') return def.control.read();
    if (def.type === 'switch') return control.checked;
    if (def.type === 'segmented') return control.querySelector('input:checked')?.value ?? '';
    return control.value;
  }

  function clearError(name) {
    const entry = controls.get(name);
    if (!entry) return;
    entry.field.classList.remove('rv-field--invalid');
    entry.focusTarget.removeAttribute('aria-invalid');
    entry.error.hidden = true;
    entry.error.textContent = '';
  }

  return {
    element,
    values() {
      const out = {};
      for (const [name, entry] of controls) out[name] = readValue(entry);
      return out;
    },
    control(name) {
      return controls.get(name)?.control ?? null;
    },
    setValue(name, value) {
      const entry = controls.get(name);
      if (!entry) return;
      if (entry.def.type === 'custom') entry.def.control.write(value);
      else if (entry.def.type === 'switch') entry.control.checked = Boolean(value);
      else if (entry.def.type === 'segmented') {
        for (const input of entry.control.querySelectorAll('input'))
          input.checked = input.value === value;
      } else entry.control.value = value;
    },
    /** Shows or hides a field (e.g. calendar fields behind the "Dodaj u Sales Kalendar" switch). */
    setVisible(name, visible) {
      const entry = controls.get(name);
      if (entry) entry.field.hidden = !visible;
    },
    setDisabled(name, disabled) {
      const entry = controls.get(name);
      if (entry) entry.focusTarget.disabled = disabled;
    },
    setOptions(name, options, selected) {
      const entry = controls.get(name);
      if (!entry || entry.def.type !== 'select') return;
      entry.control.replaceChildren(
        ...options.map((o) =>
          h('option', { value: o.value, selected: o.value === selected }, o.label),
        ),
      );
    },
    /** Marks invalid fields, focuses the first one. Returns true when there were errors. */
    setErrors(errors) {
      for (const name of controls.keys()) clearError(name);
      let first = null;
      for (const [name, message] of Object.entries(errors)) {
        const entry = controls.get(name);
        if (!entry || entry.field.hidden) continue;
        entry.field.classList.add('rv-field--invalid');
        entry.focusTarget.setAttribute('aria-invalid', 'true');
        entry.error.replaceChildren(icon('alert', 'rv-icon rv-icon--sm'), h('span', {}, message));
        entry.error.hidden = false;
        first ??=
          entry.def.type === 'segmented' ? entry.control.querySelector('input') : entry.focusTarget;
      }
      first?.focus();
      first?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      return first !== null;
    },
  };
}
