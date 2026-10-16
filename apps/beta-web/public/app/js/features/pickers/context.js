// Preselects the customer passed as ?companyId= on a form screen.
import { api } from '../../core/api.js';

/** The customer for a CustomerPicker, or null. Throws when the id is not available. */
export async function contextCustomer(companyId) {
  if (!companyId) return null;
  const c = await api.getCustomer(companyId);
  return { id: c.id, companyName: c.companyName, oib: c.oib, city: c.city };
}
