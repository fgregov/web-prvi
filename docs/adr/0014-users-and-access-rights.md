# ADR-0014: Korisnici — members, access rights and their enforcement

**Status.** Accepted. Builds on ADR-0002 (tenant isolation) and ADR-0013
(web-first app). Replaces the "status page" of Korisnici.

**Context.** Renvara needs real user management: an administrator creates
members, deactivates them, changes their data and passwords, and decides per
member which modules, actions and Dashboard widgets they may use. The rules
must hold on the server and in the database, not only in the screens, and no
password may ever be stored in application tables, shown or logged. The BETA
server (apps/beta-web) runs without Supabase today; the Supabase schema exists
(supabase/). Both must follow the same rules.

**Decision.**

* **One catalog of rights.** `public/app/js/core/permissions.js` lists 38
  rights `<module>.<action>` in five groups (Prodaja, Dodatne funkcije,
  Dashboard, Upravljanje korisnicima, Obavijesti). A right can *require*
  others (creating leads requires seeing leads; a Dashboard widget requires
  the Dashboard **and** the data right it shows). User administration rights
  are for administrators only. The migration
  `supabase/migrations/20261017120000_user_management.sql` seeds the same
  catalog; a test compares them.
* **Roles.** `owner` (Vlasnik: every right, cannot be restricted; at least one
  active owner always remains), `admin` (Administrator: the rights given, the
  only role that may hold user administration), `user` (Korisnik: the rights
  given; stored as `sales` in `organization_members`).
* **Rules** (`apps/beta-web/src/identity/rules.ts`, the same in SQL):
  seeing the member list never allows changing anyone; administrators and
  owners are changed only by an owner; only an owner changes roles; nobody
  deactivates themselves or changes their own rights; nobody gives or takes a
  right they do not hold themselves; the last active owner cannot be
  deactivated or demoted; another organization's members are not found.
* **Enforcement in three layers.** (1) Navigation and buttons show only what
  is allowed (sidebar, Quick Add, Dashboard widgets). (2) Every page address
  has its right (`permissionForPath`); without it the server answers **403**
  with a page "403 — Nemate pravo pristupa ovoj funkcionalnosti." and a way to
  the first allowed page; without the Dashboard a member starts on the first
  page they may open. (3) Every API route has its rule (`allow` in
  `src/crm/dispatch.ts`, the Follow-up API, the users API); widgets' data is
  removed from `/api/dashboard/summary` on the server. In Supabase, RLS on
  every CRM table asks for the module right (`private.current_user_org_ids_with_permission`).
* **Rights are read for every request**, never kept in the session cookie, so
  a revoked right or a deactivation applies to sessions already open.
  Deactivation and password changes also set a per-member session cut-off:
  every cookie issued until then is refused.
* **Passwords never in application tables.** Two identity back ends with one
  user service (`src/identity/user-service.ts`):
  * *local* (default, BETA server): members in the CRM store, credentials in a
    separate identity file (scrypt hashes, mode 0600). The first owner is the
    account from the server settings (`RENVARA_BETA_USERNAME/_PASSWORD`).
    New members get a one-time link (72 h; reset links 2 h) to set their own
    password; the token is in the address fragment (never in a server log) and
    only its SHA-256 is stored.
  * *supabase* (`RENVARA_IDENTITY=supabase`): Supabase Auth holds the
    credentials (invitation and reset e-mails, password changes, bans for
    deactivated members); members, rights and the log are in the database,
    written by `admin_*` functions that the server calls with the service role
    key. Those functions check the rules again and write each change with its
    log entry in one transaction. The service role key exists only on the
    server.
* **Re-authentication.** Changing someone else's password needs
  `users.change_password` **and** the administrator's own current password.
  The member is signed out everywhere and told at the next sign-in.
* **Administration log** (`auditLog` / `public.admin_audit_log`): who did what
  to whom, with the result (success / denied / failed) and the names of
  changed fields or rights — never passwords, tokens or values of personal
  data. Append-only in the database.
* **Personal data.** OIB and phone are not readable by teammates
  (column privileges in Supabase; not in the member list in the app).

**Consequences.** Each request does one extra lookup of the member (from the
CRM store, or one `admin_get_member` call in Supabase mode). The in-browser
demo uses the same service and API with the demo account as owner and no
passwords (it says so). In Supabase mode the CRM data itself is still in the
server's store until the CRM moves to PostgreSQL (see
docs/architecture/06-web-security-review.md); the RLS by right is in place for
that step. Session cut-offs are kept in a file on the server: with more than
one server instance they must move to shared storage.

**Alternatives considered.** Rights inside the signed session cookie: rejected,
a revoked right would last until the cookie expires. Roles only (no per-member
rights): rejected, the product owner wants rights per member and per widget.
A second, parallel password store in Supabase mode: rejected, Supabase Auth is
the only credential store there.
