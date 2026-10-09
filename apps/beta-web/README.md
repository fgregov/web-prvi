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
| `RENVARA_BETA_USERNAME`     | yes      | The one authorised username (case-sensitive)                  |
| `RENVARA_BETA_PASSWORD`     | yes      | Its password (case-sensitive, never trimmed)                  |
| `RENVARA_SESSION_SECRET`    | yes      | HMAC key for session cookies, 32+ characters                  |
| `RENVARA_BETA_DISPLAY_NAME` | no       | Name shown in the dashboard account menu                      |
| `RENVARA_COOKIE_SECURE`     | no       | `true`/`false`. Defaults to `true` when `NODE_ENV=production` |
| `HOST`, `PORT`              | no       | Listen address. Defaults to `127.0.0.1:3000`                  |
| `RENVARA_VAPID_*` (3)       | no       | Push reminders; all three or none (see **Push reminders**)    |

`.env` files are git-ignored. Only `.env.example` (no values) is committed.

## Routes

| Route                            | Access      | Behaviour                                                                                 |
| -------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `GET /`                          | public      | Redirects to `/dashboard` with a valid session, otherwise to `/login`                     |
| `GET /login`                     | public      | The sign-in page. Redirects to `/dashboard` when already signed in                        |
| `POST /api/auth/login`           | public      | JSON `{username, password}` → `200 {success, redirectTo}` · `400` · `401` · `415` · `429` |
| `POST /api/auth/logout`          | public      | Revokes the session, clears the cookie → `200 {success, redirectTo: "/login"}`            |
| `GET /api/auth/session`          | public      | `{authenticated, user?}`. Identity only                                                   |
| `GET /dashboard`, `/dashboard/*` | **session** | The approved dashboard (`prototypes/home`), served unchanged                              |

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
- **Logout and Back.** Logout revokes the session id on the server. Protected
  responses are `Cache-Control: no-store`. The dashboard also re-checks the
  session when the browser restores it from the back/forward cache.
- **CSRF.** POST endpoints accept only `application/json` from the same origin
  (`Origin` and `Sec-Fetch-Site` are checked). Combined with `SameSite=Lax`,
  cross-site forms cannot log anyone in or out. No CORS headers are sent.
- **Rate limit.** 10 failed logins per IP per minute → `429` with `Retry-After`.
- **Logging.** Events only (`login_failed`, `login_succeeded`, `logout`) with
  IP and time. Never bodies, passwords, tokens or cookies.

## CRM: customers, contacts, opportunities, tasks, Sales Calendar

All CRM data lives **on the server** (`src/crm`). The browser only calls the
JSON API; nothing is kept in localStorage any more. Every request is scoped to
the caller's organization, which the server takes from its own configuration
(BETA: one organization), never from the request.

### Quick Add

The dashboard's **+** opens a bottom sheet with exactly five actions. Each
opens its own screen (same tab). After saving, Novi kupac opens the customer
profile and Novi lead opens the new lead; the others return to where they were
opened:

| Action       | Screen               |
| ------------ | -------------------- |
| Novi kupac   | `/customers/new`     |
| Nova prilika | `/opportunities/new` |
| Novi kontakt | `/contacts/new`      |
| Novi zadatak | `/tasks/new`         |
| Novi lead    | `/leads/new`         |

The sheet closes on selection, on a tap outside it, on Esc and on a swipe down.

### Tasks and the Sales Calendar

- A **task** stands on its own. Customer, contact and opportunity are optional
  links. The server checks that each link exists in the organization and that
  the contact and opportunity belong to the chosen customer.
- **Zakazano** (`scheduledStartAt`/`scheduledEndAt`, or `allDay` + date) puts a
  task in the **Sales Calendar**. **Rok** (`dueDate` xor `dueAt`) is the
  deadline. The two are independent.
- The Sales Calendar is a **view over tasks**: there is no separate calendar
  record. Completed tasks stay in it (green check, "Dovršeno"). Cancelled tasks
  drop out. Nothing is deleted.
- **Overdue** = open and past its deadline. **Prioriteti** on Home: open HIGH
  first, then overdue, then due today; tasks completed today stay ticked.
- `FOLLOW_UP` is a task type. There is no follow-up engine yet.
- Context comes from the query: `/tasks/new?companyId=…&contactId=…&opportunityId=…&type=…&calendar=1&date=YYYY-MM-DD&returnTo=/path`.

### Leads

A **lead** is a potential customer before it becomes one: its own record
(`public.leads`), not a customer with a flag. Only the name is required; the
server sets organization, owner (the current user), stage `new` and status
`active`.

- **Stage** (how far it got): Novi lead → Kontaktiran → Kvalificiran.
  **Status** (how it ended): Aktivan, **Won** or **Lost**. Lead won/lost is
  independent of opportunity won/lost.
