const nf = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 3 });
const mf = new Intl.NumberFormat('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtNum = (n: number) => nf.format(n);
export const fmtMoney = (n: number) => `${mf.format(n)} €`;
/** Količina s jedinicom; za komade se jedinica izostavlja (kao u primjeru e-maila). */
export const fmtQty = (n: number, unit: string) => (unit === 'kom' ? fmtNum(n) : `${fmtNum(n)} ${unit}`);

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
