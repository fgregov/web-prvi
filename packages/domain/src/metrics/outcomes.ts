/**
 * Closed-outcome rates (opportunities): only closed deals form the cohort.
 *   won rate  = won ÷ (won + lost) · 100
 *   lost rate = lost ÷ (won + lost) · 100
 * Undefined (null, shown as "—") when nothing was closed: never a made-up 0 %.
 */
export interface OutcomeRates {
  won: number;
  lost: number;
  closed: number;
  wonRate: number | null;
  lostRate: number | null;
}

export function outcomeRates({ won, lost }: { won: number; lost: number }): OutcomeRates {
  const closed = won + lost;
  return {
    won,
    lost,
    closed,
    wonRate: closed > 0 ? (won / closed) * 100 : null,
    lostRate: closed > 0 ? (lost / closed) * 100 : null,
  };
}

/**
 * Exact money sums: amounts become integer cents before adding, so totals
 * never carry floating-point drift. Only one currency is summed; amounts in
 * any other currency are counted as excluded, never converted silently.
 */
export interface MoneySum {
  currency: string;
  /** Total in the currency's minor unit (cents). */
  cents: number;
  /** Amounts left out because they are in another currency. */
  excluded: number;
}

export const toCents = (amount: number): number => Math.round(amount * 100);

export function sumMoney(
  items: ReadonlyArray<{ amount: number | null; currency: string | null }>,
  currency = 'EUR',
): MoneySum {
  let cents = 0;
  let excluded = 0;
  for (const item of items) {
    if (item.amount === null) continue;
    if ((item.currency ?? currency) !== currency) excluded += 1;
    else cents += toCents(item.amount);
  }
  return { currency, cents, excluded };
}
