// Labels shared by the Korisnici pages.
import { formatDateTime } from '../../core/format.js';
import { ROLES } from '../../core/permissions.js';
import { h } from '../../ui/dom.js';

export const USER_STATUSES = [
  { value: 'active', label: 'Aktivni' },
  { value: 'inactive', label: 'Neaktivni' },
  { value: 'all', label: 'Svi' },
];

export const fullName = (u) => `${u.firstName} ${u.lastName}`.trim() || u.email;
export const roleLabel = (role) => ROLES.find((r) => r.value === role)?.label ?? role;
export const lastLogin = (iso) => (iso ? formatDateTime(iso) : 'Nikad');

export const statusBadge = (status) =>
  h(
    'span',
    { class: `rv-badge rv-badge--${status === 'active' ? 'green' : 'neutral'}` },
    status === 'active' ? 'Aktivan' : 'Neaktivan',
  );

/** "Neispravan e-mail." … from a 422, or the server's message. */
export const errorText = (error, fallback) =>
  (error && typeof error.message === 'string' && error.message) || fallback;
