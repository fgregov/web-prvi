# 4. Data conventions

## Naming
* Tables are plural `snake_case`. Columns are `snake_case`. FKs are `<entity>_id`.
  People references are `<role>_user_id`, such as `owner_user_id` or `assigned_user_id`.
* Enum values are lower `snake_case` (`active_customer`), mirrored 1:1 in
  `@renvara/domain`. UI labels are translations, never enum values.
* Helper functions go in `private`. Only intentional RPCs go in `public`.

## Identifiers
* `uuid` primary keys generated server-side with `private.uuid_generate_v7()`.
  These are time-ordered, so indexes stay compact under heavy inserts. They can
  be swapped for native `uuidv7()` on Postgres 18 without any data change.
* Clients may supply an ID on insert, which helps offline-first mobile and
  idempotent retries. The primary key guarantees uniqueness.

## Time
| Kind | Type | Examples |
|---|---|---|
| A moment | `timestamptz`, stored UTC, sent as ISO-8601 with offset | `occurred_at`, `due_at`, `closed_at`, `created_at` |
| A calendar day | `date`, no time and no zone | `due_date`, `expected_close_date` |

* A `date` becomes a moment only when interpreted in a timezone: the
  **viewer's** profile timezone for "today/overdue", or the
  **organization's** timezone for team-level ordering and reporting.
* Timezones are IANA names (`Europe/Zagreb`), validated by a CHECK constraint.
* Business code never calls `new Date()` implicitly. It takes `now` as a
  parameter, which keeps it deterministic and testable.
* Future reminders and scheduled jobs store UTC instants. Recurring rules, if
  ever needed, store the rule plus its timezone, never pre-expanded UTC times.

## Money
* `numeric(15,2)` plus an ISO-4217 `currency char(3)`. A value without a
  currency is rejected.
* Values cross the API as strings or decimals and are never converted to
  binary floats for arithmetic. Totals across currencies are not summed
  without explicit conversion.
* RENVARA stores *estimates* only. There is no invoicing or tax logic (non-goal).

## Enums vs. lookup tables
Postgres enums are used for small, product-defined vocabularies such as roles,
statuses, stages and types. They give type safety end to end through generated
types. Adding a value is a one-line migration. Removing one is costly, so values
are added only when needed. If organizations ever need **custom** stages or
activity types, the change is to a per-organization lookup table. That is a
planned migration path, not a rewrite.

## JSONB
Allowed only for genuinely variable, non-relational detail, such as
`activities.metadata`. Each JSONB column has a CHECK constraint requiring a
JSON object and a size cap. Anything filtered, joined, aggregated or
permission-relevant must be a column.

## Audit columns
Every business table has `created_at`, `updated_at`, `created_by` and
`updated_by`, stamped by trigger from the JWT. Profiles, organizations and
memberships have timestamps only. A full change history is a future
`audit_events` table (see domain model).

## Derived data
Derived values are computed, not stored, until profiling proves otherwise
(ADR-0005). If caching becomes necessary, it is trigger-maintained, never
client-written, and hidden behind the same view columns.

## Deletion strategy (ADR-0006)

| Entity | User-facing "delete" | Hard delete | Effect of hard delete |
|---|---|---|---|
| Company | `archived_at` (archive) | owner/admin/manager | Purges its contacts, opportunities, activities and tasks: "forget this customer" |
| Contact | `archived_at` | owner/admin/manager | Links on activities and tasks become `NULL`, and the company timeline is kept. Blocked if an activity would be left with no subject, so the caller must decide first. |
| Opportunity | close as won/lost | owner/admin/manager | Its tasks are deleted. Its activities stay on the company timeline with `opportunity_id = NULL`. |
| Activity | delete (author, owner/admin) | same | Gone |
| Task | complete / cancel | creator, owner/admin/manager | Gone |
| Membership | `status = removed` | only when the user account is deleted | Owner, assignee and performer references become `NULL` |
| User account | n/a (GDPR erasure) | via Auth admin API | Profile and memberships are deleted. Authorship references become `NULL`. |
| Organization | future: request plus grace period | back-office only | Cascades everything in the tenant |

**Why there is no generic `deleted_at` soft delete:**
* Every query and every RLS policy would have to remember `deleted_at IS NULL`,
  and forgetting it once leaks "deleted" data.
* GDPR erasure needs *real* deletion anyway.
* History is preserved by the archive and close states, which carry product
  meaning, and later by `audit_events`.