- **Won** = converted into a customer (new or existing), optionally with a
  contact person and an opportunity (`/leads/{id}/convert`). One transaction
  that reuses the customer, contact and opportunity services. A new customer
  that looks like an existing one (OIB, similar name, company e-mail domain)
  returns `409` with the matches until the user links the existing one or
  confirms ("Ipak kreiraj novog").
- **Lost** = closed explicitly, with an optional reason and note.
- Leads are never deleted or merged: a won lead keeps `convertedAt` and points
  at what it became; a lost lead keeps `lostAt` and its reason.
- Tasks may carry `leadId` (no customer needed; "Dodaj zadatak" on a lead). On
  conversion, the lead's tasks without a customer get the new customer too.
- **Reporting by each outcome's own date:** new leads by `createdAt`,
  qualified by `qualifiedAt`, won by `convertedAt`, lost by `lostAt`. A lead
  created in Q3 and won in Q4 is a new lead of Q3 and a won lead of Q4.
  `leadOutcomeMetrics` (`@renvara/domain`): win rate = won ÷ (won + lost),
  W/L = won ÷ lost, conversion = won ÷ created; active leads count as neither.

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
| SALES KALENDAR               | The period's calendar tasks (the same tasks as `/calendar`; no separate calendar records)                                   |
| FEEDBACK OVERVIEW            | Sent offers still waiting: waiting days counted from the sending day (= 1D), 1–4D yellow, 5–9D red, 10D+ black            |

A past period shows the same widgets as of its end (BUYERS and FEEDBACK "Stanje
na d.m."). Task priority colours: LOW yellow, MEDIUM red, HIGH black (always
with the label).

### Offers and closing deals

On a customer's opportunity card (`/customers/{id}#prilike`): **Ponuda
poslana** (title, sending date) records an offer; **Odgovor primljen** marks
it answered (it leaves the feedback list, the record stays); **Dobiveno**
closes the deal as won with its final amount (`wonValue`, when it differs from
the estimate); **Izgubljeno** closes it as lost with a reason. Each writes an
activity. Closing cancels the deal's pending reminder.

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

### Pages

| Route                                             | Page                                                   |
| ------------------------------------------------- | ------------------------------------------------------ |
| `/customers`, `/customers/new`, `/customers/{id}` | List with search, New Customer, Customer Detail        |
| `/contacts/new`                                   | New contact (customer required)                        |
| `/opportunities`, `/opportunities/new`            | Pipeline with next actions, New opportunity            |
| `/tasks`                                          | Zadaci: DANAS, NADOLAZEĆE, BEZ DATUMA, DOVRŠENO        |
| `/tasks/new`, `/tasks/{id}`, `/tasks/{id}/edit`   | New task, task detail, edit task                       |
| `/calendar?week=YYYY-MM-DD`                       | Sales Kalendar (week view; earlier weeks show history) |
| `/leads?status=active\|won\|lost`                  | Leads (bottom navigation): Svi / Aktivni / Won / Lost  |
| `/leads/new`, `/leads/{id}`, `/leads/{id}/convert` | New lead, Lead Detail, Pretvori u kupca                |

### API (session required; writes: JSON, same origin)

| Endpoint                                                                                                  | Purpose                                         |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `GET/POST /api/customers` (`?q=` name or OIB), `GET/PATCH /api/customers/{id}`                            | Customers, profile                              |
| `POST /api/customers/{id}/notes`, `POST /api/customers/{id}/emails`                                       | Timeline entries                                |
| `GET/POST /api/contacts` (`?companyId=`)                                                                  | Contacts                                        |
| `GET/POST /api/opportunities` (`?companyId=&status=`), `GET /api/opportunities/{id}`, `GET /api/pipeline` | Opportunities, next action, pipeline totals     |
| `GET/POST /api/leads` (`?status=&q=`), `GET/PATCH /api/leads/{id}`                                        | Leads, Lead Detail (with tasks and history)     |
| `GET /api/leads/{id}/matches`, `POST /api/leads/{id}/convert`, `POST /api/leads/{id}/lost`                | Possible customers, conversion (WON), LOST      |
| `GET/POST /api/tasks` (`?status=&type=&priority=&companyId=&contactId=&opportunityId=&leadId=`)           | Tasks                                           |
| `GET/PATCH /api/tasks/{id}`, `POST /api/tasks/{id}/complete\|reopen\|cancel`                              | One task                                        |
| `GET /api/tasks/sections`, `GET /api/tasks/priorities`                                                    | Tasks screen, Home "Prioriteti"                 |
| `GET /api/calendar?from=ISO&to=ISO` or `?date=YYYY-MM-DD`                                                 | Sales Calendar (explicit range, up to 400 days) |
| `GET /api/dashboard/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`                                                | Home: KPIs, pipeline overview, feedback          |
| `POST /api/opportunities/{id}/close` (`{outcome: won\|lost, wonValue?, lostReason?}`)                     | Close a deal                                    |
| `POST /api/offers` (`{opportunityId, title, sentDate?}`), `POST /api/offers/{id}/answered`                | Offer sent, answer received                     |
| `PUT /api/tasks\|leads\|opportunities/{id}/reminder` (`{reminderAt: ISO \| null}`)                         | Set, move or remove a reminder                  |
| `GET /api/push/status`, `POST /api/push/subscriptions`, `POST /api/push/unsubscribe`                      | Push availability, this device on/off           |
| `POST /api/demo/reset`                                                                                    | Restore this organization's demo data           |

