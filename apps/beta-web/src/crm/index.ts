// Composition root of the CRM services. HTTP routes (routes.ts) and tests use this.
import { DEMO_CONTENT } from '../../public/app/js/core/edition.js';
import { createCalendarService } from './calendar-service.ts';
import { createContactService } from './contact-service.ts';
import { createCustomerService } from './customer-service.ts';
import { createDashboardService } from './dashboard-service.ts';
import { createLeadService } from './lead-service.ts';
import { createOpportunityService } from './opportunity-service.ts';
import type { CrmRepository } from './repository.ts';
import { createTaskService } from './task-service.ts';

/**
 * `demoContent`: the presentation demo's fixed numbers (Home KPIs, pipeline)
 * and demo reset. Off → only the organization's own records count.
 */
export function createCrmServices(repo: CrmRepository, { demoContent = DEMO_CONTENT } = {}) {
  const tasks = createTaskService(repo);
  const contacts = createContactService(repo);
  const opportunities = createOpportunityService(repo, tasks, { demoContent });
  const customers = createCustomerService(repo, { contacts, opportunities, tasks });
  const calendar = createCalendarService(repo, tasks);
  const dashboard = createDashboardService(repo, tasks, { demoContent });
  const leads = createLeadService(repo, { customers, contacts, opportunities, tasks });
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
  };
}

export type CrmServices = ReturnType<typeof createCrmServices>;
