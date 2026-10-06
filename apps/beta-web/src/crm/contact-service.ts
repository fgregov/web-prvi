// ContactService: a contact always belongs to a customer of the same organization.
import { hasErrors, MESSAGES, validateContact } from '../../public/app/js/core/validation.js';
import { CrmValidationError } from './errors.ts';
import type { CrmRepository } from './repository.ts';
import {
  addActivity,
  contactName,
  findInOrg,
  inOrg,
  newId,
  splitName,
  str,
  type Body,
} from './scope.ts';
import type { Contact, CrmContext } from './types.ts';

export function createContactService(repo: CrmRepository) {
  return {
    listContacts(ctx: CrmContext, filter: { companyId?: string | null } = {}): Contact[] {
      return inOrg(repo.data().contacts, ctx)
        .filter((c) => !filter.companyId || c.companyId === filter.companyId)
        .sort(
          (a, b) =>
            Number(b.isPrimary) - Number(a.isPrimary) ||
            contactName(a).localeCompare(contactName(b), 'hr'),
        );
    },

    createContact(ctx: CrmContext, input: Body): Contact {
      const errors = validateContact(input);
      if (hasErrors(errors)) throw new CrmValidationError(errors);
      const data = repo.data();
      const customer = findInOrg(data.customers, ctx, input.companyId);
      if (!customer) {
        throw new CrmValidationError({ companyId: MESSAGES.unavailable }, MESSAGES.unavailable);
      }
      const now = ctx.now.toISOString();
      const contact: Contact = {
        id: newId(),
        organizationId: ctx.organizationId,
        companyId: customer.id,
        ...splitName(str(input.fullName)),
        role: str(input.role),
        email: str(input.email),
        phone: str(input.phone),
        notes: str(input.notes),
        isPrimary: false,
        createdAt: now,
        updatedAt: now,
      };
      data.contacts.push(contact);
      customer.updatedAt = now;
      addActivity(
        data,
        ctx,
        customer.id,
        'contact_added',
        [contactName(contact), contact.role].filter(Boolean).join(' · '),
        contact.id,
      );
      repo.commit();
      return contact;
    },
  };
}

export type ContactService = ReturnType<typeof createContactService>;
