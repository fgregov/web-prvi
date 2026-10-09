/**
 * Lead outcome metrics for a period. Each count is taken by its own date:
 * created by created_at, won by converted_at, lost by lost_at — so a lead
 * created in Q3 and converted in Q4 is a Q3 "new" lead and a Q4 "won" lead.
 *
 *   win rate        = won / (won + lost)    — closed leads only; active leads never count
 *   W/L ratio       = won / lost            — null while nothing was lost
 *   conversion rate = won / created         — leads won per lead created in the period
 *
 * Lead W/L is NOT opportunity W/L: one customer may come from one lead and
 * later win or lose many opportunities.
 */
export interface LeadOutcomeCounts {
  readonly created: number;
  readonly won: number;
  readonly lost: number;
}

export interface LeadOutcomeMetrics extends LeadOutcomeCounts {
  readonly closed: number;
  /** 0..1, or null when no lead was closed. */
  readonly winRate: number | null;
  readonly wlRatio: number | null;
  /** 0..1, or null when no lead was created. */
  readonly conversionRate: number | null;
}

export function leadOutcomeMetrics({ created, won, lost }: LeadOutcomeCounts): LeadOutcomeMetrics {
  const closed = won + lost;
  return {
    created,
    won,
    lost,
    closed,
    winRate: closed > 0 ? won / closed : null,
    wlRatio: lost > 0 ? won / lost : null,
    conversionRate: created > 0 ? won / created : null,
  };
}
