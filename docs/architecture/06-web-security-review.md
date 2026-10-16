# 6. Web app: security and cloud readiness review

Status as of the Korisnici change (ADR-0014; web-first: ADR-0013). It lists what the running web
app (apps/beta-web) does today, and what must be done **before Renvara is
offered as a public, multi-customer product**. The BETA is a single-account,
single-organization test deployment; it is not production-ready for the
public, and this document says why.

## What runs today

| Area | Today (BETA server) | Supabase target (supabase/) |
|---|---|---|
| Sign-in | One account per member (e-mail + password). Local identity (default): the first owner from the server settings (`RENVARA_BETA_USERNAME` / `_PASSWORD`), other members with scrypt hashes in a separate identity file. `RENVARA_IDENTITY=supabase`: Supabase Auth | Supabase Auth (email + password, later SSO) |
| Sessions | HMAC-signed cookie, `HttpOnly`, `SameSite=Lax`, `Secure` in production, 8 h; logout revocations in memory; per-member cut-off (deactivation, password change) kept on disk | Supabase JWT + refresh token |
| Organizations | One organization per server; the organization id comes from the server, never from a request | Many organizations; membership-based RLS (ADR-0002) |
| Authorization | Per-member rights and roles (ADR-0014), read for every request: navigation, every page (403) and every `/api/` call; pages without a session redirect to `/login`, API calls answer 401 | RLS on every CRM table by module right, `admin_*` functions with the same rules, pgTAP-tested |
| Data | One JSON file + PDF directory on one volume | PostgreSQL + private Storage bucket |
| In-browser demo | Accepts **any** username/password; data stays in the visitor's browser (or the artifact's test database). Not an authentication. | — |

The Supabase schema, RLS policies and pgTAP tests exist in this repository.
With `RENVARA_IDENTITY=supabase` the server uses Supabase Auth and the member
tables (`member_permissions`, `admin_audit_log`, `admin_*` functions) for
**Korisnici**; the **CRM data itself is still in the server's JSON store**.

## Korisnici (ADR-0014)

* **Rights on the server.** 40 rights in `core/permissions.js` (same keys in
  `private.permission_definitions`). Every page address and API route has its
  rule; without it: 403 (page with "Povratak na početnu") or `403` JSON.
  Hidden buttons are only convenience (tests: `users.test.ts`,
  E2E scenario in the Korisnici report).
* **Revocation applies to open sessions.** Rights and status are read for
  every request; deactivation and password changes also refuse every cookie
  issued until then (per-member cut-off, strictly increasing).
* **No passwords in application data.** Local identity: scrypt (N=2^15, r=8,
  p=1) in a separate file (mode 0600), never in the CRM store; Supabase:
  only in Supabase Auth. New members and resets get one-time links (72 h /
  2 h); the token is in the address fragment and only its SHA-256 is kept.
  Password policy: at least 12 characters, letters and digits, not the
  member's name or e-mail, confirmed (the same in Supabase Auth config).
* **Re-authentication** before changing someone else's password (the
  administrator's own current password) and the separate right
  `users.change_password`; stricter rate limit (10 / 10 min per member) on
  password operations, 10 / 10 min per address on the public set-password call.
* **Self-protection.** Nobody deactivates themselves or changes their own
  rights; administrators and owners are changed only by an owner; nobody
  gives or takes a right they lack; the last active owner stays (checked in
  the service and again in SQL).
* **Administration log** with result and the names of changed fields/rights,
  never passwords, tokens or personal data values; append-only in the
  database.
* **Personal data.** OIB and phone: not in the member list, not readable by
  teammates in Supabase (column privileges).

## IZVJEŠTAJI (ADR-0015)

* **Every report, PDF and e-mail checked on the server**: `reports.view` and
  `opportunities.view` for all, `reports.sales_reps` for comparing
  colleagues, `reports.email` for sending (tests: `reports.test.ts`, E2E).
  The organization comes from the session; filters are read and checked on
  the server (chosen customer, deal and representative must exist in it).
