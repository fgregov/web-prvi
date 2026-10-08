// Composition root of the CRM services. HTTP routes (routes.ts) and tests use this.
import { createCalendarService } from './calendar-service.ts';
import { createContactService } from './contact-service.ts';
import { createCustomerService } from './customer-service.ts';
import { createDashboardService } from './dashboard-service.ts';
import { createLeadService } from './lead-service.ts';
import { createOpportunityService } from './opportunity-service.ts';
import type { CrmRepository } from './repository.ts';
import { createTaskService } from './task-service.ts';

export function createCrmServices(repo: CrmRepository) {
  const tasks = createTaskService(repo);
  const contacts = createContactService(repo);
  const opportunities = createOpportunityService(repo, tasks);
  const customers = createCustomerService(repo, { contacts, opportunities, tasks });
  const calendar = createCalendarService(repo, tasks);
  const dashboard = createDashboardService(repo, tasks);
  const leads = createLeadService(repo, { customers, contacts, opportunities, tasks });
  return { repo, customers, contacts, opportunities, tasks, calendar, dashboard, leads };
}

export type CrmServices = ReturnType<typeof createCrmServices>;
