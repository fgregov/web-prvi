# Renvara BETA web

A small Node.js server that puts real, server-side authentication in front of
the approved Renvara screens:

```
/login  →  POST /api/auth/login  →  signed HttpOnly session cookie  →  /dashboard
```

> **Temporary single-user BETA authentication.** One account, configured
> through environment variables. It is not production identity management and
> is replaced by Supabase Auth in a later phase (see "Migration").

## Run it locally

Requirements: Node.js 22.18+ and pnpm (from the repository root: `pnpm install`).

```bash
cp apps/beta-web/.env.example apps/beta-web/.env
# edit apps/beta-web/.env: set the username, password and a session secret
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"   # secret

pnpm beta        # from the repository root
# → [renvara-beta] Listening on http://localhost:3000
```

Open http://localhost:3000. The server refuses to start, and names the
missing variable, when configuration is incomplete. It never falls back to
default credentials.

| Variable                    | Required | Purpose                                                       |
| --------------------------- | -------- | ------------------------------------------------------------- |
| `RENVARA_BETA_USERNAME`     | yes      | The first owner's username (case-sensitive)                   |
| `RENVARA_BETA_PASSWORD`     | yes\*    | Its password (case-sensitive, never trimmed)                  |
| `RENVARA_BETA_PASSWORD_HASH` | \*      | Instead of the password: its scrypt hash (`scrypt$N$r$p$salt$key`, as the localhost package writes it) |
| `RENVARA_BETA_EMAIL`        | no       | The first owner may also sign in with this e-mail             |
| `RENVARA_IDENTITY_FILE`     | no       | Members' credentials, links, session cut-offs (default: next to the data) |
| `RENVARA_IDENTITY`          | no       | `local` (default) or `supabase` (see **Korisnici**)           |
| `RENVARA_SESSION_SECRET`    | yes      | HMAC key for session cookies, 32+ characters                  |
| `RENVARA_BETA_DISPLAY_NAME` | no       | Name shown in the dashboard account menu                      |
| `RENVARA_COOKIE_SECURE`     | no       | `true`/`false`. Defaults to `true` when `NODE_ENV=production` |
| `HOST`, `PORT`              | no       | Listen address. Defaults to `127.0.0.1:3000`                  |
| `RENVARA_VAPID_*` (3)       | no       | Push reminders; all three or none (see **Push reminders**)    |
| `RENVARA_PUBLIC_ORIGIN`     | no       | The https address users open behind a tunnel or proxy         |
| `RENVARA_TRUST_PROXY`       | no       | `true` behind exactly one reverse proxy (cloud, see below)    |

`.env` files are git-ignored. Only `.env.example` (no values) is committed.

## Run it in the cloud

`apps/beta-web/Dockerfile` builds the server as one container (Node 22,
production dependencies only, runs as `node`, records and offer PDFs in the
`/data` volume, health check on `/login`). `RENVARA_EDITION=clean` (default)
starts empty; `demo` seeds the presentation demo. Two ready setups, with
steps in Croatian in [`deploy/README.md`](../../deploy/README.md):

- **Fly.io**: `fly.toml` at the repository root (one always-on machine,
  volume `renvara_data`, Frankfurt, `https://<app>.fly.dev`).
- **Own server**: `deploy/docker-compose.yml` with Caddy (automatic HTTPS for
  `RENVARA_DOMAIN`, HSTS, http → https).

Both set `RENVARA_TRUST_PROXY=true`: every connection then comes from the
proxy, so the failed-login limit counts per client using the last
`X-Forwarded-For` entry (the one the proxy itself adds; client-sent entries
before it are ignored). Without it, behind a proxy, ten wrong passwords from
anyone would block every sign-in for a minute. Run one instance only: the
records are one JSON file and the reminder scheduler runs in the process.

## Routes

| Route                            | Access      | Behaviour                                                                                 |
| -------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `GET /`                          | public      | Redirects to `/dashboard` with a valid session, otherwise to `/login`                     |
| `GET /login`                     | public      | The sign-in page. Redirects to `/dashboard` when already signed in                        |
| `POST /api/auth/login`           | public      | JSON `{username, password}` → `200 {success, redirectTo}` · `400` · `401` · `415` · `429` |
| `POST /api/auth/logout`          | public      | Revokes the session, clears the cookie → `200 {success, redirectTo: "/login"}`            |
| `GET /api/auth/session`          | public      | `{authenticated, user?}`. Identity only                                                   |
| `GET /dashboard`, `/dashboard/*` | **session** | The approved dashboard (`prototypes/home`), served unchanged                              |
| Every other page | **session** | One address per page, see **Pages** below; old addresses → `301`, unknown → `404` page    |

## How it works

- **One credential check.** `src/auth/beta-provider.ts` compares SHA-256
  digests of the submitted values with `timingSafeEqual`, always checking both
  fields. Responses never say which field was wrong.
- **Input rules.** The username is trimmed. The password is used exactly as
  typed. Empty values return `400`.
- **Sessions.** `src/auth/session.ts` issues `base64url(payload).HMAC-SHA256`
  tokens. The payload holds only id, username, display name, role, `iat`, `exp`
  and a session id, never the password. The lifetime is 8 hours.
- **Cookie.** `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=28800`. Over HTTPS
  (`NODE_ENV=production`) it adds `Secure` and the `__Host-` name prefix.
  JavaScript in the page cannot read it.
- **Protection.** `requireAuth` in `src/app.ts` runs on the server for every
  `/dashboard` request, including CSS, JS and images. A missing, tampered,
  revoked or expired token gets a `302` to `/login`. An expired one goes to
  `/login?reason=expired`, which shows "Vaša sesija je istekla."
- **Logout and Back.** Logout (**Odjava** in the sidebar) revokes the session id
  on the server. Protected responses are `Cache-Control: no-store`. Every page
  also re-checks the session when the browser restores it from the
  back/forward cache.
- **CSRF.** POST endpoints accept only `application/json` from the same origin
  (`Origin` and `Sec-Fetch-Site` are checked). Combined with `SameSite=Lax`,
  cross-site forms cannot log anyone in or out. No CORS headers are sent.
- **Rate limits by endpoint kind** (`429` with `Retry-After`): 10 failed logins
  per client per minute; any `/api/` call without a session 60 per client per
  minute; signed-in API reads 1200 and writes 240 per user per minute; the test
  notification 5 per user per 10 minutes; PDF uploads 30 per user per 10
  minutes; the customer's offer link 120 (its view events 30) per client per
  minute. Details and the gaps before a public production:
  [docs/architecture/06-web-security-review.md](../../docs/architecture/06-web-security-review.md).
- **Logging.** Events only (`login_failed`, `login_succeeded`, `logout`) with
  IP and time. Never bodies, passwords, tokens or cookies.

## CRM: customers, contacts, opportunities, tasks, Sales Calendar

All CRM data lives **on the server** (`src/crm`). The browser only calls the
JSON API; nothing is kept in localStorage any more. Every request is scoped to
the caller's organization, which the server takes from its own configuration
(BETA: one organization), never from the request.

### Quick Add

