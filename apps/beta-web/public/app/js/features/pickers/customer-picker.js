// CustomerPicker: a field-sized button that opens a searchable bottom sheet
// (name or OIB, searched on the server). Value = customer id.
import { api } from '../../core/api.js';
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openSheet } from '../../ui/sheet.js';

const SEARCH_DELAY_MS = 180;

/**
 * @param {{ placeholder?: string, clearable?: boolean }} [options]
 * @returns {{ element: HTMLElement, focusTarget: HTMLElement, read(): string, write(c): void, selected(): object | null }}
 */
export function CustomerPicker({ placeholder = 'Odaberite kupca', clearable = true } = {}) {
  let selected = null;

  const label = h('span', { class: 'rv-picker__label' });
  const sub = h('span', { class: 'rv-picker__sub' });
  const trigger = h(
    'button',
    { type: 'button', class: 'rv-input rv-picker__trigger', 'aria-haspopup': 'dialog' },
    icon('building', 'rv-icon rv-picker__icon'),
    h('span', { class: 'rv-picker__text' }, label, sub),
    icon('chevron-right', 'rv-icon rv-picker__chevron'),
  );
  const clear = h(
    'button',
    { type: 'button', class: 'rv-icon-btn rv-picker__clear', 'aria-label': 'Ukloni kupca' },
    icon('x'),
  );
  const element = h('div', { class: 'rv-picker' }, trigger, clear);

  function render() {
    label.textContent = selected ? selected.companyName : placeholder;
    sub.textContent = selected
      ? [selected.oib && `OIB ${selected.oib}`, selected.city].filter(Boolean).join(' · ')
      : '';
    sub.hidden = !selected;
    trigger.classList.toggle('is-empty', !selected);
    clear.hidden = !(clearable && selected);
  }

  function set(customer) {
    const changed = (customer?.id ?? '') !== (selected?.id ?? '');
    selected = customer;
    render();
    if (changed) element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  clear.addEventListener('click', () => {
    set(null);
    trigger.focus();
  });

  trigger.addEventListener('click', () => {
    const search = h('input', {
      class: 'rv-input',
      type: 'search',
      placeholder: 'Pretraži po nazivu ili OIB-u',
      'aria-label': 'Pretraži kupce',
      autocomplete: 'off',
      enterkeyhint: 'search',
    });
    const list = h('ul', { class: 'rv-sheet__list', role: 'list', 'aria-live': 'polite' });
    const sheet = openSheet({
      title: 'Odaberi kupca',
      className: 'rv-sheet--picker',
      content: h(
        'div',
        { class: 'rv-sheet__body' },
        search,
        h('div', { class: 'rv-sheet__scroll' }, list),
      ),
      initialFocus: search,
    });

    let timer;
    let latest = 0;
    async function load() {
      const ticket = ++latest;
      try {
        const customers = await api.searchCustomers(search.value.trim());
        if (ticket !== latest) return;
        list.replaceChildren(
          ...(customers.length
            ? customers.map((c) =>
                h(
                  'li',
                  {},
                  h(
                    'button',
                    {
                      type: 'button',
                      class: `rv-sheet__option${c.id === selected?.id ? ' is-selected' : ''}`,
                      onClick: () => {
                        sheet.close();
                        set(c);
                      },
                    },
                    h('strong', {}, c.companyName),
                    h('span', {}, [`OIB ${c.oib}`, c.city].filter(Boolean).join(' · ')),
                  ),
                ),
              )
            : [h('li', { class: 'rv-sheet__empty' }, 'Nema kupaca za ovu pretragu.')]),
        );
      } catch (error) {
        if (ticket === latest)
          list.replaceChildren(h('li', { class: 'rv-sheet__empty' }, error.message));
      }
    }
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(load, SEARCH_DELAY_MS);
    });
    load();
  });

  render();
  return {
    element,
    focusTarget: trigger,
    read: () => selected?.id ?? '',
    /** Accepts a customer object ({ id, companyName, oib, city }) or null. */
    write: (customer) => set(customer && customer.id ? customer : null),
    selected: () => selected,
  };
}
