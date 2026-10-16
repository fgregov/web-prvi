// CustomerService: customers (≈ public.companies), their primary contact, the
// profile read model and the timeline entries (notes, logged e-mails).
import {
  hasErrors,
  validateCustomer,
  validateEmail,
  validateNote,
} from '../../public/app/js/core/validation.js';
import type { ContactService } from './contact-service.ts';
import { CrmValidationError } from './errors.ts';
import type { OpportunityService } from './opportunity-service.ts';
import type { CrmRepository } from './repository.ts';
import {
  addActivity,
  contactName,
  findInOrg,
  fold,
  inOrg,
  newId,
  requireInOrg,
  splitName,
  str,
  type Body,
} from './scope.ts';
import type { TaskService } from './task-service.ts';
import type { CrmContext, CrmData, Customer } from './types.ts';

const SEARCH_LIMIT = 50;

/** Customer list filter: Aktivni | Neaktivni | Svi. */
export const CUSTOMER_LIST_STATUSES = ['active', 'inactive', 'all'] as const;
export type CustomerListStatus = (typeof CUSTOMER_LIST_STATUSES)[number];

/**
 * Moves a customer to `active` / `inactive`, stamping when and by whom it was
 * deactivated and writing the timeline entry. Touches nothing else: contacts,
 * tasks, opportunities, offers, reminders and leads stay exactly as they are.
 * Returns false (and writes nothing) when it already is in that state.
 */
function applyActivation(data: CrmData, ctx: CrmContext, customer: Customer, active: boolean) {
  if ((customer.status !== 'inactive') === active) return false;
  const now = ctx.now.toISOString();
  customer.status = active ? 'active' : 'inactive';
  customer.deactivatedAt = active ? null : now;
  customer.deactivatedBy = active ? null : ctx.user.id;
  customer.updatedAt = now;
  addActivity(
    data,
    ctx,
    customer.id,
    active ? 'customer_reactivated' : 'customer_deactivated',
    active
      ? 'Ponovno među aktivnim kupcima.'
      : 'Premješten među neaktivne kupce. Svi podaci su sačuvani.',
    customer.id,
  );
  return true;
}

function customerFields(input: Body) {
  return {
    companyName: str(input.companyName),
    oib: str(input.oib),
    address: str(input.address),
    postalCode: str(input.postalCode),
    city: str(input.city),
    email: str(input.email),
    phone: str(input.phone),
    website: str(input.website),
    status: input.status === 'inactive' ? ('inactive' as const) : ('active' as const),
    type: input.type === 'prospect' ? ('prospect' as const) : ('customer' as const),
    notes: str(input.notes),
  };
}

