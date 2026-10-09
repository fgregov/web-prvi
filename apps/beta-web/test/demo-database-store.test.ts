// Demo test database (demo/database-store.js) against a fake artifact `db`
// that misbehaves the way the platform may: a call that is never answered,
// refused bursts (resource_exhausted), a refusal in the middle of a save.
// These are the conditions behind the Lead → Task "freeze".
import { describe, expect, it } from 'vitest';
import { databaseStore, WRITE_ORDER } from '../demo/database-store.js';

type Doc = Record<string, unknown>;
type Fault = (op: 'set' | 'delete', path: string) => 'hang' | { code: string } | null;

function fakeDb(initial: Record<string, Doc> = {}) {
  const docs = new Map<string, string>(
    Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]),
  );
  const log: string[] = [];
  let fault: Fault = () => null;
  const run = (op: 'set' | 'delete', path: string, apply: () => void) => {
    const f = fault(op, path);
    if (f === 'hang') return new Promise<void>(() => {});
    if (f) return Promise.reject(f);
    apply();
    log.push(`${op} ${path}`);
    return Promise.resolve();
  };
  const db = {
    doc: (path: string) => ({
      set: (data: Doc) => run('set', path, () => docs.set(path, JSON.stringify(data))),
      delete: () => run('delete', path, () => docs.delete(path)),
    }),
    collection: (name: string) => ({
      limit: () => ({
        get: async () => ({
          docs: [...docs]
            .filter(([k]) => k.split('/')[0] === name)
            .map(([k, v]) => ({ id: k.split('/')[1], data: () => JSON.parse(v) as Doc })),
        }),
      }),
    }),
  };
  return {
    db,
    log,
    docs,
    fail(next: Fault) {
      fault = next;
    },
    doc: (path: string) => (docs.has(path) ? (JSON.parse(docs.get(path)!) as Doc) : undefined),
  };
}

const collections = ['customers', 'contacts', 'opportunities', 'tasks', 'activities', 'leads'];
const empty = () => ({
  version: 2,
  seq: 0,
  customers: [] as Doc[],
  contacts: [] as Doc[],
  opportunities: [] as Doc[],
  tasks: [] as Doc[],
  activities: [] as Doc[],
  leads: [] as Doc[],
});
const open = (fake: ReturnType<typeof fakeDb>) =>
  databaseStore(fake.db, { collections, empty, limitMs: 40, retryDelayMs: () => 5 });

const lead = { id: 'l1', name: 'Termotechnik', stage: 'qualified' };

describe('Demo test database', () => {
  it('writes records before their history, one document at a time', async () => {
    const fake = fakeDb();
    const store = open(fake);
    const data = await store.load();
    data.activities.push({ id: 'a1', type: 'lead_created', seq: 1 });
    data.leads.push(lead);
    data.tasks.push({ id: 't1', title: 'Follow-up', leadId: 'l1' });
    await store.save(data);
    expect(fake.log).toEqual(['set leads/l1', 'set tasks/t1', 'set activities/a1']);
    expect(WRITE_ORDER.indexOf('activities')).toBe(WRITE_ORDER.length - 1);
  });

  it('a call that is never answered fails the save instead of hanging (the "freeze")', async () => {
    const fake = fakeDb({ 'leads/l1': lead });
    const store = open(fake);
    const data = await store.load();
    data.leads[0] = { ...lead, stage: 'new' };
    data.activities.push({ id: 'a1', type: 'lead_stage_changed', seq: 1 });
    fake.fail((op, path) => (path === 'leads/l1' ? 'hang' : null));
    const started = Date.now();
    await expect(store.save(data)).rejects.toMatchObject({ code: 'unavailable' });
    expect(Date.now() - started).toBeLessThan(1000);
    // Nothing half-saved: no lonely history entry, and the page continues from the database.
    expect(fake.doc('activities/a1')).toBeUndefined();
    expect(store.current().leads).toEqual([lead]);
    expect(store.current().activities).toEqual([]);

    // The next request (the Task) is not blocked by the failed one.
    fake.fail(() => null);
    const next = store.current();
    next.tasks.push({ id: 't1', title: 'Follow-up', leadId: 'l1' });
    await store.save(next);
    expect(fake.doc('tasks/t1')).toMatchObject({ leadId: 'l1' });
  });

  it('a refusal in the middle of a save puts back what was already written', async () => {
    const fake = fakeDb({ 'leads/l1': lead });
    const store = open(fake);
    const data = await store.load();
    data.leads[0] = { ...lead, stage: 'contacted' };
    data.activities.push({ id: 'a1', type: 'lead_stage_changed', seq: 1 });
    fake.fail((op, path) => (path.startsWith('activities/') ? { code: 'quota_exceeded' } : null));
    await expect(store.save(data)).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(fake.doc('leads/l1')).toEqual(lead); // the stage change was undone in the database
    expect(store.current().leads).toEqual([lead]); // and the page shows what the database has
  });

  it('retries a refused burst once, then succeeds', async () => {
    const fake = fakeDb();
    const store = open(fake);
    const data = await store.load();
    data.tasks.push({ id: 't1', title: 'X' });
    let refused = 0;
    fake.fail(() => (refused++ === 0 ? { code: 'resource_exhausted' } : null));
    await store.save(data);
    expect(refused).toBe(2);
    expect(fake.doc('tasks/t1')).toEqual({ id: 't1', title: 'X' });
  });

  it('when an undo is itself refused, the page still reflects the database', async () => {
    const fake = fakeDb();
    const store = open(fake);
    const data = await store.load();
    data.leads.push(lead);
    data.activities.push({ id: 'a1', type: 'lead_created', seq: 1 });
    fake.fail((op, path) =>
      path.startsWith('activities/') || op === 'delete' ? { code: 'invalid_argument' } : null,
    );
    await expect(store.save(data)).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(fake.doc('leads/l1')).toEqual(lead); // could not be undone
    expect(store.current().leads).toEqual([lead]); // so the page keeps it too
    expect(store.current().activities).toEqual([]);
  });

  it('deletes records that are gone, after everything else', async () => {
    const fake = fakeDb({ 'tasks/old': { id: 'old' } });
    const store = open(fake);
    const data = await store.load();
    data.tasks = [{ id: 'new' }];
    await store.save(data);
    expect(fake.log).toEqual(['set tasks/new', 'delete tasks/old']);
  });
});
