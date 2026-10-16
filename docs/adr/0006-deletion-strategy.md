# ADR-0006: Deletion strategy

**Context.** Business history matters for timelines, reporting and audit.
GDPR requires real erasure. A blanket `deleted_at` soft delete is a common
source of leaks, because every query and policy must remember to filter it.

**Decision.**
* **Product states instead of soft delete.** Companies and contacts are
  *archived* (`archived_at`). Opportunities are *closed* (won/lost). Tasks are
  *completed* or *cancelled*. Memberships are *removed* (status). These states
  carry meaning and are what users normally do.
* **Hard delete is real, permissioned and has defined cascades.** Only
  owner, admin or manager may hard-delete companies, contacts and
  opportunities. Cascades are chosen per relationship. For example, deleting a
  company purges everything about that customer, while deleting an opportunity
  keeps its activities on the company timeline. The full table is in the data
  conventions doc.
* **No silent orphaning.** Deleting a contact that is the only subject of an
  activity is rejected by a CHECK constraint, so the caller must decide what
  happens to that activity.
* **User erasure** deletes profile and memberships. Authorship references become `NULL`.
* **Organization deletion** (future) means a request, then a grace period, then
  a back-office hard delete that cascades the tenant.
* **Audit** of deletions and other sensitive changes is a later `audit_events`
  table, not soft-deleted rows.

**Consequences.** Queries and policies stay simple. Erasure is truthful.
Accidental deletion is mitigated by role restrictions and archive-first UX,
plus database backups or PITR for disasters.
