import { resolve } from 'node:path';
import { assertValidTimeZone } from '@renvara/domain';

/**
 * BETA tenancy: the single BETA account works in one organization. With
 * Supabase Auth the organization comes from organization_members instead.
 */
export interface CrmConfig {
  readonly organizationId: string;
  readonly timeZone: string;
  /** JSON file holding the BETA CRM data (git-ignored). */
  readonly dataFile: string;
}

const APP_DIR = resolve(import.meta.dirname, '../..');

export function loadCrmConfig(env: Record<string, string | undefined>): CrmConfig {
  const timeZone = env.RENVARA_ORG_TIMEZONE || 'Europe/Zagreb';
  assertValidTimeZone(timeZone);
  return {
    organizationId: env.RENVARA_BETA_ORG_ID || 'org-beta',
    timeZone,
    dataFile: resolve(APP_DIR, env.RENVARA_DATA_FILE || '.data/crm.json'),
  };
}
