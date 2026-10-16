// Composition root of the CRM services. HTTP routes (routes.ts) and tests use this.
import { DEMO_CONTENT } from '../../public/app/js/core/edition.js';
import { createCalendarService } from './calendar-service.ts';
import { createContactService } from './contact-service.ts';
import { createCustomerService } from './customer-service.ts';
import { createDashboardService } from './dashboard-service.ts';
import { createMemoryDocumentStore } from './document-store.ts';
import {
  createFollowUpService,
  DocumentRejected,
  type FollowUpOptions,
  type PdfInfo,
} from './follow-up-service.ts';
import { createLeadService } from './lead-service.ts';
import { createNotificationService } from './notification-service.ts';
import { createOfferService } from './offer-service.ts';
import { createOpportunityService } from './opportunity-service.ts';
import { createPushSubscriptionService } from './push-subscription-service.ts';
import { createReminderService } from './reminder-service.ts';
import type { CrmRepository } from './repository.ts';
import type { ShareKey } from './share-token.ts';
import { createTaskService } from './task-service.ts';

/**
 * Structural PDF check without a parser: header, end-of-file marker and at
 * least one page object. The BETA server uses pdf.js instead (pdf-inspect.ts).
 */
export async function basicPdfCheck(bytes: Uint8Array): Promise<PdfInfo> {
  const text = new TextDecoder('latin1').decode(bytes);
  if (!text.slice(0, 1024).includes('%PDF-') || !text.slice(-2048).includes('%%EOF')) {
    throw new DocumentRejected('Odabrana datoteka nije ispravan PDF dokument.');
  }
  if (/\/Encrypt\b/.test(text)) {
    throw new DocumentRejected('PDF je zaštićen lozinkom pa ga kupac ne bi mogao otvoriti.');
  }
  const pages = text.match(/\/Type\s*\/Page(?!s)\b/g)?.length ?? 0;
  if (pages === 0) throw new DocumentRejected('Odabrana datoteka nije ispravan PDF dokument.');
  return { pageCount: pages };
}

/** A key for this process only: links work, but cannot be copied again after a restart. */
const processShareKey = () =>
  globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]) as Promise<ShareKey>;

/**
 * `demoContent`: the presentation demo's fixed numbers (Home KPIs, pipeline)
 * and demo reset. Off → only the organization's own records count.
 * `notificationDelivery`: false where nothing can deliver push (the in-browser
 * demo): preferences are saved, but no notification is queued.
 * `followUp`: document storage, PDF check and link key of the Follow-up Engine
 * (the BETA server passes its private directory, pdf.js and its secret).
 */
export function createCrmServices(
  repo: CrmRepository,
  {
    demoContent = DEMO_CONTENT,
    followUp = {},
    notificationDelivery = true,
  }: {
    demoContent?: boolean;
    followUp?: Partial<FollowUpOptions>;
    notificationDelivery?: boolean;
  } = {},
) {
  const tasks = createTaskService(repo);
  const contacts = createContactService(repo);
  const opportunities = createOpportunityService(repo, tasks, { demoContent });
  const customers = createCustomerService(repo, { contacts, opportunities, tasks });
  const calendar = createCalendarService(repo, tasks);
  const dashboard = createDashboardService(repo, tasks, { demoContent });
  const leads = createLeadService(repo, { customers, contacts, opportunities, tasks });
  const offers = createOfferService(repo);
  const reminders = createReminderService(repo);
  const pushSubscriptions = createPushSubscriptionService(repo);
  const notifications = createNotificationService(repo, { delivery: notificationDelivery });
  const followUpService = createFollowUpService(repo, offers, {
    onQualifiedView: (data, offer, event, now) =>
      notifications.offerViewed(data, offer, event, now),
    documents: followUp.documents ?? createMemoryDocumentStore(),
    inspectPdf: followUp.inspectPdf ?? basicPdfCheck,
    shareKey: followUp.shareKey ?? processShareKey(),
    ...(followUp.maxBytes ? { maxBytes: followUp.maxBytes } : {}),
    ...(followUp.linkTtlDays ? { linkTtlDays: followUp.linkTtlDays } : {}),
    ...(followUp.retentionDays ? { retentionDays: followUp.retentionDays } : {}),
  });
  return {
    repo,
    demoContent,
    customers,
    contacts,
    opportunities,
    tasks,
    calendar,
    dashboard,
    leads,
    offers,
    reminders,
    pushSubscriptions,
    notifications,
    followUp: followUpService,
  };
}

export type CrmServices = ReturnType<typeof createCrmServices>;
