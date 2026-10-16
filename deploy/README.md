# Renvara u cloudu (web aplikacija u pregledniku)

Cijela BETA Renvara na vlastitoj **https** adresi: prava prijava (provjera na
poslužitelju), podaci na poslužitelju, Follow-up Engine (PDF ponude i
poveznice za kupce), Mobilne obavijesti i push podsjetnici. Otvara se u
pregledniku na računalu i mobitelu; na iPhoneu se može dodati na početni
zaslon (Safari → Dijeli → Dodaj na početni zaslon) i tada prima push
obavijesti (iOS 16.4+).

Sve se pokreće kao jedan Docker kontejner (`apps/beta-web/Dockerfile`), a
podaci su na trajnom disku (`/data`). Dva načina:

| | A. Fly.io (preporučeno) | B. Vlastiti poslužitelj |
| --- | --- | --- |
| Što treba | račun na fly.io, `flyctl` | Linux poslužitelj s Dockerom, domena |
| Adresa | `https://<ime>.fly.dev` (bez domene) | `https://renvara.vasadomena.hr` |
| HTTPS | Fly | Caddy (certifikat sam dobiva i obnavlja) |
| Datoteke | `fly.toml` (korijen repozitorija) | `deploy/docker-compose.yml`, `deploy/Caddyfile` |

Oba načina se plaćaju kod pružatelja (mali poslužitelj i 1 GB diska); cijene
provjerite kod njih.

## Javna testna adresa bez poslužitelja (GitHub Pages)

Za testiranje bez računa i bez poslužitelja: Renvara u pregledniku na
`https://fgregov.github.io/web-prvi/` (s primjerima podataka; `/prazno/` prazni
početak, `/mobilni/` okvir mobitela). Podaci ostaju u pregledniku posjetitelja.
Uključuje se jednom, na GitHubu (vlasnik repozitorija):

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Dok se radi na grani `claude/renvara-technical-foundation-afyzr2`:
   **Settings → Environments → github-pages → Deployment branches and tags →
   Add → tu granu** (za granu `main` nije potrebno).
3. **Actions → Web test address → zadnje pokretanje → Re-run all jobs** (ili
   pričekajte sljedeću promjenu koda).

Svaka sljedeća promjena aplikacije objavljuje se sama.

## Postavke (tajne)

| Naziv | Što je |
| --- | --- |
| `RENVARA_BETA_USERNAME`, `RENVARA_BETA_PASSWORD` | Prvi vlasnik organizacije (provjerava se samo na poslužitelju); ostale korisnike dodajete u **Korisnici** |
| `RENVARA_BETA_EMAIL` | Neobavezno: vlasnik se može prijaviti i ovom e-mail adresom |
| `RENVARA_BETA_DISPLAY_NAME` | Ime u izborniku profila |
| `RENVARA_SESSION_SECRET` | Potpis prijave, najmanje 32 znaka: `openssl rand -base64 48` |
| `RENVARA_PUBLIC_ORIGIN` | Adresa koju otvarate, npr. `https://ime.fly.dev` (na vlastitom poslužitelju se postavlja sama iz `RENVARA_DOMAIN`) |
| `RENVARA_VAPID_PUBLIC_KEY`, `…_PRIVATE_KEY`, `…_SUBJECT` | Push obavijesti (neobavezno, sve tri ili nijedna); `…_SUBJECT` = `mailto:vaša@adresa` |
| `RENVARA_ORG_TIMEZONE` | Vremenska zona (zadano `Europe/Zagreb`) |

Tajne nikad ne idu u git ni u Docker sliku: na Fly.io su u `fly secrets`, na
vlastitom poslužitelju u `deploy/.env` (git ga ignorira).

Push ključeve napravite jednom (s Node.js-om na računalu):
`pnpm --filter @renvara/beta-web push:keys`; ili bez Node.js-a, kako piše niže.
Promjenom ključeva uređaji prestaju primati push dok ga na njima ponovno ne
uključite.

## A. Fly.io

