import { escapeHtml, fmtQty } from './format.js';

export interface LowStockItem {
  name: string;
  code: string;
  unit: string;
  available: number;
  minStock: number;
  orderQty: number;
  supplierName: string | null;
}

const PETROL = '#0f5e63';

function table(items: LowStockItem[]): { text: string; html: string } {
  const header = ['Artikl', 'Stanje', 'Minimum', 'Naručiti'];
  const rows = items.map((i) => [i.name, fmtQty(i.available, i.unit), fmtQty(i.minStock, i.unit), fmtQty(i.orderQty, i.unit)]);
  const widths = header.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)));
  const line = (cells: string[]) => cells.map((v, c) => (c === 0 ? v.padEnd(widths[c]) : v.padStart(widths[c]))).join('   ');
  const text = [line(header), widths.map((w) => '-'.repeat(w)).join('   '), ...rows.map(line)].join('\n');
  const th = (v: string, right = false) =>
    `<th style="text-align:${right ? 'right' : 'left'};padding:8px 12px;border-bottom:2px solid ${PETROL};font-size:13px;color:#334155">${escapeHtml(v)}</th>`;
  const td = (v: string, right = false) =>
    `<td style="text-align:${right ? 'right' : 'left'};padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a">${escapeHtml(v)}</td>`;
  const html = `<table style="border-collapse:collapse;min-width:420px;margin:16px 0">
<thead><tr>${th('Artikl')}${th('Stanje', true)}${th('Minimum', true)}${th('Naručiti', true)}</tr></thead>
<tbody>${rows.map((r) => `<tr>${td(r[0])}${td(r[1], true)}${td(r[2], true)}${td(r[3], true)}</tr>`).join('')}</tbody></table>`;
  return { text, html };
}

function wrapHtml(body: string): string {
  return `<!doctype html><html lang="hr"><body style="margin:0;padding:24px;background:#f4f7f7;font-family:Segoe UI,Arial,sans-serif">
<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px;border:1px solid #e2e8f0">
${body}
<p style="margin-top:28px;color:${PETROL};font-weight:600;font-size:15px;margin-bottom:0">VendiStock</p>
<p style="margin-top:2px;color:#64748b;font-size:13px">Inventory &amp; Sales Intelligence</p>
</div></body></html>`;
}

export function lowStockEmail(items: LowStockItem[], kind: 'alert' | 'reminder') {
  const subject =
    kind === 'alert' ? 'VendiStock – Upozorenje o niskim zalihama' : 'VendiStock – Dnevni podsjetnik o niskim zalihama';
  const intro =
    kind === 'alert'
      ? 'Sustav VendiStock evidentirao je artikle čije su zalihe pale ispod definirane minimalne količine.'
      : 'Sljedeći artikli i dalje imaju zalihe ispod definirane minimalne količine.';
  const t = table(items);
  const text = [
    'Poštovani,',
    '',
    intro,
    '',
    'U nastavku se nalazi preporučena lista za nabavu:',
    '',
    t.text,
    '',
    'Podaci su informativni i generirani na temelju aktualne lokalne skladišne evidencije.',
    '',
    'VendiStock',
    'Inventory & Sales Intelligence',
  ].join('\n');
  const html = wrapHtml(`<p style="font-size:15px;color:#0f172a">Poštovani,</p>
<p style="font-size:15px;color:#0f172a">${escapeHtml(intro)}</p>
<p style="font-size:15px;color:#0f172a">U nastavku se nalazi preporučena lista za nabavu:</p>
${t.html}
<p style="font-size:13px;color:#64748b">Podaci su informativni i generirani na temelju aktualne lokalne skladišne evidencije.</p>`);
  return { subject, text, html };
}

export function testEmail() {
  const subject = 'VendiStock – Testna poruka';
  const text =
    'Ovo je testna poruka sustava VendiStock.\n\nAko ste je primili, postavke e-pošte su ispravne.\n\nVendiStock\nInventory & Sales Intelligence';
  const html = wrapHtml(
    '<p style="font-size:15px;color:#0f172a">Ovo je testna poruka sustava VendiStock.</p><p style="font-size:15px;color:#0f172a">Ako ste je primili, postavke e-pošte su ispravne.</p>',
  );
  return { subject, text, html };
}
