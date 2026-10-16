# ADR-0004: The next action is derived from open tasks

**Context.** Core principle: *no active opportunity without a known next action.*
The options were:
(A) `next_action_*` fields on the opportunity;
(B) a Task linked to the opportunity;
(C) a hybrid of the two.

**Decision.** B as the source of truth, exposed through a derived read model
(C without stored duplication):
* The next action = the earliest **open** task linked to the opportunity.
  Ordering: earliest effective due moment, where a date-only due counts from
  the start of that day in the org timezone; undated tasks last; then by
  creation time.
* `public.opportunity_overview` exposes `next_task_*` and
  `needs_next_action = status = 'active' AND no open task`.
* `@renvara/domain` implements the same ordering (`selectNextAction`) plus
  viewer-specific `attentionReasons` (`missing_next_action`, `next_action_overdue`).

**Why not A.** A free-text `next_action` on the opportunity duplicates the task
list. It goes stale the moment the task is completed elsewhere, cannot be
assigned, reminded or completed, and invites the "two sources of truth" bug
class the product exists to eliminate.

**Consequences.**
* Completing or cancelling a task automatically promotes the next one, or
  surfaces the opportunity as needing attention. No sync code is needed.
* Creating a next action = creating a task. The UI and the future AI create
  tasks, never "set a field".
* Enforcing a next action as a hard database constraint (blocking saves) was
  rejected. It would block legitimate intermediate states such as quick
  capture and imports. The rule is surfaced as an attention signal instead.
  Product may later require it at specific moments, such as on stage change,
  in the application service.
* Cost: two indexed lateral lookups per row in the view. If pipeline lists ever
  become slow, cache the values with triggers behind the same view columns
  (ADR-0005).
