import { describe, expect, it } from 'vitest';
import { dueSortKey, dueState, effectiveDueFromColumns, taskDueFromColumns } from './due.ts';

const ZAGREB = 'Europe/Zagreb';

describe('taskDueFromColumns', () => {
  it('maps the two mutually exclusive columns', () => {
    expect(taskDueFromColumns(null, null)).toEqual({ kind: 'none' });
    expect(taskDueFromColumns('2026-10-09', null)).toEqual({ kind: 'date', date: '2026-10-09' });
    expect(taskDueFromColumns(null, '2026-10-09T12:00:00Z')).toEqual({
      kind: 'instant',
      at: new Date('2026-10-09T12:00:00Z'),
    });
    expect(() => taskDueFromColumns('2026-10-09', '2026-10-09T12:00:00Z')).toThrow(RangeError);
  });
});

describe('effectiveDueFromColumns', () => {
  it('uses the deadline, else the calendar slot', () => {
    const slot = '2026-10-09T09:00:00Z';
    expect(effectiveDueFromColumns('2026-10-10', null, slot)).toEqual({
      kind: 'date',
      date: '2026-10-10',
    });
    expect(effectiveDueFromColumns(null, null, slot)).toEqual({
      kind: 'instant',
      at: new Date(slot),
    });
    expect(effectiveDueFromColumns(null, null, null)).toEqual({ kind: 'none' });
  });
});

describe('dueState', () => {
  // 23:30 UTC on Oct 4 is already Oct 5 in Zagreb.
  const now = new Date('2026-10-04T23:30:00Z');

  it('evaluates date-only dues in the viewer timezone', () => {
    const due = taskDueFromColumns('2026-10-04', null);
    expect(dueState(due, now, 'UTC')).toBe('due_today');
    expect(dueState(due, now, ZAGREB)).toBe('overdue');
    expect(dueState(taskDueFromColumns('2026-10-05', null), now, ZAGREB)).toBe('due_today');
    expect(dueState(taskDueFromColumns('2026-10-06', null), now, ZAGREB)).toBe('upcoming');
  });

  it('evaluates exact dues as instants', () => {
    expect(dueState(taskDueFromColumns(null, '2026-10-04T23:00:00Z'), now, ZAGREB)).toBe('overdue');
    expect(dueState(taskDueFromColumns(null, '2026-10-05T08:00:00Z'), now, ZAGREB)).toBe(
      'due_today',
    );
    expect(dueState(taskDueFromColumns(null, '2026-10-06T08:00:00Z'), now, ZAGREB)).toBe(
      'upcoming',
    );
  });

  it('reports tasks without a due', () => {
    expect(dueState({ kind: 'none' }, now, ZAGREB)).toBe('no_due');
  });
});

describe('dueSortKey', () => {
  it('orders date-only dues from the start of the day in the organization timezone', () => {
    expect(dueSortKey(taskDueFromColumns('2026-10-09', null), ZAGREB)).toBe(
      Date.parse('2026-10-08T22:00:00Z'),
    );
    expect(dueSortKey({ kind: 'none' }, ZAGREB)).toBeNull();
  });
});
