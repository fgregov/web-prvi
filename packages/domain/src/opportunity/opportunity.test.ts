import { describe, expect, it } from 'vitest';
import {
  changeStage,
  markLost,
  markWon,
  reopen,
  type OpportunityLifecycleState,
} from './opportunity';

const active: OpportunityLifecycleState = {
  stage: 'proposal',
  status: 'active',
  closedAt: null,
  lostReason: null,
};
const at = new Date('2026-10-04T10:00:00Z');

describe('opportunity lifecycle', () => {
  it('moves stage forwards and backwards while active', () => {
    expect(changeStage(active, 'negotiation')).toEqual({
      ok: true,
      value: { ...active, stage: 'negotiation' },
    });
    expect(changeStage(active, 'qualified').ok).toBe(true);
  });

  it('rejects no-op stage changes and stage changes on closed deals', () => {
    expect(changeStage(active, 'proposal')).toEqual({ ok: false, error: 'stage_unchanged' });
    const won = markWon(active, at);
    if (!won.ok) throw new Error('expected success');
    expect(changeStage(won.value, 'negotiation')).toEqual({
      ok: false,
      error: 'opportunity_not_active',
    });
  });

  it('closes as lost with a trimmed reason and keeps the stage', () => {
    const lost = markLost(active, at, '  Budget cut  ');
    expect(lost).toEqual({
      ok: true,
      value: { stage: 'proposal', status: 'lost', closedAt: at, lostReason: 'Budget cut' },
    });
  });

  it('cannot close twice', () => {
    const won = markWon(active, at);
    if (!won.ok) throw new Error('expected success');
    expect(markLost(won.value, at, null)).toEqual({ ok: false, error: 'opportunity_not_active' });
  });

  it('reopening clears closure data (mirrors private.opportunity_lifecycle)', () => {
    const lost = markLost(active, at, 'Timing');
    if (!lost.ok) throw new Error('expected success');
    expect(reopen(lost.value)).toEqual({ ok: true, value: active });
    expect(reopen(active)).toEqual({ ok: false, error: 'opportunity_already_active' });
  });
});
