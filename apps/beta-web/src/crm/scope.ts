// Tenant scoping and small helpers shared by the services. Every lookup goes
// through inOrg(): a record of another organization is "not found".
import { randomUUID } from 'node:crypto';
import { ACTIVITY_META } from '../../public/app/js/core/constants.js';
import { CrmNotFoundError } from './errors.ts';
import type { Activity, CrmContext, CrmData } from './types.ts';

export const newId = (): string => randomUUID();

/** Only the organization is needed to scope a lookup (the reminder scheduler has no user). */
type OrgScope = Pick<CrmContext, 'organizationId'>;

export function inOrg<T extends { organizationId: string }>(
  list: readonly T[],
  ctx: OrgScope,
): T[] {
  return list.filter((row) => row.organizationId === ctx.organizationId);
}

export function findInOrg<T extends { id: string; organizationId: string }>(
  list: readonly T[],
  ctx: OrgScope,
  id: unknown,
): T | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  return list.find((row) => row.id === id && row.organizationId === ctx.organizationId);
}

export function requireInOrg<T extends { id: string; organizationId: string }>(
  list: readonly T[],
  ctx: CrmContext,
  id: unknown,
): T {
  const row = findInOrg(list, ctx, id);
  if (!row) throw new CrmNotFoundError();
  return row;
}

/** Trimmed string or '' for anything that is not a string. */
export const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
/** Trimmed string, or null when empty. */
export const opt = (value: unknown): string | null => str(value) || null;

export type Body = Record<string, unknown>;

export function addActivity(
  data: CrmData,
  ctx: CrmContext,
  companyId: string,
  type: string,
  description: string,
  relatedId: string | null = null,
): Activity {
  data.seq += 1;
  const activity: Activity = {
    id: newId(),
    organizationId: ctx.organizationId,
    companyId,
    type,
    title: (ACTIVITY_META as Record<string, { label: string }>)[type]?.label ?? type,
    description,
    relatedId,
    actorId: ctx.user.id,
    actorName: ctx.user.displayName,
    occurredAt: ctx.now.toISOString(),
    seq: data.seq,
  };
  data.activities.push(activity);
  return activity;
}

/** Timeline entry of a lead (optionally also on the customer it became). */
export function addLeadActivity(
  data: CrmData,
  ctx: CrmContext,
  leadId: string,
  type: string,
  description: string,
  companyId: string | null = null,
): Activity {
  const activity = addActivity(data, ctx, companyId ?? '', type, description, leadId);
  activity.companyId = companyId;
  activity.leadId = leadId;
  return activity;
}

export const contactName = (c: { firstName: string; lastName: string }) =>
  [c.firstName, c.lastName].filter(Boolean).join(' ');

export function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/** Lower-case, accent-free text for searching ("Lukač" matches "lukac"). */
export const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
