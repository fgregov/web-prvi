// PRILIKA JE OSVOJENA! (ADR-0009). After a lead's deal is won the lead is WON;
// converting it into a customer is offered, never done automatically:
// KREIRAJ KUPCA / POVEŽI S POSTOJEĆIM KUPCEM / KASNIJE. Later stays possible
// from the lead ("Pretvori u kupca"). A lead that is already a customer is
// offered to link this deal to that customer instead.
import { api, ApiError } from '../../core/api.js';
import { choiceDialog, confirmDialog } from '../../ui/confirm.js';
import { withParams } from '../../ui/navigation.js';
import { showToast } from '../../ui/toast.js';

/** /leads/{id}/convert?mode=new|existing&opportunityId=… */
export const conversionHref = (leadId, params = {}) =>
  withParams(`/leads/${encodeURIComponent(leadId)}/convert`, params);

/**
 * @param {object} o  the won opportunity as the server returned it
 * @param {{ returnTo?: string }} [options]
 * @returns {Promise<'converting' | 'later' | 'linked' | 'none'>} converting: it
 *   left for the conversion screen
 */
export async function offerConversion(o, { returnTo } = {}) {
  if (!o?.leadId || o.status !== 'won') return 'none';
  if (!o.leadCustomerId) {
    const choice = await choiceDialog({
      title: 'Prilika je osvojena!',
      message: `Želite li sada pretvoriti ovaj lead u kupca?${o.leadName ? ` Lead: ${o.leadName}.` : ''}`,
      choices: [
        { value: 'new', label: 'Kreiraj kupca', variant: 'primary' },
        { value: 'existing', label: 'Poveži s postojećim kupcem', variant: 'secondary' },
        { value: 'later', label: 'Kasnije', variant: 'ghost' },
      ],
      dismissValue: 'later',
    });
    if (choice === 'later') return 'later';
    window.location.assign(
      conversionHref(o.leadId, { mode: choice, opportunityId: o.id, returnTo }),
    );
    return 'converting';
  }
  if (!o.companyId) {
    const link = await confirmDialog({
      title: 'Prilika je osvojena!',
      message: `Lead je već kupac ${o.leadCustomerName}. Povezati i ovu priliku s tim kupcem?`,
      cancelLabel: 'Kasnije',
      confirmLabel: 'Poveži',
    });
    if (link && (await linkToLeadCustomer(o))) return 'linked';
  }
  return 'none';
}

/** "Poveži s kupcem X": a lead's deal joins the customer the lead became. */
export async function linkToLeadCustomer(o) {
  try {
    await api.linkOpportunityToLeadCustomer(o.id);
    return true;
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : 'Pokušajte ponovno.');
    return false;
  }
}
