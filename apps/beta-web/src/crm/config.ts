import { dirname, resolve } from 'node:path';
import { assertValidTimeZone } from '@renvara/domain';
import { APP_DIR } from '../app-dir.ts';

/**
 * BETA tenancy: the single BETA account works in one organization. With
 * Supabase Auth the organization comes from organization_members instead.
 */
export interface CrmConfig {
  readonly organizationId: string;
  readonly timeZone: string;
  /** JSON file holding the BETA CRM data (git-ignored). */
  readonly dataFile: string;
  /** Local identity: accounts, password links, session cut-offs (next to the data, never in it). */
  readonly identityFile: string;
}

export function loadCrmConfig(env: Record<string, string | undefined>): CrmConfig {
  const timeZone = env.RENVARA_ORG_TIMEZONE || 'Europe/Zagreb';
  assertValidTimeZone(timeZone);
  const dataFile = resolve(APP_DIR, env.RENVARA_DATA_FILE || '.data/crm.json');
  return {
    organizationId: env.RENVARA_BETA_ORG_ID || 'org-beta',
    timeZone,
    dataFile,
    identityFile: resolve(
      APP_DIR,
      env.RENVARA_IDENTITY_FILE || resolve(dirname(dataFile), 'identity.json'),
    ),
  };
}

/** Follow-up Engine (ADR-0008): private document storage, upload and link limits. */
export interface FollowUpConfig {
  /** Private directory of offer PDFs (git-ignored, never served as static files). */
  readonly documentsDir: string;
  readonly maxBytes: number;
  readonly linkTtlDays: number;
  readonly retentionDays: number;
  /** RENVARA_SHARE_LINK_KEY; null → derived from the session secret. */
  readonly shareLinkKey: string | null;
}

function positiveInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  max: number,
) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be a whole number from 1 to ${max}.`);
  }
  return value;
}

export function loadFollowUpConfig(env: Record<string, string | undefined>): FollowUpConfig {
  const key = env.RENVARA_SHARE_LINK_KEY || null;
  if (key !== null && key.length < 32) {
    throw new Error('RENVARA_SHARE_LINK_KEY must be at least 32 characters long.');
  }
  return {
    documentsDir: resolve(APP_DIR, env.RENVARA_DOCUMENTS_DIR || '.data/offer-documents'),
    maxBytes: positiveInt(env, 'RENVARA_MAX_DOCUMENT_MB', 20, 50) * 1024 * 1024,
    linkTtlDays: positiveInt(env, 'RENVARA_SHARE_LINK_DAYS', 90, 365),
    retentionDays: positiveInt(env, 'RENVARA_EVENT_RETENTION_DAYS', 365, 3650),
    shareLinkKey: key,
  };
}
