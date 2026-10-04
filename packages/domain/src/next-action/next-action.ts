import type { OpportunityStatus, TaskStatus, TaskType } from '../shared/vocabulary';
import { dueSortKey, dueState, type DueState, type TaskDue } from '../task/due';

/**
 * Core RENVARA rule: "No active sales opportunity should exist without a known
 * next action." (ADR-0004)
 *
 * The next action of an opportunity is its earliest open task. It is DERIVED,
 * never stored on the opportunity, so it cannot drift from the task list.
 * The SQL view public.opportunity_overview implements the same selection; the
 * tests of both must agree.
 */
export interface NextActionCandidate {
  readonly id: string;
  readonly type: TaskType;
  readonly title: string;
  readonly status: TaskStatus;
  readonly due: TaskDue;
  readonly createdAt: Date;
}

export function selectNextAction<T extends NextActionCandidate>(
  tasks: readonly T[],
  organizationTimeZone: string,
): T | null {
  let best: { task: T; key: number | null } | null = null;
  for (const task of tasks) {
    if (task.status !== 'open') continue;
    const key = dueSortKey(task.due, organizationTimeZone);
    if (best === null || compareCandidates(task, key, best.task, best.key) < 0) {
      best = { task, key };
    }
  }
  return best?.task ?? null;
}

function compareCandidates(
  a: NextActionCandidate,
  aKey: number | null,
  b: NextActionCandidate,
  bKey: number | null,
): number {
  if (aKey !== bKey) {
    if (aKey === null) return 1; // nulls last
    if (bKey === null) return -1;
    return aKey - bKey;
  }
  const byCreation = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreation !== 0) return byCreation;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type AttentionReason = 'missing_next_action' | 'next_action_overdue';

/**
 * Why an opportunity needs the user's attention right now (empty = fine).
 * Closed opportunities never need a next action.
 */
export function attentionReasons(
  opportunity: { readonly status: OpportunityStatus },
  nextAction: Pick<NextActionCandidate, 'due'> | null,
  now: Date,
  viewerTimeZone: string,
): AttentionReason[] {
  if (opportunity.status !== 'active') return [];
  if (nextAction === null) return ['missing_next_action'];
  const state: DueState = dueState(nextAction.due, now, viewerTimeZone);
  return state === 'overdue' ? ['next_action_overdue'] : [];
}
