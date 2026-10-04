# Open questions (need a product decision)

Each item lists the current assumption built into Phase 1. Changing any of
them is cheap now and gets more expensive as data accumulates.

1. **Waiting for a response.** Proposed: a task type `await_response` (or a
   `waiting_since` column) whose due date is the expected-response date; when
   it passes, it becomes the follow-up prompt. *Current:* not implemented. Use
   a `follow_up` task due on the expected date.
2. **Closing an opportunity that has open tasks.** Auto-cancel them, ask the
   user, or leave them? *Current:* left open. Closed opportunities never show
   as needing attention.
3. **Visibility for the sales role.** *Current:* every member sees all
   organization data. Should `sales` see only records they own or are
   assigned? It is a policy-only change.
4. **Private tasks.** *Current:* tasks are visible to the whole organization,
   including subject-less personal reminders. Should personal reminders be
   private to the assignee?
5. **Opportunity without a company.** *Current:* `company_id` is required,
   since B2B deals are with a company and a sole trader is modeled as a
   company. Confirm.
6. **Contact without a company.** *Current:* allowed, for quick capture and
   voice. Confirm.
7. **Hard-delete rights for managers.** *Current:* owner, admin and manager may
   hard-delete. Should managers be archive-only?
8. **Data residency.** As an EU-focused product with GDPR obligations, the
   production Supabase project should be created in an EU region. Confirm the
   region before the first deploy.
9. **Repository.** The foundation lives at the root of `fgregov/web-prvi`. That
   repo also contains an older .NET GitHub Pages workflow
   (`.github/workflows/main.yml`) that fails without a .NET project and runs on
   PRs to `main`. Remove it, or move RENVARA to a dedicated repository?