* **E-mail only from the server.** The Resend key is an environment variable
  of the server, never in a page; the PDF is made on the server from the same
  filters (the browser sends no numbers and no file). Address and subject are
  checked (no header injection), the attachment name is cleaned. One request
  id → at most one e-mail (plus the service's idempotency key); limits per
  member (10 / 10 min) and per organization (200 / day). Not configured →
  503, never a false success.
* **Logs without personal data.** The send log keeps who, to whom, report,
  period, attachment name and the result — not the text or the PDF; the
  server log has no addresses or keys. Supabase: `report_email_log` written by
  the service role only, append-only; members see their own sends,
  owners/administrators all.
* **Limits**: 60 reports per minute per member, 1.100 days and 5.000 closed
  deals per report, 15 MB per e-mailed PDF. PDF responses: `no-store`,
  `default-src 'none'; sandbox`.
* **Status history** is append-only (store and `opportunity_status_history`,
  written by a trigger; RLS by `opportunities.view`).

## Controls in place (verified by tests in apps/beta-web/test)

* **Credentials only on the server.** No password, session secret or push key
  is sent to the browser (test: `serves no credentials to the browser`).
  Nothing in `public/` mentions a Supabase key; there is no service-role key
  anywhere in the browser code.
* **Private pages.** Every app page (`core/routes.js`) and every `/app/` asset
  needs a session (test: `gives every page its own address …, each behind the
  sign-in`). Hiding a menu item is never the protection.
* **Server-side context.** The organization and the user of a CRM call come
  from the session, never from the request body or query.
* **CSRF.** Writes are JSON-only and same-origin (`Sec-Fetch-Site`, `Origin`);
  cookies are `SameSite=Lax`.
* **Security headers.** Strict CSP (`script-src 'self'`, no inline scripts),
  `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: same-origin`, COOP;
  private responses are `no-store`.
* **Input limits.** JSON bodies 4–32 KB, PDF uploads type- and size-checked;
  validation of every write on the server (the same rules as the forms).
* **Rate limits by endpoint kind** (fixed windows, per process):

  | Endpoint kind | Budget | Counted per |
  |---|---|---|
  | Failed sign-ins | 10 / min | client address |
  | Any `/api/` call without a session (sign-in included) | 60 / min | client address |
  | API reads (`GET`) | 1200 / min | user |
  | API writes (`POST`/`PATCH`/`PUT`) | 240 / min | user |
  | Test notification | 5 / 10 min | user |
  | Offer PDF uploads | 30 / 10 min | user |
  | Customer offer link `/o/…` | 120 / min | client address |
  | Offer view events from that link | 30 / min | client address |

  Behind one proxy (`RENVARA_TRUST_PROXY=true`) the client address is the one
  the proxy appends; a client cannot choose it (tests: `rate-limits.test.ts`,
  `behind a reverse proxy`).
* **HTTPS.** In the cloud setups (deploy/) HTTPS terminates at Caddy or the
  Fly.io proxy; production cookies are `Secure`.
* **Logs.** Structured events (sign-in, rate limits, notification delivery,
  unhandled errors); never request bodies, passwords, tokens or cookies.

## Gaps before a public, multi-customer production

Must be done, in this order of risk:

1. **Real authentication.** Done for Korisnici (ADR-0014): one account per
   person, invitation and reset links, Supabase Auth mode. Still open: MFA,
   e-mail verification of address changes in local mode, account lockout
   notification. The demo login stays a demo.
2. **Connect the Supabase backend.** Move CRM data from the JSON file to
   PostgreSQL with the existing RLS policies, through the user's JWT
   (PostgREST/RPC) or a server using the user's JWT. Never the service-role
   key in the browser; on a server only for back-office jobs. Re-run the
   pgTAP suite against the deployed database.
3. **Organization isolation end-to-end.** Organization from the JWT and
   memberships only; tests that call the API directly with another
   organization's ids (read, change, delete) and expect a refusal.
4. **Private file storage.** Offer PDFs in a private Storage bucket, served
   only through the existing sealed links or signed short-lived URLs; no
   public bucket, no storage paths in pages.
5. **Session management.** Per-member "sign out everywhere" now exists
   (deactivation, password change; survives restarts). Still open: a session
   list per member, idle timeout, logout revocations that survive restarts
   (a single logged-out cookie stays valid until its 8 h expiry after a
   restart), and cut-offs in shared storage for more than one instance.
6. **Distributed rate limits.** Today's limits are per process; with more than
   one instance they must move to a shared store (e.g. Postgres or Redis) or
   the edge (proxy/WAF). Add account lockout notification.
7. **Secrets management.** Platform secrets only (already so); rotate the
   session secret and VAPID keys on staff changes; no secret in the image or
   the repository (already so).
8. **Error monitoring and audit.** Central error tracking and alerting.
   Member administration is logged (ADR-0014); sign-ins are logged as
   events; data exports are not yet logged.
9. **Backups and recovery.** Point-in-time recovery for the database, restore
   drills; today: volume snapshots only.
10. **Legal and privacy.** GDPR (processing agreement, data location in the
    EU, retention and deletion), cookie notice for the sign-in cookie. This
    setup does not make the product compliant by itself.

## Cloud deployment readiness

* **Ready for a closed BETA**: one container, one volume, HTTPS at the proxy,
  secrets in the platform (deploy/README.md, ADR-0012). Verified locally in
  Docker with Caddy; not yet run on Fly.io or a real VPS.
* **Not ready for public sign-ups**: items 1–4 above are required first.
