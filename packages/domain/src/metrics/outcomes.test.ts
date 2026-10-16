import { describe, expect, it } from 'vitest';
import { outcomeRates, sumMoney } from './outcomes.ts';

describe('outcome rates', () => {
  it('uses closed deals only', () => {
    const r = outcomeRates({ won: 12, lost: 6 });
    expect(r.closed).toBe(18);
    expect(r.wonRate?.toFixed(1)).toBe('66.7');
    expect(r.lostRate?.toFixed(1)).toBe('33.3');
    expect((r.wonRate ?? 0) + (r.lostRate ?? 0)).toBeCloseTo(100);
  });

  it('is undefined, not zero, when nothing was closed', () => {
    expect(outcomeRates({ won: 0, lost: 0 })).toMatchObject({ wonRate: null, lostRate: null });
    expect(outcomeRates({ won: 3, lost: 0 })).toMatchObject({ wonRate: 100, lostRate: 0 });
  });
});

describe('money sums', () => {
  it('adds in cents, without floating-point drift', () => {
    const items = Array.from({ length: 10 }, () => ({ amount: 0.1, currency: 'EUR' }));
    expect(sumMoney(items).cents).toBe(100);
    expect(
      sumMoney([
        { amount: 1234.56, currency: 'EUR' },
        { amount: 0.44, currency: 'EUR' },
      ]).cents,
    ).toBe(123500);
  });

  it('never mixes currencies', () => {
    expect(
      sumMoney([
        { amount: 1000, currency: 'EUR' },
        { amount: 500, currency: 'USD' },
        { amount: null, currency: 'EUR' },
      ]),
    ).toEqual({ currency: 'EUR', cents: 100000, excluded: 1 });
  });
});