1. Račun na [fly.io](https://fly.io), instalirajte `flyctl` i prijavite se:
   `fly auth login`.
2. U `fly.toml` promijenite `app = 'renvara-beta'` u svoje jedinstveno ime
   (dalje: `IME`). Regija `fra` je Frankfurt (EU).
3. U korijenu repozitorija:

   ```bash
   fly apps create IME
   fly volumes create renvara_data --region fra --size 1 -a IME --yes
   fly secrets set -a IME \
     RENVARA_BETA_USERNAME='vase-ime' \
     RENVARA_BETA_PASSWORD='jaka-lozinka' \
     RENVARA_BETA_DISPLAY_NAME='Ime Prezime' \
     RENVARA_SESSION_SECRET="$(openssl rand -base64 48)" \
     RENVARA_PUBLIC_ORIGIN='https://IME.fly.dev'
   fly deploy --ha=false
   ```

4. Otvorite `https://IME.fly.dev` i prijavite se.
5. Push (neobavezno):

   ```bash
   fly ssh console -a IME -C "node apps/beta-web/src/notifications/vapid-keys.ts"
   fly secrets set -a IME RENVARA_VAPID_PUBLIC_KEY=… RENVARA_VAPID_PRIVATE_KEY=… \
     RENVARA_VAPID_SUBJECT='mailto:vasa@adresa.hr'
   ```

Stroj je uvijek uključen (`auto_stop_machines = 'off'`) jer poslužitelj sam
šalje podsjetnike u zadano vrijeme. Zadržite **jedan** stroj (`--ha=false`):
podaci su jedna datoteka na jednom disku.

## B. Vlastiti poslužitelj (VPS)

1. Poslužitelj (npr. Ubuntu 24.04) s [Docker Engineom](https://docs.docker.com/engine/install/)
   i dodatkom `compose`; otvoreni portovi 80 i 443.
2. Kod pružatelja domene: zapis **A** (i AAAA ako ima IPv6) za npr.
   `renvara.vasadomena.hr` → IP poslužitelja.
3. Na poslužitelju:

   ```bash
   git clone https://github.com/fgregov/web-prvi.git renvara && cd renvara
   git checkout claude/renvara-technical-foundation-afyzr2
   cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
   nano deploy/.env        # RENVARA_DOMAIN, račun, RENVARA_SESSION_SECRET …
   docker compose -f deploy/docker-compose.yml up -d --build
   ```

4. Otvorite `https://renvara.vasadomena.hr` (prvo pokretanje čeka certifikat
   nekoliko sekundi).
5. Push (neobavezno): ključevi iz slike, upišite ih u `deploy/.env`, pa ponovno
   pokrenite:

   ```bash
   docker compose -f deploy/docker-compose.yml run --rm renvara node apps/beta-web/src/notifications/vapid-keys.ts
   docker compose -f deploy/docker-compose.yml up -d
   ```

## Isprobati na svom računalu (Docker)

```bash
docker build -f apps/beta-web/Dockerfile -t renvara-beta .
docker run --rm -p 3000:3000 -v renvara-local:/data \
  -e RENVARA_BETA_USERNAME='vase-ime' -e RENVARA_BETA_PASSWORD='lozinka' \
  -e RENVARA_SESSION_SECRET="$(openssl rand -base64 48)" \
  renvara-beta
```

Zatim otvorite `http://localhost:3000`. Slika radi u produkcijskom načinu
(kolačić prijave samo preko HTTPS-a; preglednici `localhost` smatraju
sigurnim). Na drugoj adresi bez HTTPS-a prijava ne uspijeva: zato u cloudu
uvijek ide jedan od dva načina gore.

## Nova verzija, kopija podataka

- **Nova verzija:** Fly.io: `fly deploy --ha=false`. Vlastiti poslužitelj:
  `git pull && docker compose -f deploy/docker-compose.yml up -d --build`.
  Podaci ostaju na disku.
- **Kopija podataka** (`/data`: `crm.json`, `identity.json` s korisničkim računima i PDF ponude):
  - Fly.io radi dnevne snimke diska (`fly volumes snapshots list -a IME`).
  - Vlastiti poslužitelj:

    ```bash
    docker run --rm -v renvara_renvara-data:/data:ro -v "$PWD":/backup alpine \
      tar czf /backup/renvara-$(date +%F).tgz -C /data .
    ```

## Što je dobro znati

- **Prazan početak.** Slika se gradi kao čista verzija (`RENVARA_EDITION=clean`):
  samo ono što unesete. `demo` počinje s demo podacima.
- **Jedan BETA račun, jedna organizacija**; podaci u jednoj datoteci, zato
  samo jedna instanca aplikacije. Supabase baza iz repozitorija još nije
  spojena na ovu verziju.
- **Iza proxyja.** `RENVARA_TRUST_PROXY=true` (već postavljeno) znači da je
  ispred aplikacije točno jedan proxy (Caddy ili Fly). Ako ispred stavite još
  jedan (npr. Cloudflare proxy), zaštita od pogađanja lozinke vidi adresu tog
  proxyja umjesto adrese korisnika.
- Prijava traje 8 sati i ostaje nakon ponovnog pokretanja poslužitelja.
- Usklađenost s GDPR-om ovisi o vašem korištenju i ugovoru s pružateljem
  (npr. regija EU); ova postavka sama po sebi to ne jamči.

Provjereno lokalno u Dockeru (slika, `docker-compose.yml` s Caddyjem i HTTPS-om
na `localhost`, trajnost podataka, prijava, ograničenje pogađanja lozinke po
korisniku); na samom Fly.io i na stvarnom VPS-u nije isprobano.
