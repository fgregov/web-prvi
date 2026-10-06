// Display names shared by pages.
export const contactName = (contact) =>
  contact ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') : '';