Create and update of tasks, leads and opportunities also accept `reminderAt`;
the record and its reminder are saved together or not at all.

Errors: `401` without a session, `404 {message: "Odabrani podatak nije dostupan."}`,
`422 {message, errors: {field: message}}` for invalid input or relations,
`409 {message, matches}` for a conversion into a customer that may already exist.

### Code

- Server: `src/crm/` (`customer-service.ts`, `contact-service.ts`,
  `opportunity-service.ts`, `task-service.ts`, `calendar-service.ts`,
  `lead-service.ts`, `dashboard-service.ts`, `offer-service.ts`,
  `reminder-service.ts`, `push-subscription-service.ts`, `dispatch.ts`
  (transport-neutral API), `routes.ts`, `repository.ts`, `seed.ts`) and
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
  "Vrati demo podatke" on `/customers` re-seeds it (see **Editions** below). The schema mirrors `supabase/migrations`, so the repository can be
  swapped for Supabase without touching the services.

| Variable               | Default          | Purpose                                       |
| ---------------------- | ---------------- | --------------------------------------------- |
| `RENVARA_BETA_ORG_ID`  | `org-beta`       | Organization of the BETA account              |
| `RENVARA_ORG_TIMEZONE` | `Europe/Zagreb`  | Interprets dates ("today", date-only entries) |
| `RENVARA_DATA_FILE`    | `.data/crm.json` | BETA data file                                |

### Editions: presentation demo or clean start

One switch, `public/app/js/core/edition.js` (`DEMO_CONTENT`), read by the
browser code and the server alike:

| `DEMO_CONTENT`             | What you get                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `true` (default)           | Presentation demo: demo records on first start, fixed demo numbers on Home (KPIs per quarter, pipeline totals), offers waiting in "Feedback overview", the notification dot, prefilled "Novi kupac", "Vrati demo podatke" (`POST /api/demo/reset`).                  |
| `false` (`demo:build:empty`) | Clean start for real use: no records, every number counts only what was entered, no examples, a blank "Novi kupac", no demo reset (the route does not exist). All functions are the same. |

## Static demo

```bash
pnpm --filter @renvara/beta-web demo:build         # → apps/beta-web/dist/demo/index.html (presentation demo)
pnpm --filter @renvara/beta-web demo:build:empty   # → the same file as a clean start (no demo data)
pnpm --filter @renvara/beta-web demo:build:mobile  # → dist/demo-mobile/index.html (presentation demo, phone frame)
```

Builds a clickable demo as **one self-contained page** (scripts, styles and
images inlined; sources staged in `dist/demo-src`): the same pages and the same
CRM services, with the API answered in the browser (`demo/runtime.js`). Any
username and password sign in.

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
`test/lead-service.test.ts` includes the Lead → Task regression cases. The tests generate a random password each run, so
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
5. **Logout.** Signed in, tap the avatar (top right), then **Odjava**. You land
   on `/login`. Opening `/dashboard` or pressing Back leads to `/login` again.

## Known limitations (BETA)

- A single account from environment variables, with no hashing at rest. The
  password lives only in the server's environment.
- Logout revocations and rate-limit counters are kept in memory. A restart
  forgets them, and they are not shared across multiple server instances.
- Behind a reverse proxy, rate limiting sees the proxy's IP, because
  `X-Forwarded-For` is deliberately not trusted yet.
- The login page needs JavaScript (it submits JSON).
- "Zaboravljena lozinka?", Apple, Google and "Izradite račun" are visible, as
  in the approved design, but only show "not available in BETA".
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

## Migration to Supabase Auth

Routes and pages depend only on `AuthService` / `AuthProvider` /
`AuthSession` (`src/auth/types.ts`, `src/auth/service.ts`). To migrate:

1. Implement a Supabase-backed service in which `login` calls
   `signInWithPassword` and the session is Supabase's (for example, its cookie
   helpers).
2. Swap it in at `src/server.ts`. `requireAuth`, the routes, the login page and
   the dashboard stay the same.
3. Delete `beta-provider.ts` and the `RENVARA_BETA_*` variables.
