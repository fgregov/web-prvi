import { Badge } from './ui';
import type { ConnectionState } from '../lib/types';

const MAP: Record<ConnectionState, { label: string; color: 'gray' | 'green' | 'yellow' | 'red' | 'blue' | 'petrol' | 'orange' }> = {
  not_configured: { label: 'Nije konfigurirano', color: 'gray' },
  configured: { label: 'Konfigurirano – nije testirano', color: 'blue' },
  connected: { label: 'Povezano', color: 'green' },
  auth_failed: { label: 'Prijava nije uspjela', color: 'red' },
  mfa_required: { label: 'Potrebna MFA potvrda', color: 'yellow' },
  captcha_required: { label: 'Potrebna CAPTCHA provjera', color: 'yellow' },
  form_not_found: { label: 'Obrazac za prijavu nije pronađen', color: 'orange' },
  error: { label: 'Pogreška', color: 'red' },
  disconnected: { label: 'Veza prekinuta', color: 'gray' },
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const m = MAP[state] ?? MAP.error;
  return (
    <Badge color={m.color}>
      <span className={`mr-0.5 inline-block h-1.5 w-1.5 rounded-full ${m.color === 'green' ? 'bg-emerald-500' : m.color === 'red' ? 'bg-red-500' : m.color === 'gray' ? 'bg-slate-400' : 'bg-amber-500'}`} />
      {m.label}
    </Badge>
  );
}

export const RUN_STATUS: Record<string, { label: string; color: 'gray' | 'green' | 'yellow' | 'red' | 'blue' }> = {
  running: { label: 'U tijeku', color: 'blue' },
  success: { label: 'Uspješno', color: 'green' },
  partial: { label: 'Djelomično', color: 'yellow' },
  failed: { label: 'Neuspješno', color: 'red' },
  interrupted: { label: 'Prekinuto', color: 'yellow' },
  skipped: { label: 'Preskočeno', color: 'gray' },
  committed: { label: 'Uvezeno', color: 'green' },
  rejected: { label: 'Odbijeno', color: 'red' },
};

export function RunBadge({ status }: { status: string }) {
  const m = RUN_STATUS[status] ?? { label: status, color: 'gray' as const };
  return <Badge color={m.color}>{m.label}</Badge>;
}