export function createCustomerService(
  repo: CrmRepository,
  deps: { contacts: ContactService; opportunities: OpportunityService; tasks: TaskService },
) {
  const primaryContact = (ctx: CrmContext, c: Customer) => {
    const data = repo.data();
    return (
      findInOrg(data.contacts, ctx, c.primaryContactId) ??
      inOrg(data.contacts, ctx).find((x) => x.companyId === c.id) ??
      null
    );
  };

  function validate(
    ctx: CrmContext,
    input: Body,
    currentId: string | null = null,
    requireContact = true,
  ) {
    const errors = validateCustomer(input, {
      existing: inOrg(repo.data().customers, ctx),
      currentId,
      requireContact,
    });
    if (hasErrors(errors)) throw new CrmValidationError(errors);
  }

  return {
    /**
     * Search by name (accent-insensitive) or OIB prefix, within the activation
     * filter (default `all`: pickers and duplicate checks see every customer).
     */
    listCustomers(ctx: CrmContext, filter: { q?: string | null; status?: string | null } = {}) {
      const q = fold(str(filter.q));
      const status = filter.status || 'all';
      if (!CUSTOMER_LIST_STATUSES.includes(status as CustomerListStatus)) {
        throw new CrmValidationError({ status: 'Neispravan filtar kupaca.' });
      }
      return inOrg(repo.data().customers, ctx)
        .filter((c) => status === 'all' || (c.status === 'inactive') === (status === 'inactive'))
        .filter((c) => !q || fold(c.companyName).includes(q) || c.oib.startsWith(q))
        .sort((a, b) => a.companyName.localeCompare(b.companyName, 'hr'))
        .slice(0, q ? SEARCH_LIMIT : undefined)
        .map((c) => {
          const contact = primaryContact(ctx, c);
          return { ...c, primaryContactName: contact ? contactName(contact) : null };
        });
    },

    getCustomer(ctx: CrmContext, id: string): Customer {
      return requireInOrg(repo.data().customers, ctx, id);
    },

    /** Customer with contacts, opportunities (with next action), tasks and timeline. */
    getProfile(ctx: CrmContext, id: string) {
      const data = repo.data();
      const customer = requireInOrg(data.customers, ctx, id);
      return {
        ...customer,
        primaryContact: primaryContact(ctx, customer),
        contacts: deps.contacts.listContacts(ctx, { companyId: id }),
        opportunities: deps.opportunities.listOpportunities(ctx, { companyId: id }),
        tasks: deps.tasks.listTasks(ctx, { companyId: id }).filter((t) => t.status !== 'cancelled'),
        activities: inOrg(data.activities, ctx)
          .filter((a) => a.companyId === id)
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.seq - a.seq),
      };
    },

    /**
     * New customer with its primary contact. `withContact: false` is only for
     * converting a company-only lead: the customer then starts without a contact.
     */
    createCustomer(
      ctx: CrmContext,
      input: Body,
      { withContact = true }: { withContact?: boolean } = {},
    ): Customer {
      validate(ctx, input, null, withContact);
      const data = repo.data();
      const now = ctx.now.toISOString();
      const id = newId();
      const contactId = withContact ? newId() : null;
      const customer: Customer = {
        id,
        organizationId: ctx.organizationId,
        ...customerFields(input),
        ownerId: ctx.user.id,
        ownerName: ctx.user.displayName,
        primaryContactId: contactId,
        createdAt: now,
        updatedAt: now,
      };
      if (customer.status === 'inactive') {
        customer.deactivatedAt = now;
        customer.deactivatedBy = ctx.user.id;
      }
      data.customers.push(customer);
      if (contactId) {
        data.contacts.push({
          id: contactId,
          organizationId: ctx.organizationId,
          companyId: id,
          ...splitName(str(input.contactName)),
          role: str(input.contactRole) || 'Odgovorna osoba',
          email: str(input.contactEmail),
          phone: str(input.contactPhone),
          notes: '',
          isPrimary: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      addActivity(data, ctx, id, 'customer_created', `${customer.companyName} dodana u CRM.`, id);
      repo.commit();
      return customer;
    },

    updateCustomer(ctx: CrmContext, id: string, input: Body): Customer {
      const data = repo.data();
      const customer = requireInOrg(data.customers, ctx, id);
      const primary = findInOrg(data.contacts, ctx, customer.primaryContactId);
      validate(ctx, input, id, Boolean(primary));
      const now = ctx.now.toISOString();
      const { status, ...fields } = customerFields(input);
      Object.assign(customer, fields, { updatedAt: now });
      // Status from the edit form: the same stamps and timeline entry as the action.
      // A request without a status leaves the activation as it is.
      if (input.status === 'active' || input.status === 'inactive') {
        applyActivation(data, ctx, customer, status === 'active');
      }
      if (!primary && str(input.contactName)) {
        // A customer converted from a company-only lead gets its first contact here.
        const contactId = newId();
        data.contacts.push({
          id: contactId,
          organizationId: ctx.organizationId,
          companyId: id,
          ...splitName(str(input.contactName)),
          role: str(input.contactRole) || 'Odgovorna osoba',
          email: str(input.contactEmail),
          phone: str(input.contactPhone),
          notes: '',
          isPrimary: true,
          createdAt: now,
          updatedAt: now,
        });
        customer.primaryContactId = contactId;
      }
      if (primary) {
        Object.assign(primary, splitName(str(input.contactName)), {
          role: str(input.contactRole) || 'Odgovorna osoba',
          email: str(input.contactEmail),
          phone: str(input.contactPhone),
          updatedAt: now,
        });
      }
      addActivity(data, ctx, id, 'customer_updated', 'Osnovni podaci kupca su ažurirani.', id);
      repo.commit();
      return customer;
    },

    /**
     * "Deaktiviraj kupca" / "Aktiviraj kupca": the same record (same id) moves
     * between the active and inactive list; nothing is deleted or cascaded.
     * Repeating it changes nothing.
     */
    setActive(ctx: CrmContext, id: string, active: boolean): Customer {
      const data = repo.data();
      const customer = requireInOrg(data.customers, ctx, id);
      if (applyActivation(data, ctx, customer, active)) repo.commit();
      return customer;
    },

    addNote(ctx: CrmContext, id: string, input: Body) {
      const errors = validateNote(input);
      if (hasErrors(errors)) throw new CrmValidationError(errors);
      const data = repo.data();
      const customer = requireInOrg(data.customers, ctx, id);
      customer.updatedAt = ctx.now.toISOString();
      const activity = addActivity(data, ctx, id, 'note_added', str(input.text));
      repo.commit();
      return activity;
    },

    /** Demo: records an e-mail in the timeline; nothing is sent. */
    logEmail(ctx: CrmContext, id: string, input: Body) {
      const errors = validateEmail(input);
      if (hasErrors(errors)) throw new CrmValidationError(errors);
      const data = repo.data();
      const customer = requireInOrg(data.customers, ctx, id);
      customer.updatedAt = ctx.now.toISOString();
      const description = [str(input.subject), str(input.to)].filter(Boolean).join(' · ');
      const activity = addActivity(data, ctx, id, 'email_sent', description);
      repo.commit();
      return activity;
    },
  };
}

export type CustomerService = ReturnType<typeof createCustomerService>;
