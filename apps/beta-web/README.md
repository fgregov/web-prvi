# Renvara BETA web: authentication backtest

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

| Variable | Required | Purpose |
|---|---|---|
| `RENVARA_BETA_USERNAME` | yes | The one authorised username (case-sensitive) |
| `RENVARA_BETA_PASSWORD` | yes | Its password (case-sensitive, never trimmed) |
| `RENVARA_SESSION_SECRET` | yes | HMAC key for session cookies, 32+ characters |
| `RENVARA_BETA_DISPLAY_NAME` | no | Name shown in the dashboard account menu |
| `RENVARA_COOKIE_SECURE` | no | `true`/`false`. Defaults to `true` when `NODE_ENV=production` |
| `HOST`, `PORT` | no | Listen address. Defaults to `127.0.0.1:3000` |

`.env` files are git-ignored. Only `.env.example` (no values) is committed.

## Routes

| Route | Access | Behaviour |
|---|---|---|
| `GET /` | public | Redirects to `/dashboard` with a valid session, otherwise to `/login` |
| `GET /login` | public | The sign-in page. Redirects to `/dashboard` when already signed in |
| `POST /api/auth/login` | public | JSON `{username, password}` → `200 {success, redirectTo}` · `400` · `401` · `415` · `429` |
| `POST /api/auth/logout` | public | Revokes the session, clears the cookie → `200 {success, redirectTo: "/login"}` |
| `GET /api/auth/session` | public | `{authenticated, user?}`. Identity only |
| `GET /dashboard`, `/dashboard/*` | **session** | The approved dashboard (`prototypes/home`), served unchanged |

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

## Tests

```bash
pnpm --filter @renvara/beta-web test
```

`test/auth-core.test.ts` covers configuration, the credential check, input
parsing, tokens and the rate limiter. `test/auth-http.test.ts` starts a real
server and covers the 12 required cases plus CSRF, rate limiting, caching,
path traversal and logging. The tests generate a random password each run, so
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

## Migration to Supabase Auth

Routes and pages depend only on `AuthService` / `AuthProvider` /
`AuthSession` (`src/auth/types.ts`, `src/auth/service.ts`). To migrate:

1. Implement a Supabase-backed service in which `login` calls
   `signInWithPassword` and the session is Supabase's (for example, its cookie
   helpers).
2. Swap it in at `src/server.ts`. `requireAuth`, the routes, the login page and
   the dashboard stay the same.
3. Delete `beta-provider.ts` and the `RENVARA_BETA_*` variables.
