import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS } from './permissions';

describe('can', () => {
  it('gives owners every permission', () => {
    for (const p of PERMISSIONS) expect(can('owner', p)).toBe(true);
  });

  it('reserves granting ownership to owners (mirrors guard_membership_change)', () => {
    expect(can('admin', 'members.grant_owner')).toBe(false);
    expect(can('manager', 'members.grant_owner')).toBe(false);
  });

  it('mirrors the RLS delete policies: owner/admin/manager may hard-delete records', () => {
    expect(can('manager', 'records.hard_delete')).toBe(true);
    expect(can('sales', 'records.hard_delete')).toBe(false);
  });

  it('gives sales no elevated permissions', () => {
    for (const p of PERMISSIONS) expect(can('sales', p)).toBe(false);
  });
});