**+ Novo** (top of the sidebar; **+** in the top bar below 1024 px) opens a sheet with exactly five actions. Each
opens its own screen (same tab). After saving, Novi kupac opens the customer
profile and Novi lead opens the new lead; the others return to where they were
opened:

| Action       | Screen               |
| ------------ | -------------------- |
| Novi kupac   | `/sales/customers/new`     |
| Nova prilika | `/sales/opportunities/new` |
| Novi kontakt | `/sales/contacts/new`      |
| Novi zadatak | `/sales/tasks/new`         |
| Novi lead    | `/sales/leads/new`         |

The sheet closes on selection, on a tap outside it, on Esc and on a swipe down.
**Nova prilika** asks first "Poveži priliku s: Lead | Kupac" (ADR-0009): a
lead's deal needs no customer.

### Tasks and the Sales Calendar

- A **task** stands on its own. Customer, contact and opportunity are optional
  links. The server checks that each link exists in the organization and that
  the contact and opportunity belong to the chosen customer.
- Every task has a **date** (required, also on the server). "Dodaj u Sales
  Kalendar" puts the task in the **Sales Calendar** on that date
  (`allDay` + date, or `scheduledStartAt`/`scheduledEndAt`); otherwise the date,
  with an optional time, is the task's date (`dueDate` xor `dueAt`). A next
  action entered with a new opportunity needs its date too. An older task saved
  without a date is shown in DANAS as "Datum nije unesen" until it gets one.
- The Sales Calendar is a **view over tasks**: there is no separate calendar
  record. Completed tasks stay in it (green check, "Dovršeno"). Cancelled tasks
  drop out. Nothing is deleted.
- **Overdue** = open and past its deadline. **Prioritetni zadaci** on Home: open HIGH
  first, then overdue, then due today; tasks completed today stay ticked.
- `FOLLOW_UP` is a task type. There is no follow-up engine yet.
- Context comes from the query: `/sales/tasks/new?companyId=…&contactId=…&opportunityId=…&type=…&calendar=1&date=YYYY-MM-DD&returnTo=/path`.

### Leads

A **lead** is a potential customer before it becomes one: its own record
(`public.leads`), not a customer with a flag. Only the name is required; the
server sets organization, owner (the current user), stage `new` and status
`active`.

- **Stage** (how far it got): Novi lead → Kontaktiran → Kvalificiran.
  **Status** (how it ended): Aktivan, **Won** or **Lost**. Lead won/lost is
  independent of opportunity won/lost.
**Lead-first sales (ADR-0009):** LEAD → PRILIKA (no customer) → WON / LOST →
conversion → new or existing customer (ACTIVE). No customer is ever created
automatically.

- **Kreiraj priliku** on Lead Detail opens the New opportunity form linked to
  the lead (`/sales/opportunities/new?leadId=…`); no customer is needed. A lead can
  have several opportunities, each with its own outcome; Lead Detail lists
  them (`#prilike`) with the same card and actions as a customer's
  (offers, PDF offers, tasks, Dobiveno / Izgubljeno). Lost leads get no new
  deals.
- **Won** = one of the lead's opportunities was won: the lead becomes WON
  (`wonAt`, `wonBasis: "opportunity"`; a later win keeps the first date). A
  lost opportunity never changes the lead. A lead with active opportunities
  cannot be closed as lost.
- After a won lead deal: **PRILIKA JE OSVOJENA!** "Želite li sada pretvoriti
  ovaj lead u kupca?" — KREIRAJ KUPCA / POVEŽI S POSTOJEĆIM KUPCEM / KASNIJE.
  KASNIJE leaves the lead WON with "Čeka pretvaranje u kupca" and
  **PRETVORI U KUPCA** on Lead Detail ("Čeka kupca" in the list).
