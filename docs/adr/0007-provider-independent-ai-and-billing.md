# ADR-0007: Provider-independent AI and billing (design only)

**Context.** AI providers and payment platforms change. Mobile stores mandate
their own billing. Domain logic must not depend on any vendor.

**Decision.**
* **AI:** an `AIProvider` port (completion with tool calls, streaming, usage
  reporting) with adapters such as Claude and OpenAI, selected by
  configuration. AI acts only through application services (the same
  `logActivity`, `scheduleTask` and similar operations humans use), so RLS,
  invariants and `source = 'ai_assistant'` provenance apply automatically.
  Prompts, tool schemas and model choice live in the AI module, never in the
  domain package.
* **Billing:** provider-neutral `plans`, `subscriptions` (`provider`,
  `external_id`, status, period) and entitlements (feature flags and seat
  limit). Stripe, Apple and Google adapters translate webhooks into these
  tables. Seats used = active memberships (derived). Business code checks
  entitlements and never asks a provider.
* Nothing in the Phase 1 schema depends on either. Organizations carry no
  billing columns.

**Consequences.** Switching or adding providers is an adapter change. The
modules will be specified and built in later phases with their own ADRs.
