# ADR-0008: Follow-up Engine: offer documents, share links, engagement events

**Context.** Salespeople create quotations in external software (ERP, Word)
and send them as PDFs. Renvara manages what happens next: delivery,
engagement and the wait for feedback. The authoritative `offers` entity
already exists and feeds FEEDBACK OVERVIEW and Ponude (`sent_at` starts the
wait; 1–4D yellow, 5–9D red, 10D+ black). Before this ADR an offer belonged
to an opportunity (`opportunity_id NOT NULL`), had no document, and the BETA
server had no file storage, no public endpoints and no binary request bodies.

**Impact assessment (before the schema change).**
* No parallel offers model: the same `offers` rows gain a document, links and
  events; FEEDBACK OVERVIEW, Ponude and the opportunity card keep reading them.
* `offers` changes in a compatible way: `company_id` is added and backfilled
  from the opportunity, then made required; `opportunity_id` becomes optional
  (it must belong to the same customer, enforced server-side and by a trigger);
  `contact_id` (same customer) and an internal `note` are added. Existing rows
  keep their dates, status and meaning.
* New tables, each tenant-scoped with composite foreign keys (ADR-0002) and RLS:
  `offer_documents` (one active PDF per offer, versioned rather than overwritten),
  `offer_share_links` (hash plus sealed token, expiry, revocation) and
  `offer_engagement_events` (`link_access` | `document_view`, with a
  suspected-bot flag).
* Storage: a private bucket `offer-documents`, path
  `<organization_id>/<offer_id>/<document_id>.pdf`. Members read their own
  organization's prefix. Nobody can read it anonymously; the customer only
  ever reads through the server.
* The BETA server (JSON repository) mirrors this model. Its files live in a
  private directory (`.data/offer-documents`, mode 0600) behind the same
  `DocumentStore` interface that a Supabase Storage adapter will implement.
* Public surface: `/o/{token}` (viewer page), `/o/{token}/info`,
  `/o/{token}/document`, `POST /o/{token}/events`. The routes are rate-limited,
  `noindex`, `no-store` and `no-referrer`, and they never reveal whether a
  token exists. Internal APIs stay session-only.
* The FEEDBACK OVERVIEW and Ponude semantics are unchanged: the period is the
  creation period, and the wait counts from `sent_at`. The Follow-up Engine
  itself is the operational view and has no period. Unresolved offers stay
  visible across quarters.

**Decision.**
* **Bearer links, 256-bit random tokens.** Lookup is by SHA-256 hash. The
  token is also sealed with AES-256-GCM under a server key (derived from
  `RENVARA_SESSION_SECRET`, or `RENVARA_SHARE_LINK_KEY` when set), so
  "Kopiraj link" works later. A database copy alone yields neither the token
  nor a usable link. Links expire (default 90 days,
  `RENVARA_SHARE_LINK_DAYS`) and can be revoked. A new link can be issued
  after revocation or expiry.
* **Upload in two steps.** The PDF is uploaded first (raw body, progress) and
  validated by MIME type, size (20 MB, `RENVARA_MAX_DOCUMENT_MB`), the `%PDF-`
  header and a full parse with pdf.js (no XFA, no document scripts). It is then staged for one hour under a
  server id. Saving the form creates the offer, document and link in one
  transaction and moves the file. An offer is never shareable without a valid
  file and link.
* **Engagement events are two different facts.** `link_access` is recorded
  server-side when the viewer page is requested (scanners included).
  `document_view` is reported by the viewer only after pdf.js rendered the
  first page in a visible tab for at least 2 s. It is counted at most once per
  viewing session per 30 minutes. Both carry `suspected_bot` from conservative
  signals: crawler or scanner user agents, prefetch, HEAD, automation
  (`navigator.webdriver`), and accesses without a view. Requests carrying a
  valid Renvara session (the salesperson) are not recorded. The internal
  preview uses an authenticated route.
* **The browser renders with pdf.js's legacy build** (`pdfjs-dist`, pinned),
  served by the server from the package (only the files the viewer needs).
  The modern build requires very recent engines (e.g.
  `Map.prototype.getOrInsertComputed`), which customers' phones may lack; the
  legacy build carries the polyfills. The server parses uploads with the same
  version in Node.
* **Data minimization.** No IP addresses and no cookies are stored for
  customers. The viewing session id lives in the tab's `sessionStorage`. Each
  event stores a coarse client family ("Safari · iOS"), not the raw user agent.
  Events are kept for `RENVARA_EVENT_RETENTION_DAYS` (default 365).

**Consequences.** The offer record stays the single source of truth for Home,
Ponude, the opportunity card and the Follow-up Engine. Counts are signals,
not proof: a link can be forwarded, and scanners can execute JavaScript.
The UI says "Pregled ponude zabilježen", never "the customer read it". Before
a public launch the following are still open: malware scanning of uploads
(none is available in this stack) and a legal review of engagement tracking
(GDPR transparency text is shown in the viewer).

**Alternatives considered.** Public bucket URLs (rejected: permanent,
enumerable, not revocable). Storing raw tokens (rejected: a database leak
exposes every link). Hash-only tokens (rejected: the link could not be copied
again later). Native `<iframe>` PDF display (rejected: iOS shows only the
first page, Android downloads instead of rendering, and it gives no reliable
"rendered" signal).
