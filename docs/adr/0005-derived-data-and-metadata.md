# ADR-0005: Derived data and activity metadata

**Context.** Fields like `last_activity_at` and `next_action_at` were proposed
on opportunities. Cached values are fast but can drift. Activities need
type-specific details.

**Decision.**
* **Calculate first.** `last_activity_at` and the next action are computed in
  `opportunity_overview` from indexed lookups
  (`activities (opportunity_id, occurred_at desc)` and a partial index on open
  tasks). No denormalized columns in Phase 1.
* **Cache only on evidence.** If profiling shows a need, add trigger-maintained
  columns, never client-written ones. They must be fully recomputable from
  source tables and served behind the same view column names, so clients do
  not change.
* **Activity metadata** is `jsonb` for type-specific, non-queried detail. It
  must be an object of at most 16 KB. Core facts are relational columns: type,
  occurred_at, links, performer and source. A metadata key that becomes
  filterable is promoted to a column via migration.

**Consequences.** No drift bugs. Slightly more expensive reads, acceptable at
target scale with the indexes provided.
