// LeadPicker: a field-sized button that opens a searchable bottom sheet of the
// organization's leads (name or company, searched on the server), like the
// CustomerPicker. Leads closed as lost are not offered: they get no new deals
// (ADR-0009). Value = lead id.
import { api } from '../../core/api.js';
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openSheet } from '../../ui/sheet.js';

const SEARCH_DELAY_MS = 180;
const label = (lead) => [lead.name, lead.companyName].filter(Boolean).join(' · ');

/**
 * @param {{ placeholder?: string }} [options]
 * @returns {{ element: HTMLElement, focusTarget: HTMLElement, read(): string, write(lead): void, selected(): object | null }}
 */
export function LeadPicker({ placeholder = 'Odaberite lead' } = {}) {
  let selected = null;

  const text = h('span', { class: 'rv-picker__label' });
  const sub = h('span', { class: 'rv-picker__sub' });
  const trigger = h(
    'button',
    { type: 'button', class: 'rv-input rv-picker__trigger', 'aria-haspopup': 'dialog' },
    icon('user-search', 'rv-icon rv-picker__icon'),
    h('span', { class: 'rv-picker__text' }, text, sub),
    icon('chevron-right', 'rv-icon rv-picker__chevron'),
  );
  const element = h('div', { class: 'rv-picker' }, trigger);

  function render() {
    text.textContent = selected ? selected.name : placeholder;
    sub.textContent = selected
      ? [
          selected.companyName,
          selected.status === 'won' ? 'Osvojen' : selected.status === 'active' ? 'Aktivan' : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
    sub.hidden = !selected;
    trigger.classList.toggle('is-empty', !selected);
  }

  function set(lead) {
    const changed = (lead?.id ?? '') !== (selected?.id ?? '');
    selected = lead;
    render();
    if (changed) element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  trigger.addEventListener('click', () => {
    const search = h('input', {
      class: 'rv-input',
      type: 'search',
      placeholder: 'Pretraži po imenu ili tvrtki',
      'aria-label': 'Pretraži leadove',
      autocomplete: 'off',
      enterkeyhint: 'search',
    });
    const list = h('ul', { class: 'rv-sheet__list', role: 'list', 'aria-live': 'polite' });
    const sheet = openSheet({
      title: 'Odaberi lead',
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
        const leads = (await api.listLeads({ q: search.value.trim() })).filter(
          (l) => l.status !== 'lost',
        );
        if (ticket !== latest) return;
        list.replaceChildren(
          ...(leads.length
            ? leads.map((lead) =>
                h(
                  'li',
                  {},
                  h(
                    'button',
                    {
                      type: 'button',
                      class: `rv-sheet__option${lead.id === selected?.id ? ' is-selected' : ''}`,
                      onClick: () => {
                        sheet.close();
                        set(lead);
                      },
                    },
                    h('strong', {}, lead.name),
                    h(
                      'span',
                      {},
                      [lead.companyName, lead.status === 'won' ? 'Osvojen' : 'Aktivan']
                        .filter(Boolean)
                        .join(' · '),
                    ),
                  ),
                ),
              )
            : [h('li', { class: 'rv-sheet__empty' }, 'Nema leadova za ovu pretragu.')]),
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
    /** Accepts a lead ({ id, name, companyName, status }) or null. */
    write: (lead) => set(lead && lead.id ? lead : null),
    selected: () => selected,
    label: () => (selected ? label(selected) : ''),
  };
}
