// DEMO ONLY: period metrics the BETA dataset is too small to produce, so the
// Home dashboard has realistic numbers for the current and past quarters.
// Real records of the period are always added on top (dashboard-service.ts),
// like PIPELINE_BASELINE does for the live pipeline. Remove this file when
// Renvara runs on real data; nothing else depends on its values.
//
// Keyed by quarter offset from the current quarter: 0 = current (to date),
// -1 = previous quarter, … Older quarters have no demo history.

export interface PeriodMetrics {
  newLeads: number;
  qualified: number;
  meetings: number;
  won: number;
  lost: number;
  /** Value won in the period, in cents (EUR). */
  revenue: number;
  /** Estimated value of opportunities created in the period, in cents (EUR). */
  potential: number;
  /** Opportunities left out of revenue / potential because they are not in EUR. */
  wonOtherCurrency: number;
  potentialOtherCurrency: number;
  /** Opportunities with a negotiation event in the period (distinct). */
  negotiations: number;
  tasksDone: number;
  tasksNotDone: number;
  followUpsDone: number;
  followUpsNoAnswer: number;
  followUpsOpen: number;
  /** Opportunities that reached each stage in the period (funnel). */
  stageNew: number;
  stageInProgress: number;
  stageOfferSent: number;
  stageNegotiation: number;
  /** Leads converted (won) / closed as lost in the period — lead outcomes, not opportunities. */
  leadsWon: number;
  leadsLost: number;
}

export const ZERO_METRICS: PeriodMetrics = {
  newLeads: 0,
  qualified: 0,
  meetings: 0,
  won: 0,
  lost: 0,
  revenue: 0,
  potential: 0,
  wonOtherCurrency: 0,
  potentialOtherCurrency: 0,
  negotiations: 0,
  tasksDone: 0,
  tasksNotDone: 0,
  followUpsDone: 0,
  followUpsNoAnswer: 0,
  followUpsOpen: 0,
  stageNew: 0,
  stageInProgress: 0,
  stageOfferSent: 0,
  stageNegotiation: 0,
  leadsWon: 0,
  leadsLost: 0,
};

const quarter = (
  values: [number, number, number, number, number, number],
  tasks: [number, number],
  followUps: [number, number, number],
  stages: [number, number, number, number],
  leadOutcomes: [number, number],
): PeriodMetrics => {
  const [newLeads, qualified, meetings, won, lost, revenue] = values;
  return {
    newLeads,
    qualified,
    meetings,
    won,
    lost,
    revenue: revenue * 100,
    // No demo numbers for these: they always come from records only.
    potential: 0,
    wonOtherCurrency: 0,
    potentialOtherCurrency: 0,
    negotiations: 0,
    tasksDone: tasks[0],
    tasksNotDone: tasks[1],
    followUpsDone: followUps[0],
    followUpsNoAnswer: followUps[1],
    followUpsOpen: followUps[2],
    stageNew: stages[0],
    stageInProgress: stages[1],
    stageOfferSent: stages[2],
    stageNegotiation: stages[3],
    leadsWon: leadOutcomes[0],
    leadsLost: leadOutcomes[1],
  };
};

export const DEMO_QUARTERS: Record<number, PeriodMetrics> = {
  0: quarter([18, 7, 12, 3, 1, 18400], [21, 2], [9, 1, 4], [18, 11, 6, 3], [5, 2]),
  [-1]: quarter([42, 21, 26, 9, 7, 31800], [34, 3], [28, 4, 2], [42, 28, 18, 11], [14, 8]),
  [-2]: quarter([38, 18, 22, 7, 6, 24100], [29, 4], [23, 5, 0], [38, 24, 15, 9], [12, 7]),
  [-3]: quarter([31, 14, 19, 5, 5, 18200], [25, 3], [19, 3, 0], [31, 20, 12, 7], [10, 6]),
  [-4]: quarter([27, 12, 16, 4, 6, 15400], [22, 5], [16, 4, 0], [27, 17, 10, 6], [8, 6]),
};

/**
 * Customers that first bought in each quarter (keyed like DEMO_QUARTERS). BUYERS
 * of a year adds those of the same calendar year up to the end of the period.
 */
export const DEMO_NEW_BUYERS: Record<number, number> = { 0: 2, [-1]: 6, [-2]: 5, [-3]: 4, [-4]: 3 };

/** The current quarter is still running: what the previous quarter had after as many days. */
export const DEMO_CURRENT_TO_DATE_PREVIOUS: PeriodMetrics = quarter(
  [16, 6, 10, 2, 1, 14000],
  [19, 2],
  [8, 1, 3],
  [16, 10, 5, 3],
  [4, 2],
);
