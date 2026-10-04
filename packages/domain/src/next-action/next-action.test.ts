import { describe, expect, it } from 'vitest';
import { taskDueFromColumns } from '../task/due';
import { attentionReasons, selectNextAction, type NextActionCandidate } from './next-action';

const ZAGREB = 'Europe/Zagreb';
const created = (iso: string) => new Date(iso);

function task(partial: Partial<NextActionCandidate> & Pick<NextActionCandidate, 'id'>) {
  return {
    type: 'call',
    title: partial.id,
    status: 'open',
    due: { kind: 'none' },
    createdAt: created('2026-10-01T08:00:00Z'),
    ...partial,
  } satisfies NextActionCandidate;
}

describe('selectNextAction', () => {
  it('returns null when there is no open task', () => {
    expect(selectNextAction([], ZAGREB)).toBeNull();
    expect(selectNextAction([task({ id: 'done', status: 'completed' })], ZAGREB)).toBeNull();
  });

  it('picks the earliest effective due moment, undated tasks last', () => {
    const tasks = [
      task({ id: 'undated' }),
      task({ id: 'friday', due: taskDueFromColumns('2026-10-09', null) }),
      task({ id: 'thursday-14h', due: taskDueFromColumns(null, '2026-10-08T12:00:00Z') }),
      task({ id: 'cancelled', status: 'cancelled', due: taskDueFromColumns('2026-10-01', null) }),
    ];
    expect(selectNextAction(tasks, ZAGREB)?.id).toBe('thursday-14h');
  });

  it('treats a date-only due as starting at local midnight (same as the SQL view)', () => {
    const tasks = [
      // 23:30 UTC Oct 8 = 01:30 Oct 9 in Zagreb → after Zagreb midnight of Oct 9.
      task({ id: 'late-night', due: taskDueFromColumns(null, '2026-10-08T23:30:00Z') }),
      task({ id: 'oct-9', due: taskDueFromColumns('2026-10-09', null) }),
    ];
    expect(selectNextAction(tasks, ZAGREB)?.id).toBe('oct-9');
  });

  it('breaks ties by creation time, then id', () => {
    const due = taskDueFromColumns('2026-10-09', null);
    const tasks = [
      task({ id: 'b', due, createdAt: created('2026-10-02T08:00:00Z') }),
      task({ id: 'a', due, createdAt: created('2026-10-02T08:00:00Z') }),
      task({ id: 'c', due, createdAt: created('2026-10-03T08:00:00Z') }),
    ];
    expect(selectNextAction(tasks, ZAGREB)?.id).toBe('a');
  });
});

describe('attentionReasons', () => {
  const now = new Date('2026-10-04T10:00:00Z');

  it('flags an active opportunity without a next action', () => {
    expect(attentionReasons({ status: 'active' }, null, now, ZAGREB)).toEqual([
      'missing_next_action',
    ]);
  });

  it('flags an overdue next action', () => {
    const next = { due: taskDueFromColumns('2026-10-03', null) };
    expect(attentionReasons({ status: 'active' }, next, now, ZAGREB)).toEqual([
      'next_action_overdue',
    ]);
  });

  it('is satisfied by a planned next action', () => {
    const next = { due: taskDueFromColumns('2026-10-04', null) };
    expect(attentionReasons({ status: 'active' }, next, now, ZAGREB)).toEqual([]);
  });

  it('never flags closed opportunities', () => {
    expect(attentionReasons({ status: 'won' }, null, now, ZAGREB)).toEqual([]);
    expect(attentionReasons({ status: 'lost' }, null, now, ZAGREB)).toEqual([]);
  });
});
