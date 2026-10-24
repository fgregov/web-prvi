/** Zaokruživanje količina (3 decimale) i iznosa kako bi se izbjegle greške pomičnog zareza. */
export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round((value + Number.EPSILON * Math.sign(value)) * f) / f;
  return Object.is(r, -0) ? 0 : r;
}
export const roundQty = (v: number) => round(v, 3);
export const roundMoney = (v: number) => round(v, 2);
export const roundPrice = (v: number) => round(v, 4);

/**
 * Parsira broj iz teksta izvještaja. decimalSeparator ',' odgovara hrvatskom formatu (1.234,56).
 * Vraća null ako vrijednost nije broj.
 */
export function parseLocaleNumber(
  input: unknown,
  decimalSeparator: ',' | '.' | 'auto' = 'auto',
): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/[\s  ]/g, '').replace(/(EUR|€|HRK|kn|kom|kg|l)$/i, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  let sep = decimalSeparator;
  if (sep === 'auto') {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) sep = lastComma > lastDot ? ',' : '.';
    else if (lastComma >= 0) sep = ',';
    else sep = '.';
  }
  if (sep === ',') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Zaokruži preporučenu količinu na cijela dobavljačka pakiranja (prema gore). */
export function roundUpToPack(qty: number, packSize: number): number {
  if (qty <= 0) return 0;
  if (!packSize || packSize <= 0) return roundQty(qty);
  const packs = Math.ceil(roundQty(qty / packSize) - 1e-9);
  return roundQty(packs * packSize);
}