- **Conversion** (`/sales/leads/{id}/convert`, "Pretvori lead u kupca"): only a WON
  lead; a NEW customer (prefilled from the lead, created ACTIVE, so it is in
  Aktivni and Svi) or an EXISTING one (an inactive customer only after
  "Ponovno aktiviraj"). One idempotent transaction: a repeated call returns
  the customer already linked, never a second one. The won opportunity keeps
  its id, values, offers, tasks and history, gets the customer and keeps the
  lead. The lead's other opportunities stay the lead's; "Poveži s kupcem" on
  such a card links one explicitly (only to the lead's customer). A new
  customer that looks like an existing one (OIB, similar name, company e-mail
  domain) returns `409` with the matches until the user links the existing one
  or confirms ("Ipak kreiraj novog").
- **Lost** = closed explicitly, with an optional reason and note.
- Leads are never deleted or merged: a converted lead keeps `convertedAt` and
  points at what it became; a lost lead keeps `lostAt` and its reason. Leads
  WON before this change (WON then meant converted) keep their state with
  `wonAt = convertedAt` and `wonBasis: "conversion"`.
- Tasks may carry `leadId` (no customer needed; "Dodaj zadatak" on a lead or a
  lead's deal; they are in the Sales Calendar as usual). On conversion, the
  lead's tasks without a customer get the new customer too.
- **Reporting by each outcome's own date:** new leads by `createdAt`,
  qualified by `qualifiedAt`, won by `wonAt`, converted by `convertedAt`
  (reported separately, with the WON leads still waiting for conversion), lost
  by `lostAt`. A lead created in Q3 and won in Q4 is a new lead of Q3 and a won
  lead of Q4, and it is counted once however many deals it has.
  `leadOutcomeMetrics` (`@renvara/domain`): win rate = won ÷ (won + lost),
  W/L = won ÷ lost, conversion = won ÷ created; active leads count as neither.
  Opportunity KPIs (potential, won value, NEGOTIATIONS, won/lost, rates)
  include lead deals; BUYERS counts the customer, or the lead before
  conversion, once.

### Home periods

Under the header, Home shows the selected period (default: the current
quarter). The current quarter shows the operational dashboard; a past quarter
or a custom range ("Ručni odabir perioda") shows the historical dashboard:
results, completed work (green checks) and unfinished work (neutral). The
period is one shared state (`core/dashboard-period.js`, kept for the browser
session, cleared on logout); quarter math lives in `core/period.js`, shared
with the server. Choosing a period only changes the query: no record is
changed, archived or reset. `src/crm/demo-metrics.ts` adds demo numbers per
quarter on top of the real records (BETA only; delete it with real data).

### Home: KPIs, pipeline and feedback

All of Home reads one summary (`GET /api/dashboard/summary`) for the selected
period, so the cards, the pipeline and the feedback list never disagree.
Definitions (`src/crm/dashboard-service.ts`; organization's records, period
in the organization's timezone, each count by its own event date):

| Widget                       | Counts                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| LEADS (card and pipeline)    | Leads created in the period                                                                                                  |
| WON NUMBER / RATE            | Opportunities won in the period (`closedAt`) · won ÷ (won + lost); "—" when nothing closed. `#` / `%` remembered per browser |
| LOST NUMBER / RATE           | Opportunities lost in the period · lost ÷ (won + lost). A lost **lead** is not a lost opportunity                           |
| OPPORTUNITY Potential / Won  | Estimate of opportunities created in the period / final value of those won in it (EUR, in cents; other currencies apart)    |
| PROSPECTS                    | Leads that first became prospects (stage Kvalificiran, `qualifiedAt`) in the period; "Označi kao Prospect" on New Lead     |
| NEGOTIATIONS                 | Distinct opportunities with a commercial event in the period: created, offer sent or answered, a task of it completed       |
| BUYERS YYYY                  | Distinct customers with a won opportunity from 1 January of the period's end year up to the end of the period               |
| SALES KALENDAR               | The period's calendar tasks (the same tasks as `/sales-calendar`; no separate calendar records)                                   |
| FEEDBACK OVERVIEW            | Sent offers still waiting: waiting days counted from the sending day (= 1D), 1–4D yellow, 5–9D red, 10D+ black            |

A past period shows the same widgets as of its end (BUYERS and FEEDBACK "Stanje
na d.m."). The OPPORTUNITY PIPELINE card (its title, every row and "Full
dashboard") and the OPPORTUNITY card open the Opportunity Pipeline
(`/opportunity-pipeline`, sidebar: Prikaz više → Opportunity pipeline), with the stages closed.
The FEEDBACK OVERVIEW card (its title and "Svi") opens Ponude. Task priority
colours: LOW yellow, MEDIUM red, HIGH black (always with the label).

"Svi" on FEEDBACK OVERVIEW opens **FEEDBACK OVERVIEW / PONUDE**
(`/feedback-overview`), laid out like the Opportunity Pipeline: the period
button next to the title and every offer **created** in Home's period in
accordions **ČEKA ODGOVOR**, **ODGOVORENO** and **NACRTI** (plus **POVUČENO /
ZATVORENO** when there are withdrawn offers or offers of closed deals), closed
on a new visit; `?status=waiting|answered|draft` opens that one. Where an offer stood is
taken at the period's end (now, for the running quarter), so an offer created
in Q3 and sent on 2 October is not waiting in the Q3 view. Only a sent offer
that is still waiting has a day badge (same bands, counted from sending);
drafts, answered, withdrawn offers and offers of closed deals show their state
instead. Waiting offers come first, most urgent first. A row opens the offer on
its customer's opportunity card (`/sales/customers/{id}?offer={offerId}#prilike`,
the offer marked), as offers have no page of their own. The task module on
Home is **PRIORITETNI ZADACI**, its link "Pogledaj sve zadatke" (→ `/sales/tasks`).

### Customer Detail

The header card (identity and all customer actions: Zakaži sastanak, Kreiraj
priliku, Novi zadatak, Dodaj bilješku, Dodaj kontakt, Pošalji e-mail, Uredi
kupca, Deaktiviraj kupca), then **PREGLED**, **PRILIKE**, **AKTIVNOSTI**,
**ZADACI** and **KONTAKTI** as accordions: closed on every visit, the whole
header (icon, title, number of records — none for PREGLED —, chevron) opens and
closes one, several can be open at once, and they stay open while the profile
refreshes after an action. A link to a section (`#pregled`, `#prilike`,
`#kontakti` …, or an offer from Feedback overview) opens that one. The sections have no create buttons of
their own; creating stays in the header card.

The **Opportunity Pipeline** (`/opportunity-pipeline`) shows its five stages the same
way; "Nova prilika" stays at the top, with the period button next to it
(`[ Q4 2026 ▾ ] [ + Nova prilika ]`). The period is Home's (shared with Home
and Ponude, kept for the session, so coming Back from an opportunity keeps it):
quarters year by year, or "Ručni odabir perioda" (Od / Do, the end not before
the start). The stages list the **open opportunities created in the period**
(the reporting rule Home uses for opportunities), each in the stage it is in
today: stage changes are not recorded with dates, so a past period does not
show where a deal stood at its end, and the page says so. The demo's static
stage totals (42 / 28 / 18 / 11 / 6) belong to the current quarter only. A
period without open opportunities says "Nema evidentiranih prilika za odabrani
period." Choosing a period only reads; a new opportunity is always created
today. **Zadaci** (`/sales/tasks`) works the same way: DANAS, NADOLAZEĆE and DOVRŠENO are
accordions with their number of tasks, closed on every visit and
open while the page stays open. "Novi zadatak" stays at the top of the page.
On both pages, coming Back (e.g. from a task) shows the sections that were
open; the open sections are kept in that history entry (`ui/accordion.js`), so
a new visit never inherits them.

### Customer activation

On Customer Detail, **Deaktiviraj kupca** (after the confirmation "Deaktivirati
kupca?") moves the customer to the inactive customers; **Aktiviraj kupca**
brings the same record back. Nothing else changes: contacts, tasks,
opportunities, offers, reminders and leads stay as they are, and reports keep
counting the customer's history. Activation (`status`: active / inactive, with
`deactivatedAt` / `deactivatedBy`) is separate from the commercial type
(customer / prospect). `/sales/customers` shows **Aktivni** by default, with
**Neaktivni** and **Svi** (`?status=`); search stays within the chosen filter.
Customer pickers in forms still list every customer.

### Offers and closing deals

On an opportunity card (`/sales/customers/{id}#prilike`, or a lead's deal on
`/sales/leads/{id}#prilike`): **Ponuda
poslana** (title, sending date) records an offer; **Odgovor primljen** marks
it answered (it leaves the feedback list, the record stays); **Dobiveno**
closes the deal as won with its final amount (`wonValue`, when it differs from
the estimate); **Izgubljeno** closes it as lost with a reason. Each writes an
activity. Closing cancels the deal's pending reminder.

### Follow-up Engine: offer PDFs and customer links

`/follow-up` (sidebar: Follow-up engine) lists the offers of the selected period,
unresolved first, with filters **Sve / Čeka odgovor / Pregledano / Riješeno**
and their counts. The period is the shared one (Home, Opportunity Pipeline,
Ponude): its button sits with **+ Attach new document** (side by side where
both fit, otherwise right above it) and offers Q1–Q4 of any year and
"Ručni odabir perioda" (OD / DO). Offers count by their creation date, as on
Ponude; a period that includes today also keeps the earlier offers that are
still unresolved, so an offer waiting since last quarter is still waiting
(the caption says how many). A past period lists its offers as they stand
today: the period never changes an offer's wait or views. Each card shows the customer,
offer, opportunity, sending date, recorded views and the wait badge
(1–4D yellow, 5–9D red, 10D+ black; the sending day is day 1; a view never
resets the wait). Design and security decisions: ADR-0008.

1. **+ Attach new document** (`/follow-up/new`): pick a PDF (PDF only, up to
   20 MB, checked in the browser and again on the server: type, size, `%PDF-`
   header, parsed with pdf.js, password-protected PDFs refused). It uploads at
   once with progress ("Učitavanje dokumenta... 68%") into private storage.
   Name, "Poveži s: Kupac | Lead" (a customer, with an optional opportunity
   and contact of that customer; or a lead and one of its opportunities, no
   customer needed), internal note.
2. **Spremi i generiraj link** creates the offer (a draft), its document and a
   secret link in one transaction: **PONUDA USPJEŠNO DODANA** with **Kopiraj
   link**, **Pregledaj ponudu**, **Označi kao poslano**. Renvara sends no
   e-mail: the salesperson pastes the link into their own e-mail.
3. **Označi kao poslano** (now, or an earlier date and time, never in the
   future): the wait starts there; a recorded sending is never overwritten.
   **Označi odgovorenim** resolves it. **Opozovi link** stops the link at once
   (the offer, document and history stay); **Generiraj novi link** issues a
   new one.
4. The customer opens `/o/{token}` without an account: the offer's title and
   PDF (rendered with pdf.js, download offered), nothing internal. A view is
   recorded when the first page has been visible for 2 s ("Pregled ponude
   zabilježen" on the offer and the customer's timeline): a signal that the
   offer was opened, not proof that it was read.

Links: 32 random bytes (256 bits, base64url), stored only as a SHA-256 hash
(lookup) and sealed with AES-256-GCM (so the link can be copied again); they
expire after `RENVARA_SHARE_LINK_DAYS` (90) and can be revoked. Whoever has an
active link can open the offer (bearer access), as the UI says. Viewer and
public routes: `noindex`, `Referrer-Policy: no-referrer`, `no-store`, a strict
CSP, rate limits (120 requests/min per IP, 30 view events/min per IP); the PDF
is sent only to a valid token, never from a public file URL.

Engagement: `link_access` (the link was requested; mail scanners do this too)
and `document_view` (rendered and visible) are kept apart. Scanners, link
previews, prefetch, `HEAD`, missing user agents, automated browsers and
repeats within 3 s count as **Mogući automatski pristup**, never as views.
Views from one viewing session within 30 minutes count once; the salesperson's
own preview and any request with a Renvara session are not counted. Stored per
event: time, type, a random per-tab session id, a coarse client family
("Safari · iOS"), suspected-bot reason. No IP address, no raw user agent, no
cookies; events older than `RENVARA_EVENT_RETENTION_DAYS` (365) are deleted.
The detail screen refreshes every 30 s while open.

Offers with a PDF open in the Follow-up Engine from Ponude and the Home
feedback list; opportunity cards link them and offer **Priloži PDF ponude**.

### Push reminders

Tasks (create/edit form), leads (New Lead, "Postavi podsjetnik" on the lead)
and opportunities (New opportunity, "Podsjetnik" on the card) take an optional
reminder: date + time, or a preset (Za 1 sat, Sutra, Za 3 dana, Za 7 dana).
The browser asks for notification permission only when the reminder switch is
turned on.

- **Delivered by the server**, not by the page: `src/notifications/reminder-scheduler.ts`
  runs every 30 s, claims due reminders (pending → processing, so none is sent
  twice), sends Web Push (RFC 8291 encryption, RFC 8292 VAPID; `web-push.ts`,
  no dependencies) to every enabled device of the recipient, and records sent
  or failed. Transient failures retry after 1 and 5 minutes (3 attempts);
  devices the push service reports gone are switched off; a claim left by a
  crash is released after 5 minutes. Logs carry reminder ids, never tokens or
  content.
- Moving a reminder changes the same record; removing it, or completing /
  cancelling / converting / winning / losing its record, cancels it.
- **Saved is not delivered.** Without VAPID keys, or without a device that
  allowed notifications, the reminder is saved but fails visibly ("nije
  isporučen", with the reason) instead of pretending to be sent. The switch's
  note says in advance whether this device will receive it.
- **Setup:** `pnpm --filter @renvara/beta-web push:keys` prints the three
  `RENVARA_VAPID_*` lines for `.env` (keep the private key secret; changing
  keys invalidates existing devices). Production needs HTTPS. Android Chrome,
  desktop Chrome/Edge/Firefox and Safari (macOS 13+) work in the browser;
  **iPhone/iPad need iOS 16.4+ and the app added to the Home Screen** (the
  page provides `manifest.webmanifest` and `sw.js`). Native app push
  (APNs/FCM) is not part of this BETA; `push_subscriptions` already has
  `platform`/`provider` for it.
- **Check it:** **Postavke** in the sidebar (MOBILNE OBAVIJESTI)
  shows whether this device receives push and turns it on here (**Uključi na
  ovom uređaju**; the permission prompt comes from that tap, as iOS requires).
  The Home header has no notification bell (UPDATE 08); the server's test notification
  (`POST /api/push/test`, signed-in session) is unchanged but no screen offers
  a button for it.
- Reminders are delivered while **Podsjetnik** is on in MOBILNE OBAVIJESTI
  (below); one held back is recorded as not delivered and says why.

### MOBILNE OBAVIJESTI

**Postavke** at the bottom of the sidebar opens `/settings` (old address
`/notifications`), with MOBILNE OBAVIJESTI: seven switches, each saved on
the server for the signed-in user only (all off for a new user), plus the time
used for deadlines given as a date only. Design: ADR-0010.

| Switch | Event | Opens |
| --- | --- | --- |
| Pregled ponude | a qualifying view of a shared offer (not a preview, not a scanner); at most one per offer every 30 min | the offer in Follow-up Engine |
| Podsjetnik | a reminder the user set (the existing reminder system) | its task, lead or opportunity |
| Rok za izvršenje zadatka | an open task reaches its deadline (`dueAt`, or `dueDate` at the chosen time) | the task |
| Rok za izvršenje prilike | an active opportunity reaches its expected close date, at the chosen time | the opportunity (customer or lead) |
| Feedback Overview — niski / srednji / visoki prioritet | a sent offer still waiting enters 1D / 5D / 10D (the Feedback Overview bands) | the offer in Follow-up Engine |

- **Once per event, from now on.** Each notification has an idempotency key;
  nothing repeats inside a band or after a restart. Switching a type on never
  sends what happened before; an event found more than 24 h late is skipped.
  A completed task, a closed opportunity, an answered offer or a switch turned
  off cancels a notification not yet sent.
- **No invented times.** "Rokovi bez vremena" sets the time for date-only
  deadlines; without it they are not notified.
- **Honest delivery state.** The screen says whether this device receives push
  (the permission is asked when a switch is turned on, at most once per visit,
  never on load), whether it is blocked ("Mobilne obavijesti nisu dopuštene na
  ovom uređaju. Omogućite ih u postavkama uređaja."), or whether the server
  has no push keys. A save that fails puts the switch back and says
  "Postavku nije moguće spremiti. Pokušajte ponovno."
- Lock-screen text: the event and the customer or record name, never amounts,
  notes, contacts or link tokens. `notificationDeliveries` records what the
  push service accepted (no device receipt exists for Web Push).

#### One iPhone, no App Store

1. On a computer that stays on: Node 22.18+, pnpm, this repository; in
   `apps/beta-web/.env` the BETA account, `RENVARA_SESSION_SECRET`,
   `NODE_ENV=production` and the three `RENVARA_VAPID_*` lines (subject: your
   own `mailto:` address). Run `pnpm beta` (it listens on 127.0.0.1 only).
2. Give it an https address the iPhone can open, e.g. Tailscale Funnel
   (`tailscale funnel 3000`, a fixed `https://<machine>.<tailnet>.ts.net`)
   or Cloudflare Tunnel. Put that address in `RENVARA_PUBLIC_ORIGIN` and
   restart. Keep the address fixed: the Home Screen app is bound to it.
3. iPhone, Safari: open the address → Share → **Add to Home Screen** → open
   Renvara from the Home Screen → sign in → **Obavijesti** (bottom
   navigation) → **Uključi na ovom uređaju** (or switch a type on) → Allow.

Reminders arrive only while that computer runs the server (it sends them, at
most ~30 s late, through Apple's push service). iOS settings (Notifications →
Renvara, Focus) decide how they are shown.

### Pages

Every page has its own address (ADR-0013); one table, `public/app/js/core/routes.js`,
serves the BETA server and the in-browser demo. Every page needs a session.

| Route | Page | Sidebar |
| --- | --- | --- |
| `/dashboard` | Početna (Home) | Početna |
| `/follow-up?filter=all\|waiting\|viewed\|resolved` | FOLLOW-UP ENGINE (offer overview, the shared period) | Follow-up engine |
| `/follow-up/new`, `/follow-up/{id}`, `/follow-up/{id}/preview` | Attach new document, offer detail (`?new=1`: success), own preview (not counted) | Follow-up engine |
| `/sales/leads?status=active\|won\|lost` | Leads: Svi / Aktivni / Won / Lost | Prodaja → Leads |
| `/sales/leads/new`, `/sales/leads/{id}`, `/sales/leads/{id}/convert` (`?mode=existing&opportunityId=`) | New lead, Lead Detail (with its opportunities), Pretvori lead u kupca (WON leads) | Prodaja → Leads |
| `/sales/opportunities?status=active\|won\|lost\|all&q=` | Prilike: every opportunity, filter and search kept in the address | Prodaja → Prilike |
| `/sales/opportunities/new` (`?companyId=` or `?leadId=`), `/sales/opportunities/{id}` | New opportunity (Lead \| Kupac), one opportunity with its card and actions | Prodaja → Prilike |
| `/sales/tasks` | Zadaci: DANAS, NADOLAZEĆE, DOVRŠENO (accordions) | Prodaja → Zadaci |
| `/sales/tasks/new`, `/sales/tasks/{id}`, `/sales/tasks/{id}/edit` | New task, task detail, edit task | Prodaja → Zadaci |
| `/sales/customers?status=`, `/sales/customers/new`, `/sales/customers/{id}` | List with search, New Customer, Customer Detail | Prodaja → Kupci |
| `/sales/contacts/new` | New contact (customer required) | Prodaja → Kupci |
| `/sales-calendar?week=YYYY-MM-DD` | Sales Kalendar (week view; earlier weeks show history) | Prikaz više → Sales kalendar |
| `/opportunity-pipeline` | Pipeline (stages as accordions, Home's period) with next actions | Prikaz više → Opportunity pipeline |
| `/feedback-overview?status=waiting\|answered\|draft` | FEEDBACK OVERVIEW / PONUDE (offers of Home's period) | Prikaz više → Feedback overview |
| `/reports` | Izvještaji: "U produkciji – uskoro." (no data yet) | Izvještaji |
| `/users?status=&q=&sort=&dir=&page=`, `/users/new`, `/users/{id}` | KORISNICI list, NOVI KORISNIK, PREGLED KORISNIKA | Korisnici |
| `/set-password#token=…` (public) | Set a password from an invitation or reset link | — |
| `/settings` | Postavke: MOBILNE OBAVIJESTI | Postavke |
| `/o/{token}` (public, no session) | The customer's offer viewer | — |

Old addresses answer **301** with the new one and the same query (the browser
keeps `#section`): `/customers…`, `/contacts/new`, `/tasks…`, `/leads…` →
`/sales/…`; `/opportunities` → `/opportunity-pipeline`; `/opportunities/new` →
`/sales/opportunities/new`; `/calendar` → `/sales-calendar`; `/notifications` →
`/settings`; `/more` → `/dashboard`. A trailing slash is dropped the same way.
Any other address gets the page-not-found screen (404, `login/not-found.html`).

### API (session required; writes: JSON, same origin)

| Endpoint                                                                                                  | Purpose                                         |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `GET/POST /api/customers` (`?q=` name or OIB, `?status=active\|inactive\|all`, default all), `GET/PATCH /api/customers/{id}` | Customers, profile                              |
| `POST /api/customers/{id}/deactivate`, `POST /api/customers/{id}/activate`                                | Deactivate / reactivate a customer              |
| `POST /api/customers/{id}/notes`, `POST /api/customers/{id}/emails`                                       | Timeline entries                                |
| `GET/POST /api/contacts` (`?companyId=`)                                                                  | Contacts                                        |
| `GET/POST /api/opportunities` (`?companyId=&leadId=&status=&from=&to=`), `GET /api/opportunities/{id}`, `GET /api/pipeline` (`?from=&to=`) | Opportunities (`companyId` and/or `leadId`, at least one), next action, pipeline totals (`from`/`to`: created in that period; 422 for an invalid range) |
| `POST /api/opportunities/{id}/link-customer`                                                              | Link a lead's other deal to the customer the lead was converted into |
| `GET/POST /api/leads` (`?status=&q=`), `GET/PATCH /api/leads/{id}`                                        | Leads, Lead Detail (with opportunities, tasks and history) |
| `GET /api/leads/{id}/matches`, `POST /api/leads/{id}/convert` (`{conversionMode: CREATE_CUSTOMER\|EXISTING_CUSTOMER, customerId? \| customer, createContact?, contact?, opportunityId?, reactivate?, ignoreMatches?}`), `POST /api/leads/{id}/lost` | Possible customers, conversion of a WON lead (idempotent), LOST |
| `GET/POST /api/tasks` (`?status=&type=&priority=&companyId=&contactId=&opportunityId=&leadId=`)           | Tasks                                           |
| `GET/PATCH /api/tasks/{id}`, `POST /api/tasks/{id}/complete\|reopen\|cancel`                              | One task                                        |
| `GET /api/tasks/sections`, `GET /api/tasks/priorities`                                                    | Tasks screen, Home "Prioritetni zadaci"         |
| `GET /api/calendar?from=ISO&to=ISO` or `?date=YYYY-MM-DD`                                                 | Sales Calendar (explicit range, up to 400 days) |
| `GET /api/dashboard/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`                                                | Home: KPIs, pipeline overview, feedback          |
| `POST /api/opportunities/{id}/close` (`{outcome: won\|lost, wonValue?, lostReason?}`)                     | Close a deal                                    |
| `POST /api/offers` (`{opportunityId, title, sentDate?}`), `POST /api/offers/{id}/answered`                | Offer sent, answer received                     |
| `GET /api/offers?from=YYYY-MM-DD&to=YYYY-MM-DD&status=all\|waiting\|answered\|draft`                       | FEEDBACK OVERVIEW / PONUDE                      |
| `PUT /api/tasks\|leads\|opportunities/{id}/reminder` (`{reminderAt: ISO \| null}`)                         | Set, move or remove a reminder                  |
| `GET /api/push/status`, `POST /api/push/subscriptions`, `POST /api/push/unsubscribe`                      | Push availability, this device on/off           |
| `GET /api/notifications/preferences`, `PATCH /api/notifications/preferences` (`{preferences?: {type: boolean}, deadlineTime?: "HH:MM" \| null}`) | MOBILNE OBAVIJESTI: the user's own switches (422 for invalid input) |
| `POST /api/demo/reset`                                                                                    | Restore this organization's demo data (owner)   |
| `GET /api/notifications/recent`                                                                           | Home widget Obavijesti: the member's last 5     |
| `GET/POST /api/users` (`?status=active\|inactive\|all&q=&sort=&dir=&page=&pageSize=`), `GET/PATCH /api/users/{id}` | Korisnici: list (no OIB), create (`{firstName, lastName, oib, email, phone, role?, permissions?}` → `{user, link}`), detail with `can`, edit |
| `POST /api/users/{id}/deactivate\|activate`, `PUT /api/users/{id}/access` (`{role, permissions}`), `GET /api/users/{id}/audit` | Status, rights, administration log |
| `POST /api/users/{id}/password` (`{currentPassword, password, confirm}`), `POST /api/users/{id}/password-link` | Change a password (own password first), reset link |
| Public: `POST /api/auth/set-password` (`{token, password, confirm}`)                                      | Set a password from a link (once)               |
| `POST /api/follow-up/uploads` (raw `application/pdf` body, `X-File-Name`; `415`, `413`)                   | Stage a PDF (validated, private, 1 h)           |
| `GET /api/follow-up/offers?filter=all\|waiting\|viewed\|resolved&from=YYYY-MM-DD&to=YYYY-MM-DD` (period optional; 422 for an invalid range), `POST /api/follow-up/offers` (`{uploadId, title, companyId, opportunityId?, contactId?, note?}`) | Follow-up list with counts; create offer + document + link |
| `GET /api/follow-up/offers/{id}`, `GET /api/follow-up/offers/{id}/document`                               | Offer detail (link, engagement, history), its PDF |
| `POST /api/follow-up/offers/{id}/sent` (`{sentAt?}`), `…/answered`, `…/link/revoke`, `…/link`             | Mark sent / answered, revoke link, new link     |
| Public: `GET /o/{token}/info`, `GET /o/{token}/document`, `POST /o/{token}/events` (`{type: "view", sessionId}`) | Viewer data, PDF, view event (`404` "Ova poveznica više nije dostupna." for unknown, revoked or expired links) |

Create and update of tasks, leads and opportunities also accept `reminderAt`;
the record and its reminder are saved together or not at all.

Every route has its right (ADR-0014): without it `403 {message: "Nemate pravo
pristupa ovoj funkcionalnosti."}`; pages answer 403 with the 403 page.

Errors: `401` without a session, `404 {message: "Odabrani podatak nije dostupan."}`,
`422 {message, errors: {field: message}}` for invalid input or relations,
`409 {message, matches}` for a conversion into a customer that may already exist,
`409 {message, customerInactive}` for a conversion into an inactive customer
without `reactivate`.

### Code

- Server: `src/crm/` (`customer-service.ts`, `contact-service.ts`,
  `opportunity-service.ts`, `task-service.ts`, `calendar-service.ts`,
  `lead-service.ts`, `dashboard-service.ts`, `offer-service.ts`,
  `reminder-service.ts`, `push-subscription-service.ts`, `dispatch.ts`
  (transport-neutral API), `routes.ts`, `repository.ts`, `seed.ts`; Follow-up
  Engine: `follow-up-service.ts`, `follow-up-api.ts` (async, binary bodies),
  `follow-up-routes.ts` (HTTP: headers, limits, viewer), `share-token.ts`,
  `engagement.ts`, `document-store.ts`/`file-document-store.ts`,
  `pdf-inspect.ts`), `public/viewer/` (customer viewer, pdf.js renderer) and
  `src/notifications/` (Web Push sender, reminder scheduler). Rules shared with the browser come
  from `public/app/js/core/validation.js`. Next action and timezone logic come
  from `@renvara/domain`.
- Client: `public/app/js/` with `core/` (API client, validation, formatting),
  `ui/` (`screen.js`: MobilePageHeader, SaveActionBar, UnsavedChangesDialog;
  `fields.js`; `sheet.js`; `form.js`), `features/` (pickers, quick-add, tasks,
  customers) and `pages/`.
- Storage (BETA): one JSON file, written atomically, `RENVARA_DATA_FILE`
  (default `apps/beta-web/.data/crm.json`, git-ignored). In the presentation
  edition it is seeded with demo data dated relative to the first start, and
  "Vrati demo podatke" on `/sales/customers` re-seeds it (see **Editions** below). The schema mirrors `supabase/migrations`, so the repository can be
  swapped for Supabase without touching the services.

| Variable               | Default          | Purpose                                       |
| ---------------------- | ---------------- | --------------------------------------------- |
| `RENVARA_BETA_ORG_ID`  | `org-beta`       | Organization of the BETA account              |
| `RENVARA_ORG_TIMEZONE` | `Europe/Zagreb`  | Interprets dates ("today", date-only entries) |
| `RENVARA_DATA_FILE`    | `.data/crm.json` | BETA data file                                |
| `RENVARA_DOCUMENTS_DIR` | `.data/offer-documents` | Private folder of offer PDFs (0700/0600) |
| `RENVARA_MAX_DOCUMENT_MB` | `20`           | Largest PDF (1–50)                            |
| `RENVARA_SHARE_LINK_DAYS` | `90`           | Days a customer link stays valid              |
| `RENVARA_EVENT_RETENTION_DAYS` | `365`     | Days engagement events are kept               |
| `RENVARA_SHARE_LINK_KEY` | from the session secret | Seals link tokens (≥ 32 characters). Changing it keeps links working but they can no longer be shown again |
| `RENVARA_PUBLIC_ORIGIN` | the request's host | Origin of customer links (use the HTTPS address customers can reach) |

### Web layout: computers first, tablets and phones

Renvara is a web app used in the browser (ADR-0013). Every signed-in page
shows the same navigation (`ui/app-shell.js`, styles in `public/app/css/web.css`,
loaded last on every page):

| Width | Navigation | Content |
| --- | --- | --- |
| 1024 px+ (computers, laptops) | Sidebar on the left (256 px); **Sažmi izbornik** narrows it to icons (remembered in this browser), lists then open as a panel beside the icon | Home: KPI cards in one row, Sales Kalendar beside Prioritetni zadaci, pipeline and Feedback overview below; lists up to 1360 px, Home up to 1440 px; forms on a centred card |
| < 1024 px (tablets, phones) | Top bar: menu button, RENVARA, **+**; the menu opens the same sidebar as a drawer (Esc, the ✕ or a tap outside closes it) | One column; forms on a card from 768 px |

Sidebar: Početna, Follow-up engine, **Prodaja** ▾ (Leads, Prilike, Zadaci,
Kupci), **Prikaz više** ▾ (Sales kalendar, Opportunity pipeline, Feedback
overview), Izvještaji, Korisnici; at the bottom the signed-in user, Postavke
and Odjava. Prodaja and Prikaz više only open and close their lists (never a
page); a list is open on its own pages, otherwise as the user left it in this
tab. The page you are on is marked (red, `aria-current="page"`). There is no
bottom navigation and no floating **+**. On a form with unsaved input, a
sidebar or Quick Add link asks first ("Želite li odbaciti unesene podatke?"),
like Back. Sheets (Quick Add) and confirmations open as dialogs in the middle
from 600 px. No page scrolls sideways from 320 px to 1920 px (checked in the
browser).

### Editions: presentation demo or clean start

One switch, `public/app/js/core/edition.js` (`DEMO_CONTENT`), read by the
browser code and the server alike:

| `DEMO_CONTENT`             | What you get                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `true` (default)           | Presentation demo: demo records on first start, fixed demo numbers on Home (KPIs per quarter, pipeline totals), offers waiting in "Feedback overview", the notification dot, prefilled "Novi kupac", "Vrati demo podatke" (`POST /api/demo/reset`).                  |
| `false` (`demo:build:empty`) | Clean start for real use: no records, every number counts only what was entered, no examples, a blank "Novi kupac", no demo reset (the route does not exist). All functions are the same. |

## On one computer (localhost package)

`pnpm --filter @renvara/beta-web localhost:build` (`localhost/build.ts`) makes
`dist/renvara-localhost/` and `dist/renvara-localhost.zip`: the real server in
one file (`program/apps/beta-web/server/renvara.mjs`, bundled with rolldown,
clean edition), the pages, the pdf.js files it uses, and launchers that need
only Node.js 20.11+ (no `pnpm install`, no network):

| File | Purpose |
| ---- | ------- |
| `Pokreni-Renvaru-Windows.bat`, `Pokreni-Renvaru-Mac.command`, `pokreni-renvaru-linux.sh` | Double-click: start, open the browser |
| `program/start.mjs` (`localhost/start.mjs`) | First start: asks the owner's name, username, e-mail and password; keeps only its scrypt hash (`RENVARA_BETA_PASSWORD_HASH`), a session secret and VAPID keys in `podaci/postavke.json` (0600). Then starts the server on `127.0.0.1` (port 3000 or the next free one) with data in `podaci/`. `--nova-lozinka`, `--port=`, `--bez-preglednika` |
| `PROCITAJ-ME.txt` | Instructions for users (Croatian) |

The server finds its files from its own location (`src/app-dir.ts`), so the
layout below `program/` mirrors the repository. The CI job "Localhost package"
unzips it outside the repository, runs the first start and signs in; the
Pages workflow publishes the ZIP (`/renvara-localhost.zip`) and attaches it to
the run.

## Static demo

```bash
pnpm --filter @renvara/beta-web demo:build         # → apps/beta-web/dist/demo/index.html (presentation demo)
pnpm --filter @renvara/beta-web demo:build:empty   # → the same file as a clean start (no demo data)
pnpm --filter @renvara/beta-web demo:build:mobile  # → dist/demo-mobile/index.html (presentation demo, phone frame)
pnpm --filter @renvara/beta-web demo:folder        # → demo-app/: all three as pages that open from disk
```

Builds a clickable demo as **one self-contained page** (scripts, styles and
images inlined; sources staged in `dist/demo-src`): the same pages and the same
CRM services, with the API answered in the browser (`demo/runtime.js`). Any
username and password sign in.

`demo-app/` (repository root) holds the three builds as complete pages to open
by double-click (`file://`), with a README in Croatian. Outside an artifact the
records stay in the browser's storage; the clean start (`renvara.clean.*`) and
the presentation demo (`renvara.demo.*`) use separate keys, because pages
opened from disk share one storage. Clean-start records saved under the old
shared key are taken over once.

- Published as a claude.ai artifact with the `db` capability, records are kept
  in the artifact's test database, one document per record
  (`customers/<id>`, `contacts/<id>`, `opportunities/<id>`, `tasks/<id>`,
  `activities/<id>`, `leads/<id>`, `offers/<id>`, `reminders/<id>`). A write
  is reported as saved only after the database has it; otherwise it is undone
  and the form shows an error. `demo/database-store.js` writes one document at
  a time (records before their history), gives every platform call a bounded
  wait (10 s, one retry) so an unanswered call can never block later saves,
  and on a failure puts back what that save had written. (Before this, a write
  that never got an answer froze every later save: the "Lead → Task" freeze.)
- Follow-up Engine in the demo: offer records go to the same store
  (`offers/`, `offerDocuments/`, `offerShareLinks/`, `offerEvents/`), the PDF
  files only to this browser's IndexedDB (never into the database). There is
  no public address, so a link is a path (`/o/{token}`) that opens the
  customer viewer inside the demo, where opening it counts as a customer view
  so the engine can be seen working. pdf.js (same version, legacy build)
  loads from jsDelivr. The demo's link key is fixed and public: demo links
  protect nothing.
- Reminders can be saved in the demo, but the artifact page cannot register a
  service worker and has no server, so they are never delivered; the reminder
  switch says so.
- Anywhere else (or when the database is unavailable) the data stays in the
  browser's localStorage. The presentation demo re-seeds it once a day; the
  clean start keeps what was entered.

The **mobile demo** (`--mobile`) is the presentation demo for showing Renvara as
a phone app: on a wide screen with a mouse it runs the app in a phone-sized
frame (an iframe of the same page, so the app's own phone layout applies) next
to a short guide, with "Vrati demo na početak" (fresh example data) and
"Prikaži preko cijelog prozora"; on phones and tablets it is the app, full
screen. If the frame does not start within 8 s, the app runs directly in the
page. It keeps data in the browser only (no artifact database).

Nothing in the app's sources changes for the demo: the build redirects
`window.location`/`history` to an in-page router and fails if it finds any it
does not handle.

### Public test address (GitHub Pages)

`.github/workflows/pages.yml` publishes the in-browser build at
`https://<owner>.github.io/<repo>/` (`/` with demo data, `/prazno/` clean start,
`/mobilni/` phone frame) on every change. It needs, once, Settings → Pages →
Source: **GitHub Actions**, and for a branch other than the default one
Settings → Environments → `github-pages` → that branch; until then the site is
built and the publish step is skipped.

## Tests

```bash
pnpm --filter @renvara/beta-web test
```

`test/auth-core.test.ts` covers configuration, the credential check, input
parsing, tokens and the rate limiter. `test/auth-http.test.ts` starts a real
server and covers the 12 required cases plus CSRF, rate limiting, caching,
path traversal and logging. `test/crm-services.test.ts` covers the task model,
relation rules, tenant isolation, calendar ranges, priorities and next actions.
`test/crm-api.test.ts` covers the same over HTTP: session, CSRF, `422`/`404`
responses and cross-organization access. `test/dashboard-metrics.test.ts`
covers the KPI, pipeline and feedback definitions (event dates, rates, money,
as-of views); `test/push-reminders.test.ts` covers Web Push encryption against
RFC 8291's known answer, VAPID, scheduling, retries, cancellation and an HTTP
round trip to a local push service; `test/demo-database-store.test.ts` covers
the demo database faults (no answer, quota, partial writes);
`test/lead-service.test.ts` includes the Lead → Task regression cases;
`test/follow-up.test.ts` covers upload validation, offer + document + link,
relations, tenant isolation, sending and wait bands, filters, the public link,
view and bot events, internal views, revocation and expiry, and the HTTP layer
(session, CSRF, `415`/`413`, headers, rate limits, assets);
`test/rate-limits.test.ts` covers the API budgets by endpoint kind;
`test/web-layout.test.ts` covers the sidebar items and addresses, the route
table, old addresses and that no page links to them. The tests generate a random password each run, so
no real credential is stored in the repository.

## Manual acceptance test

1. **Valid login.** Open http://localhost:3000. You land on `/login`. Enter the
   configured username and password, then press Enter or tap **Prijava**. The
   button shows "Prijava..." and you arrive at `/dashboard`. Refresh, and you
   stay signed in.
2. **Invalid password.** Use the right username with `wrong123`. You stay on
   the page with "Neispravno korisničko ime ili lozinka." The password field
   is cleared.
3. **Invalid username.** Use `test` with the right password. You see the same
   generic message.
4. **Direct access.** In a private window, open
   http://localhost:3000/dashboard. You are redirected to `/login`.
5. **Logout.** Signed in, choose **Odjava** at the bottom of the sidebar (below
   1024 px: the menu button, top left, then **Odjava**). You land
   on `/login`. Opening `/dashboard` or pressing Back leads to `/login` again.

## Known limitations (BETA)

- The first owner's password lives only in the server's environment (not
  hashed at rest); other members' passwords are scrypt hashes in the identity
  file (local identity) or in Supabase Auth. Without e-mail (local identity)
  the administrator passes the one-time link on; with Supabase Auth it is
  e-mailed.
- Session cut-offs (deactivation, password change) are in the identity file
  of one server: several instances would need shared storage.
- Logout revocations and rate-limit counters are kept in memory. A restart
  forgets them, and they are not shared across multiple server instances.
- Behind a reverse proxy, the limits count the client only with
  `RENVARA_TRUST_PROXY=true` (exactly one proxy in front); otherwise they see
  the proxy's address.
- The login page needs JavaScript (it submits JSON).
- "Zaboravljena lozinka?" tells the member to ask an administrator for a reset
  link (Korisnici → Lozinka i sigurnost). Apple, Google and "Izradite račun"
  are visible, as in the approved design, but only show "not available in BETA".
- Public deployment must use HTTPS with `NODE_ENV=production`, so cookies are `Secure`.
- CRM data is one JSON file written synchronously by one process: fine for a
  single BETA user, not for concurrent writers or several instances.
- No calendar sync (Google/Outlook/Apple), recurring tasks or task
  dependencies. Push reminders are Web Push only (no native APNs/FCM app), are
  delivered at most about 30 s late by a single server process, and only to
  devices that allowed notifications; the device's own settings (focus modes,
  battery saving) can still delay or hide them. Times use the browser's timezone for input and
  the organization's timezone for "today" and date-only entries; in the BETA
  both are Europe/Zagreb.
- MOBILNE OBAVIJESTI use the same Web Push path: verified end to end against a
  local push service (encrypted, VAPID-signed, decrypted), not on a real phone
  in this repository's tests. Delivery to a phone needs VAPID keys, HTTPS and a
  device that allowed notifications (iPhone: the app added to the Home
  Screen). A Feedback band or deadline is notified once; there is no repeating
  reminder policy yet.

- Follow-up Engine: PDFs are stored on the server's disk (BETA); production
  uses the private Supabase bucket `offer-documents` (migration
  `20261014120000_follow_up_engine.sql`). There is no malware scanning of
  uploads yet (only PDF validation), no automatic e-mail, no push
  notification for views, and staged uploads are kept in memory (lost on
  restart: pick the file again). Customer links need a public HTTPS address
  (`RENVARA_PUBLIC_ORIGIN`); behind a proxy the per-client limits need
  `RENVARA_TRUST_PROXY=true`.
  View counts are signals: a scanner that runs a full browser can look like a
  person, and a person who blocks scripts is not counted. The privacy text in
  the viewer and the retention period need review for your GDPR obligations.
- Lead-first sales: a lead's deal shows no customer until the lead is
  converted; the lead's other deals are linked to the customer one by one
  ("Poveži s kupcem"), never automatically. Opportunities created by
  conversions before ADR-0009 have no `leadId` (their lead still points at
  them through `convertedOpportunityId`); no history was reinterpreted.

## Korisnici: members and access rights (ADR-0014)

`/users` lists the organization's members (Aktivni by default, search, sort,
pages). A click marks one row; **Odaberi** opens it, **Deaktiviraj** /
**Aktiviraj** ask first (DA / NE). **Dodaj** opens NOVI KORISNIK: Ime,
Prezime, OIB (check digit), E-mail (the sign-in address, unique), Telefon and,
for administrators with the right, the role and rights. No password is typed
there: the member gets a one-time link and sets it. PREGLED KORISNIKA has
OSNOVNI PODACI, LOZINKA I SIGURNOST (the administrator confirms with their own
password; or a reset link), PRAVA PRISTUPA (accordions with "x od y", saved
with **Spremi prava pristupa**, a warning for unsaved changes) and POVIJEST
PROMJENA.

Rights (`public/app/js/core/permissions.js`) are checked on the server for
every page and API call and read for every request, so changes apply to open
sessions. The sidebar, Quick Add and Home widgets show only what is allowed.
Rules: `src/identity/rules.ts`; service: `src/identity/user-service.ts`; API:
`src/identity/users-api.ts`, `routes.ts`.

Identity back ends:

* **local** (default): members in the CRM store; credentials (scrypt), links
  (SHA-256 of the token) and session cut-offs in `RENVARA_IDENTITY_FILE`
  (mode 0600, never inside the CRM data). The first owner is the account from
  `RENVARA_BETA_USERNAME/_PASSWORD` (optionally `RENVARA_BETA_EMAIL`).
* **supabase**: `RENVARA_IDENTITY=supabase`, `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only) and
  `RENVARA_BETA_ORG_ID` = the organization's uuid. Credentials in Supabase
  Auth (invitations and resets by e-mail to `<origin>/set-password`; add it to
  the Auth redirect URLs), members and rights in `member_permissions`, log in
  `admin_audit_log`, changes through the `admin_*` functions
  (migration `20261017120000_user_management.sql`). Create the organization
  and its first owner once in Supabase (SQL editor or the Auth dashboard):
  an Auth user, an `organizations` row and an `organization_members` row with
  role `owner`. The CRM data stays in the server's store in this mode.

Tests: `test/users.test.ts` (catalog = migration, rules, validation, the whole
module over HTTP); `test/supabase-identity.test.ts` against a Supabase project
(runs when `RENVARA_SUPABASE_TEST_URL`, `…_ANON_KEY`, `…_SERVICE_KEY` are set,
e.g. the local stack); pgTAP `supabase/tests/database/12_user_management.test.sql`.
