# Architecture Decision Records

Short records of decisions that are expensive to reverse. Format: context,
decision, consequences, alternatives considered. Status is *Accepted* unless
marked *Proposed*.

| # | Decision | Status |
|---|---|---|
| [0001](0001-monorepo-and-stack.md) | Monorepo; Supabase + Expo + Next.js; shared pure domain package | Accepted |
| [0002](0002-tenant-isolation.md) | Tenant isolation by RLS **and** composite tenant-safe foreign keys | Accepted |
| [0003](0003-opportunity-stage-vs-status.md) | Opportunity `stage` and `status` are separate; single `closed_at` | Accepted |
| [0004](0004-next-action-derived-from-tasks.md) | Next action is derived from open tasks, not stored on the opportunity | Accepted |
| [0005](0005-derived-data-and-metadata.md) | Compute derived data first; JSONB only for type-specific activity details | Accepted |
| [0006](0006-deletion-strategy.md) | Archive/close for users, hard delete with defined cascades; no generic soft delete | Accepted |
| [0007](0007-provider-independent-ai-and-billing.md) | AI and billing behind provider-neutral ports | Accepted (design only) |
