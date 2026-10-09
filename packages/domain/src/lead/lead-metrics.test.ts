import { describe, expect, it } from 'vitest';
import { leadOutcomeMetrics } from './lead-metrics.ts';

describe('leadOutcomeMetrics', () => {
  it('excludes active leads from win rate and W/L', () => {
    // 40 won, 20 lost, 30 still active — created 90 in the period.
    const m = leadOutcomeMetrics({ created: 90, won: 40, lost: 20 });
    expect(m.closed).toBe(60);
    expect(m.winRate).toBeCloseTo(0.6667, 4);
    expect(m.wlRatio).toBe(2);
    expect(m.conversionRate).toBeCloseTo(0.4444, 4);
  });

  it('matches the Q3 reporting example', () => {
    const m = leadOutcomeMetrics({ created: 42, won: 14, lost: 8 });
    expect(m.wlRatio).toBe(1.75);
    expect(m.winRate).toBeCloseTo(0.636, 3);
    expect(m.conversionRate).toBeCloseTo(0.333, 3);
  });

  it('has no ratios without closed or created leads', () => {
    expect(leadOutcomeMetrics({ created: 0, won: 0, lost: 0 })).toMatchObject({
      winRate: null,
      wlRatio: null,
      conversionRate: null,
    });
    expect(leadOutcomeMetrics({ created: 3, won: 2, lost: 0 }).wlRatio).toBeNull();
  });
});
