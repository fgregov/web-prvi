# 6. Web app: security and cloud readiness review

Status as of the web-first change (ADR-0013). It lists what the running web
app (apps/beta-web) does today, and what must be done **before Renvara is
offered as a public, multi-customer product**. The BETA is a single-account,
single-organization test deployment; it is not production-ready for the
public, and this document says why.

## What runs today

| Area | Today (BETA server) | Supabase target (supabase/) |
|---|---|---|
| Sign-in | One account from server environment variables (`RENVARA_BETA_USERNAME` / `_PASSWORD`), checked on the server only | Supabase Auth (email + password, later SSO), one account per person |
| Sessions | HMAC-signed cookie, `HttpOnly`, `SameSite=Lax`, `Secure` in production, 8 h; logout revocations in memory | Supabase JWT + refresh token |
| Organizations | One organization per server; the organization id comes from the server, never from a request | Many organizations; membership-based RLS (ADR-0002) |
| Authorization | Every page and every `/api/` call checks the session on the server; pages without a session redirect to `/login`, API calls answer 401 | RLS on every table, role checks in SQL, pgTAP-tested |
| Data | One JSON file + PDF directory on one volume | PostgreSQL + private Storage bucket |
| In-browser demo | Accepts **any** username/password; data stays in the visitor's browser (or the artifact's test database). Not an authentication. | — |

The Supabase schema, RLS policies and pgTAP tests exist in this repository,
but **the web app does not use them yet**.

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

1. **Real authentication.** Replace the single environment account with
   Supabase Auth: one account per person, password reset, email
   verification, optional MFA. The demo login stays a demo.
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
5. **Session management.** Server-side session list (sign out everywhere,
   revocation that survives restarts: today a copied cookie stays valid until
   its 8 h expiry after a restart), idle timeout, rotation on sign-in.
6. **Distributed rate limits.** Today's limits are per process; with more than
   one instance they must move to a shared store (e.g. Postgres or Redis) or
   the edge (proxy/WAF). Add account lockout notification.
7. **Secrets management.** Platform secrets only (already so); rotate the
   session secret and VAPID keys on staff changes; no secret in the image or
   the repository (already so).
8. **Error monitoring and audit.** Central error tracking and alerting;
   an audit log of sign-ins and data exports.
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
