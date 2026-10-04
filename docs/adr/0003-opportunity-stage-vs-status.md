# ADR-0003: Opportunity stage vs. status

**Context.** The proposed lifecycle (NEW_LEAD … NEGOTIATION, WON, LOST) mixes
two questions: "where in the pipeline?" and "what was the outcome?".

**Decision.**
* `stage`: new_lead, contacted, qualified, proposal, negotiation.
* `status`: active, won, lost.
* `stage` is retained when an opportunity closes, so "lost at proposal" is
  answerable without history tables.
* A single `closed_at` instead of `won_at` plus `lost_at`. With `status` it
  carries the same information, and the CHECK
  `(status = 'active') = (closed_at is null)` makes contradictions impossible.
  `lost_reason` is only allowed when lost.
* The DB stamps `closed_at` when closing (back-dating allowed) and clears
  closure data on reopen. Every stage or status change writes a `status_change`
  activity with from/to values in `metadata`. That is the opportunity's stage history.
* Allowed transitions (`changeStage`, `markWon`, `markLost`, `reopen`) live in
  `@renvara/domain`. Stages may move backwards, because deals regress.

**Consequences.** Pipeline boards filter `status = 'active'` and group by
`stage`. Win/loss analytics group by `status` and `stage`. Custom stages per
organization would later replace the enum with a lookup table (see data conventions).
