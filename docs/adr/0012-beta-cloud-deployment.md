# ADR-0012: The BETA web app in the cloud (one container, one volume, one proxy)

**Context.** The BETA web app (apps/beta-web) ran on a computer of the
product owner, reachable through a tunnel. It should run as a standalone
cloud application opened in a browser. The BETA keeps its records in one JSON
file, offer PDFs in a directory, sessions as signed cookies, and sends push
reminders from a scheduler inside the process. The Supabase schema
(ADR-0001/0002) is not connected to it yet.

**Decision.**
* One Docker image (`apps/beta-web/Dockerfile`): Node 22, production
  dependencies only, the TypeScript sources run directly, non-root user,
  `/data` volume for the JSON file and the PDFs, health check on `/login`.
  The edition is a build argument (`clean` by default: real use starts empty).
* Exactly **one** running instance with a persistent volume, always on (the
  scheduler must run to send reminders on time). No horizontal scaling.
* HTTPS terminates at **one** reverse proxy: Caddy (own server, Let's Encrypt,
  HSTS, `deploy/docker-compose.yml`) or the Fly.io proxy (`fly.toml`).
  `RENVARA_TRUST_PROXY=true` makes the failed-login limiter key on the last
  `X-Forwarded-For` entry, which that proxy appends; entries a client sends
  are ignored. Without a proxy the setting stays off (the socket address).
* Secrets only in the platform (`deploy/.env` on the server, `fly secrets`),
  never in the image or the repository; the image contains no `.env`.

**Consequences.** One command per platform deploys or updates the app; data
survives restarts and new versions on the volume. Backups are volume copies
(Fly snapshots, or a tar of the volume). Sessions survive restarts (signed
cookies); logout revocations are in memory, so after a restart a copied
session cookie stays valid until its 8-hour expiry. A second proxy in front
(e.g. a CDN) would make the limiter see that proxy's address. Moving to
Supabase (Postgres, Auth, Storage) removes the single-instance limit; the
container and proxy setup stay.

**Alternatives considered.** Serverless/scale-to-zero platforms (rejected: no
persistent disk for the JSON file, and the scheduler would not run while
idle). Trusting every `X-Forwarded-For` entry (rejected: a client could pick
its own address and escape the limiter).
