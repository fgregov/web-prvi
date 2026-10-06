import { err, ok, type Result } from '../shared/result.ts';
import {
  OPPORTUNITY_STAGES,
  type OpportunityStage,
  type OpportunityStatus,
} from '../shared/vocabulary.ts';

/**
 * Opportunity lifecycle.
 *
 * Two orthogonal dimensions (ADR-0003):
 *   stage  — where the deal is in the pipeline (only meaningful while active,
 *            retained after closing for "lost at stage X" analytics)
 *   status — active | won | lost
 */
export interface OpportunityLifecycleState {
  readonly stage: OpportunityStage;
  readonly status: OpportunityStatus;
  readonly closedAt: Date | null;
  readonly lostReason: string | null;
}

export type LifecycleError =
  | 'opportunity_not_active'
  | 'opportunity_already_active'
  | 'stage_unchanged'
  | 'lost_reason_too_long';

export const LOST_REASON_MAX_LENGTH = 1000;

export function isActive(o: Pick<OpportunityLifecycleState, 'status'>): boolean {
  return o.status === 'active';
}

export function stageIndex(stage: OpportunityStage): number {
  return OPPORTUNITY_STAGES.indexOf(stage);
}

/** Stages may move forwards or backwards (deals do regress), but only while active. */
export function changeStage<T extends OpportunityLifecycleState>(
  o: T,
  stage: OpportunityStage,
): Result<T, LifecycleError> {
  if (!isActive(o)) return err('opportunity_not_active');
  if (o.stage === stage) return err('stage_unchanged');
  return ok({ ...o, stage });
}

export function markWon<T extends OpportunityLifecycleState>(
  o: T,
  at: Date,
): Result<T, LifecycleError> {
  if (!isActive(o)) return err('opportunity_not_active');
  return ok({ ...o, status: 'won', closedAt: at, lostReason: null });
}

export function markLost<T extends OpportunityLifecycleState>(
  o: T,
  at: Date,
  reason: string | null,
): Result<T, LifecycleError> {
  if (!isActive(o)) return err('opportunity_not_active');
  const trimmed = reason?.trim() || null;
  if (trimmed && trimmed.length > LOST_REASON_MAX_LENGTH) return err('lost_reason_too_long');
  return ok({ ...o, status: 'lost', closedAt: at, lostReason: trimmed });
}

export function reopen<T extends OpportunityLifecycleState>(o: T): Result<T, LifecycleError> {
  if (isActive(o)) return err('opportunity_already_active');
  return ok({ ...o, status: 'active', closedAt: null, lostReason: null });
}
