# RENVARA CRM — pokretanje na vašem računalu (localhost:3000)

Ovo je cijeli projekt RENVARA CRM (web aplikacija, server, modul IZVJEŠTAJI,
Supabase migracije i testovi). Pokreće se u terminalu s dvije naredbe.

## 1. Što treba

- **Node.js 22.18 ili noviji** (preporuka: 22 LTS ili 24 LTS, https://nodejs.org).
  Provjera: `node -v`.
- Internetska veza za `npm install` (jednom).

## 2. Pokretanje

U mapi projekta (gdje je `package.json`):

```bash
npm install
npm run dev
```

**Prvo pokretanje** pita podatke vlasnika aplikacije: ime i prezime, korisničko
ime, e-mail (neobavezno) i lozinku (najmanje 12 znakova, slova i brojke; ne
prikazuje se dok tipkate). Zapisuju se u `apps/beta-web/.env` — lozinka samo
kao scrypt hash, nikad kao tekst. Ta datoteka ostaje na vašem računalu.

Zatim se server pokreće na **http://localhost:3000**:

```
[renvara-beta] Listening on http://localhost:3000 (…, report e-mail: off)
```

Otvorite http://localhost:3000, prijavite se, u izborniku odaberite
**Izvještaji**. Zaustavljanje: `Ctrl+C`. Sljedeći put samo `npm run dev`.

- Port je `PORT` iz `apps/beta-web/.env` (zadano 3000). Ako je zauzet, `npm run dev`
  to jasno javi (ne prelazi tiho na drugi port).
- Podaci: `apps/beta-web/.data/` (kupci, prilike, korisnici, PDF ponude).
  Sigurnosna kopija: zaustavite server i kopirajte tu mapu.
- `npm run dev` ponovno pokreće server kad promijenite kod.

## 3. Prazan početak i DEMO podaci (neobavezno)

Nova instalacija počinje **prazna** — izvještaji prikazuju 0,00 € i N/P dok ne
unesete i zaključite prilike. Za isprobavanje postoje neobavezni demo podaci,
**u zasebnim datotekama** (`apps/beta-web/.data/demo/`), nikad pomiješani s
vašim podacima:

```bash
npm run dev:demo        # server na demo podacima (stvori ih prvi put)
npm run seed:demo       # samo stvori demo podatke (postojeće ne dira; --force ih obnavlja)
```

## 4. E-mail (Izvještaji → POŠALJI E-MAIL)

Slanje ide preko e-mail servisa **Resend** (https://resend.com), samo sa servera.
U `apps/beta-web/.env` dodajte:

```
RESEND_API_KEY=re_...
RENVARA_EMAIL_FROM="RENVARA CRM <izvjestaji@vasa-domena.hr>"
# neobavezno: RENVARA_EMAIL_REPLY_TO=prodaja@vasa-domena.hr
```

U Resendu napravite API ključ i potvrdite domenu pošiljatelja. Ponovno
pokrenite `npm run dev` (u ispisu piše `report e-mail: resend`).

Bez tih postavki aplikacija radi normalno, a POŠALJI E-MAIL jasno kaže da
slanje nije konfigurirano — nikad ne prikazuje lažnu potvrdu. Izvještaj se
tada može preuzeti kao PDF i poslati ručno.

## 5. Supabase (neobavezno)

Migracije su u `supabase/migrations/` (nova: `20261018120000_reports.sql`).
Lokalno, uz Docker:

```bash
npm run db:start        # lokalni Supabase (Docker)
npm run db:reset        # primijeni sve migracije
npm run db:test         # pgTAP testovi (RLS, prava, izvještaji)
```

Korisnici preko Supabase Autha: u `.env` postavite `RENVARA_IDENTITY=supabase`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` i
`RENVARA_BETA_ORG_ID` (uuid organizacije) — vidi `apps/beta-web/.env.example`
i `apps/beta-web/README.md` (Korisnici). Ključ service role ostaje samo na
serveru.

## 6. Testovi

```bash
npm test                # automatizirani testovi (vitest): izračuni, PDF, e-mail, prava, API
npm run typecheck
```

## 7. Dokumentacija

- `docs/reports/IZVJESTAJI-v1.0.md` — modul IZVJEŠTAJI: izmjene, pravila
  izračuna, migracije, konfiguracija, ograničenja
- `docs/adr/0015-reports.md` — odluka o arhitekturi izvještaja
- `apps/beta-web/README.md` — server, rute, API, sve postavke
- `apps/beta-web/.env.example` — sve varijable okruženja (bez stvarnih vrijednosti)

Repozitorij inače koristi pnpm (`pnpm install`, `pnpm dev`); ovaj ZIP je isti
projekt pripremljen za npm (`package-lock.json`).
