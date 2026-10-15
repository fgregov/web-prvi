// The first owner of a BETA server with local identity: the account from the
// server settings (RENVARA_BETA_USERNAME / _PASSWORD). Created as the owner of
// the organization when it has no members yet, with the id the CRM records of
// that account already carry (beta-<username>). Browser-safe.
import type { CrmRepository } from '../crm/repository.ts';

export function bootstrapUserId(username: string): string {
  return `beta-${username}`;
}

/** Splits "Frane Gregov" into first and last name (one word: first name only). */
export function splitName(displayName: string): { firstName: string; lastName: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) as string };
}

export function ensureBootstrapOwner(
  repo: CrmRepository,
  organizationId: string,
  owner: { userId: string; displayName: string; email?: string },
  now: Date = new Date(),
): void {
  const data = repo.data();
  if (data.users.some((u) => u.organizationId === organizationId)) return;
  const stamp = now.toISOString();
  data.users.push({
    id: owner.userId,
    organizationId,
    ...splitName(owner.displayName),
    oib: '',
    email: (owner.email ?? '').toLowerCase(),
    phone: '',
    role: 'owner',
    status: 'active',
    bootstrap: true,
    createdAt: stamp,
    createdBy: null,
    updatedAt: stamp,
    deactivatedAt: null,
    deactivatedBy: null,
    lastLoginAt: null,
  });
  repo.commit();
}
