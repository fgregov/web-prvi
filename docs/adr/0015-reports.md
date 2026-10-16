# ADR-0015: IZVJEŠTAJI — one report engine, server-made PDFs, e-mail from the server

**Status.** Accepted. Builds on ADR-0003 (stage and status of an opportunity),
ADR-0013 (web-first app) and ADR-0014 (access rights). Replaces the status page
of Izvještaji.

**Context.** Version 1.0 of the reports module: four reports (revenue for a
period, revenue by quarter, WON / LOST, comparison of sales representatives),
each viewable in the app, as an A4 PDF, downloadable and e-mailed as a PDF
attachment. The numbers must come from the organization's real records, be
the same in every report, on the Dashboard and in the PDF, and respect the
rights of the member asking. The CRM data lives in the BETA server's store
(also in Supabase identity mode, ADR-0014); the Supabase schema must be ready
for the move of the CRM to PostgreSQL.

**Decision.**

* **One engine, one set of rules** (`apps/beta-web/src/reports/report-engine.ts`).
  Every report is built from the same rows — the organization's closed
  opportunities — by the same rules:
  * WON / LOST is the deal's **current** status; the date is `closedAt` (set
    when it is closed, cleared when it is reopened; never `updatedAt`). A deal
    reopened or closed again counts only as it is now, on its new date.
  * Revenue of a WON deal = its final amount (`wonValue`), else its estimate
    (`value`) — the Dashboard's definition (a test compares the two). The
    potential of a LOST deal is its estimate and is never called revenue.
  * Amounts as entered, without VAT; summed in integer cents, EUR only (another
    currency is counted and named, not converted); a deal without an amount
    counts as 0,00 € and is named.
  * Rates from the domain (`outcomeRates`): WON ÷ (WON + LOST) × 100; **N/P**
    (null) without closed deals — never a division by zero. Quarter change
    against the previous quarter (Q1 against Q4 of the year before), N/P after
    a quarter of 0 €.
  * Periods and quarters are calendar days in the organization's timezone
    (`Europe/Zagreb` by default), start inclusive, end exclusive.
  * A deal belongs to one representative, its owner (no split of revenue).
    Deals without an owner are **NEDODIJELJENO** and stay in every total.
    Compared are active members with the role Korisnik (sales) and anyone who
    owns a deal in the report.
* **Status history.** Every status change is appended (`opportunityStatusChanges`
  in the store; `public.opportunity_status_history` in Supabase, written by a
  trigger, append-only), with the amount and owner at that moment. Older deals
  get a history rebuilt from `createdAt` / `closedAt`, marked `backfill`. The
  reports read the current state; the history is for later analysis. A closed
  deal can be reopened (`reopen`, the domain rule that already existed;
  `POST /api/opportunities/:id/reopen`) — so "WON → LOST" is: reopen, then close
  as lost.
* **Filters are read on the server** (`core/reports.js`, shared with the page):
  only the filters of the chosen report, each checked; a chosen customer,
  opportunity or representative must exist in the organization (the
  organization comes from the session, never from the request). At most 1.100
  days and 5.000 closed deals per report.
* **PDF without a dependency** (`src/reports/pdf/`): a small PDF 1.7 writer
  (A4, Type0 TrueType fonts with ToUnicode, shapes, one PNG image) and the
  layout (`report-pdf.ts`): header, applied filters, key figures, charts drawn
  in the PDF, tables continued on the next page with their header, notes,
  footer with "Stranica X od Y". Liberation Sans (SIL OFL) comes from the
  pdf.js package the app already ships, so č ć đ š ž look the same in every
  reader and the text stays searchable. The in-browser demo runs the same code
  (fonts from the same pdf.js copy, the browser's compression).
* **E-mail from the server only** (`src/email/mailer.ts`): Resend's HTTP API,
  configured by `RESEND_API_KEY` and `RENVARA_EMAIL_FROM` on the server. The PDF
  is made again on the server from the same filters (the browser never sends a
  PDF or numbers). One request id per send: a repeated request gets the first
  answer, and Resend's idempotency key stops a second e-mail. Limits: 10 per
  member per 10 minutes, 200 per organization per day. Every attempt is logged
  (`reportEmails` / `public.report_email_log`: who, to whom, report, period,
  attachment name, sent or failed); never the message text, the PDF or the key.
  Without configuration the app runs and sending answers 503 with a clear
  message — never a false success.
* **Rights** (ADR-0014 catalog, now 40): `reports.view` requires
  `opportunities.view`; new `reports.sales_reps` (comparing colleagues; not a
  Korisnik default, administrators have it) and `reports.email`. Members who
  had `reports.view` get `reports.email` once (store on load, Supabase in the
  migration). Every report, PDF and send is checked on the server; in
  Supabase the view `report_closed_opportunities` and `report_outcome_totals()`
  run with the caller's rights (RLS) and require both rights.

**Consequences.** One place to change a definition; the Dashboard's WON
numbers and the reports cannot drift apart. PDFs are ~200 KB (two embedded
fonts). Rate limits and the request-id memory are per process (one BETA
server); with more instances they move to shared storage, like the session
cut-offs. The SQL view repeats the row definition of the engine for the future
PostgreSQL CRM; pgTAP tests pin it to the same rules.

**Alternatives considered.** A PDF library (pdfkit, pdf-lib): rejected, the
app has no runtime dependency besides pdf.js, and the writer is small and
tested. Headless Chrome for PDFs: rejected (size, a browser on the server).
Standard PDF fonts without embedding: rejected, č/ć/đ would depend on the
reader. Separate formulas per report: rejected by the specification. Sending
e-mail from the browser (mailto): rejected, it cannot attach the PDF and is no
server-side record.
