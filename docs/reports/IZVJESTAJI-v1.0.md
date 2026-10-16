# RENVARA CRM — modul IZVJEŠTAJI v1.0

Tehnička dokumentacija: što je napravljeno, kako se računa, migracije,
konfiguracija i ograničenja. Odluka o arhitekturi: `docs/adr/0015-reports.md`.

## 1. Što korisnik dobiva

Stranica **`/reports`** (izbornik **Izvještaji**, pravo „Izvještaji — pregled,
PDF i preuzimanje”):

1. **VRSTA IZVJEŠTAJA**: Ukupni prihod za razdoblje · Promet po kvartalima ·
   WON / LOST analiza · Usporedba prodajnih predstavnika (zadnji samo uz pravo
   „usporedba prodajnih predstavnika”).
2. Filteri te vrste (razdoblje: tekući/prethodni mjesec, tekući/prethodni
   kvartal, tekuća godina, godina i kvartal, godina, prilagođeno od–do; kupac;
   prilika samo odabranog kupca; prodajni predstavnik; status; poredak).
3. Gumbi **GENERIRAJ IZVJEŠTAJ**, **PREGLED PDF-a** (pdf.js unutar aplikacije),
   **PREUZMI PDF**, **POŠALJI E-MAIL**, **RESETIRAJ FILTERE**. PDF i e-mail
   odnose se uvijek na generirani izvještaj; kad se filteri promijene, stranica
   traži ponovno generiranje (PDF tada ne bi odgovarao prikazu).
4. Prikaz: ključni pokazatelji, grafikoni, tablice, napomene; prazno stanje kad
   nema zaključenih prilika (0,00 € i N/P, nikad izmišljeni brojevi).
5. „Zadnja slanja e-mailom” (vlastita; vlasnik i administrator vide sva).

Filteri ostaju u adresi (`/reports?type=won_lost&preset=current_year`), pa se
izvještaj može ponovno otvoriti.

## 2. Pravila izračuna (jedinstvena za sva četiri izvještaja)

Jedan modul računa sve: `apps/beta-web/src/reports/report-engine.ts`. Svaki
izvještaj kreće od istih redaka — zaključenih prilika organizacije — i istih
pravila:

| Pravilo | Kako |
| --- | --- |
| Izvor | Prilike (Opportunities) organizacije prijavljenog korisnika; druga organizacija se nikad ne vidi |
| WON / LOST | **Trenutni** status prilike. Aktivne prilike nisu u izvještajima |
| Datum prihoda | `closedAt` — trenutak kad je prilika prešla u važeći WON (za LOST: datum zatvaranja). Postavlja se pri zatvaranju, briše pri ponovnom otvaranju; nikad se ne zaključuje iz `updatedAt` |
| Vrijednost WON | Konačni iznos (`wonValue`) ako je upisan pri zatvaranju, inače procijenjena vrijednost (`value`) — ista definicija kao Dashboard „Opportunity WON” (test ih uspoređuje) |
| Potencijal LOST | Procijenjena vrijednost izgubljene prilike — prikazuje se odvojeno i nikad kao prihod |
| Promjena WON → LOST/ACTIVE | Prilika se ponovno otvori (**Ponovno otvori**), pa po potrebi zatvori kao LOST; od tog trenutka nije u prihodu. Novo zaključenje računa se na novi datum |
| Vrijednost prilike | Procjena se upisuje pri kreiranju; pri zatvaranju kao WON može se upisati konačni iznos. Nakon zatvaranja iznos se ne mijenja (ponovno otvaranje briše konačni iznos) |
| Valuta i porez | EUR, hrvatski format (`12.500,00 €`); PDV se ne dodaje — iznosi su onakvi kako su upisani (model ne razlikuje neto/bruto). Prilika u drugoj valuti broji se, ali se ne zbraja (nema konverzije), i to piše u napomeni |
| Bez vrijednosti | Računa se kao 0,00 € i navodi se u napomeni |
| Zbrajanje | U cijelim centima (nema grešaka zaokruživanja) |
| WIN RATE / LOSS RATE | WON ÷ (WON + LOST) × 100, LOST ÷ (WON + LOST) × 100; bez zaključenih prilika **N/P** |
| Kvartali | Q1 1.1.–31.3., Q2 1.4.–30.6., Q3 1.7.–30.9., Q4 1.10.–31.12.; promjena prema prethodnom kvartalu (Q1 prema Q4 prethodne godine), **N/P** kad je prethodni 0,00 € |
| Vremenska zona | `Europe/Zagreb` (postavka organizacije `RENVARA_ORG_TIMEZONE`); razdoblje uključuje prvi i zadnji dan |
| Predstavnik | Odgovorni vlasnik prilike; prihod prilike pripada samo njemu (model nema raspodjelu). Prilike bez vlasnika: **NEDODIJELJENO**, uvijek u ukupnom zbroju |
| Tko se uspoređuje | Aktivni korisnici s ulogom Korisnik (prodaja) i svatko tko je odgovoran za zaključenu priliku u razdoblju |

Status filter u WON / LOST analizi sužava samo popis prilika; pokazatelji
(broj, stope, iznosi) uvijek obuhvaćaju i WON i LOST (inače bi WIN RATE bio
lažno 100 %).

## 3. Izmjene u kodu

**Server (`apps/beta-web/src/`)**

- `reports/report-engine.ts` — pravila i četiri izvještaja.
- `reports/report-api.ts` — API (prava, filteri, ograničenja, PDF, e-mail, dnevnik).
- `reports/report-routes.ts` — HTTP sloj (sesija, isti izvor, JSON, zaglavlja PDF-a).
- `reports/report-pdf.ts`, `reports/pdf/pdf-writer.ts`, `reports/pdf/truetype.ts` —
  vlastiti PDF generator (A4, ugrađen font Liberation Sans, grafikoni, prijelom
  tablica, numeracija stranica). `reports/node-pdf.ts` — fontovi i logo na serveru.
- `email/mailer.ts` — slanje preko Resend API-ja, stanje „nije konfigurirano”.
- `crm/opportunity-service.ts` — povijest statusa (`recordStatusChange`),
  ponovno otvaranje (`reopenOpportunity`), `statusHistory`.
- `crm/repository.ts` — nove zbirke `opportunityStatusChanges`, `reportEmails`;
  jednokratno: povijest starih prilika iz `createdAt`/`closedAt`
  (oznaka `backfill`) i nova prava izvještaja.
- `identity/user-service.ts` — `reportMembers` (ime, uloga, status; bez osobnih podataka).
- `app.ts`, `server.ts` — rute izvještaja, e-mail iz okruženja, CSP s pdf.js za `/reports`.

**Preglednik (`apps/beta-web/public/`)**

- `app/pages/reports.html`, `app/js/pages/reports.js`, `app/css/reports.css` — stranica.
- `app/js/core/reports.js` — vrste, razdoblja, provjera filtera i e-maila, formati
  (isti kod koristi i server).
- `app/js/core/permissions.js` — prava `reports.sales_reps`, `reports.email`;
  `reports.view` traži `opportunities.view`.
- Kartica prilike: datum zaključenja i **Ponovno otvori** za zatvorenu priliku.

**Ostalo**

- `demo/` — izvještaji rade i u demu u pregledniku (isti kod; e-mail se ne šalje).
- `apps/beta-web/scripts/dev.mjs` — `npm run dev` (prvo pokretanje, port 3000);
  `scripts/seed-demo.ts` — neobavezni demo podaci u zasebnim datotekama.
- `scripts/release-zip.mjs` — ZIP `RENVARA_CRM_REPORTS_v1.0.zip` (npm).

## 4. Supabase: migracija `20261018120000_reports.sql`

Samo dodaje (postojeće migracije nisu mijenjane):

| Objekt | Svrha | Sigurnost |
| --- | --- | --- |
| `private.permission_definitions` | + `reports.sales_reps` (nije zadano Korisniku), `reports.email`; `reports.view` traži `opportunities.view` | Članovi s `reports.view` dobivaju `reports.email`, administratori `reports.sales_reps` |
| `public.opportunity_status_history` | Svaka promjena statusa prilike (od, do, iznos, valuta, vlasnik, vrijeme, tko) | Upisuje okidač; samo čitanje uz `opportunities.view` (RLS); nema promjena (append-only) |
| okidač `opportunities_status_history` | Upis pri kreiranju i svakoj promjeni statusa | `security definer`, `search_path = ''` |
| backfill | Postojeće prilike: početni status (`created_at`) i zatvaranje (`closed_at`), oznaka `backfill` | — |
| `public.report_email_log` | Slanja e-mailom: tko, kome, izvještaj, razdoblje, privitak, poslano/neuspjelo | Upisuje samo server (service role); član vidi svoja, vlasnik i administrator sva; append-only |
| `public.report_closed_opportunities` (view) | Kanonski redci izvještaja (status, datum u vremenskoj zoni organizacije, prihod/potencijal) | `security_invoker` (RLS prilika) + `reports.view` i `opportunities.view` |
| `public.report_outcome_totals(org, od, do)` | WON/LOST brojevi, EUR zbrojevi, stope (null = N/P) | Prava pozivatelja |

pgTAP: `supabase/tests/database/13_reports.test.sql` (38 provjera); `12_user_management`
usklađen s katalogom od 40 prava. Tipovi: `packages/database/src/database.types.ts`.

Napomena: u ovoj fazi CRM podaci (i kad se korisnici vode u Supabaseu) žive u
podatkovnoj datoteci servera (ADR-0014); izvještaji ih čitaju odande.
Migracija priprema iste definicije za prelazak CRM-a u PostgreSQL.

## 5. Konfiguracija

| Varijabla (`apps/beta-web/.env`) | Obavezno | Svrha |
| --- | --- | --- |
| `RENVARA_BETA_USERNAME`, `RENVARA_BETA_PASSWORD_HASH` (ili `…_PASSWORD`), `RENVARA_SESSION_SECRET` | da | Vlasnik i sesije (`npm run dev` ih postavi pri prvom pokretanju) |
| `PORT`, `HOST` | ne | Zadano `3000`, `127.0.0.1` |
| `RENVARA_ORG_TIMEZONE` | ne | Zadano `Europe/Zagreb` (kalendarski dani i kvartali izvještaja) |
| `RESEND_API_KEY` | za e-mail | API ključ Resenda (samo na serveru) |
| `RENVARA_EMAIL_FROM` | za e-mail | Pošiljatelj, npr. `RENVARA CRM <izvjestaji@vasa-domena.hr>` (domena potvrđena u Resendu) |
| `RENVARA_EMAIL_REPLY_TO` | ne | Adresa za odgovore |
| `RENVARA_IDENTITY=supabase`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RENVARA_BETA_ORG_ID` | ne | Korisnici u Supabaseu (ADR-0014) |

Prava (Korisnici → korisnik → Prava pristupa → Dodatne funkcije):
„Izvještaji — pregled, PDF i preuzimanje”, „Izvještaji — usporedba prodajnih
predstavnika”, „Izvještaji — slanje e-mailom”.

## 6. Sigurnost

- Svaki izvještaj, PDF i slanje provjeravaju se na serveru (403 bez prava); skriveni
  gumb nije zaštita. Organizacija dolazi iz sesije; poslani `organizationId` se ignorira.
- Filteri se čitaju na serveru; kupac, prilika i predstavnik moraju postojati u organizaciji.
- PDF i e-mail rade se na serveru iz istih filtera — preglednik ne šalje brojeve ni PDF.
- E-mail: ključ samo u okruženju servera; adresa i predmet provjereni (bez novih redaka);
  naziv privitka očišćen; jedan zahtjev = najviše jedan e-mail (ID zahtjeva + idempotency
  ključ servisa); 10 slanja / 10 min po korisniku, 200 dnevno po organizaciji.
- Dnevnik slanja bez teksta poruke i PDF-a; serverski log bez adresa i ključeva.
- Ograničenja: 60 izvještaja/PDF-ova u minuti po korisniku, najviše 1.100 dana i 5.000
  zaključenih prilika po izvještaju, PDF za e-mail najviše 15 MB.
- PDF odgovori: `no-store`, `Content-Security-Policy: default-src 'none'; sandbox`.

## 7. Testiranje (provedeno)

| Što | Rezultat |
| --- | --- |
| Unit testovi (vitest) `test/reports.test.ts`: pravila, kvartali, N/P, valute, NEDODIJELJENO, usporedba s Dashboardom, filteri, povijest statusa, PDF (pdf.js čita tekst, A4, više stranica), Resend, API prava/ograničenja/greške | 25/25 |
| Cijeli `pnpm check` (format, typecheck, svi testovi) | 358 + 48 prolazi |
| pgTAP (svih 13 datoteka) | 320/320 |
| Supabase integracija (Korisnici) | 7/7 |
| E2E na serveru: scenarij iz specifikacije (kupac → prilika 2.500 € → WON → izvještaji; WON → ponovno otvorena → LOST), PDF pregled i preuzimanje, e-mail (poslano, dvostruki klik, neuspjeh, odbijeno, ograničenje), prava, mobitel | 72/72 |
| E2E prazna baza + e-mail nije konfiguriran | 17/17 |
| Demo u pregledniku (izvještaj, PDF u stranici, preuzimanje, e-mail se ne šalje) | 8/8 |
| Regresija postojećih E2E paketa (Korisnici, navigacija, prilike, zadaci, leadovi, follow-up …) | sve zeleno |

Stvarno slanje preko Resenda nije izvedeno (nema API ključa u testnom
okruženju): slanje je provjereno na lokalnoj zamjeni Resend API-ja (isti
zahtjev: zaglavlje s ključem, privitak base64, idempotency ključ).

## 8. Ograničenja i što traži dodatnu konfiguraciju

- **E-mail** traži Resend račun, API ključ i potvrđenu domenu pošiljatelja
  (`RESEND_API_KEY`, `RENVARA_EMAIL_FROM`). Drugi servisi (SMTP i sl.) nisu u v1.0.
- **Iznosi su samo u EUR**; druge valute se ne konvertiraju.
- **Prihod = vrijednost zaključenih prilika**, ne naplaćeni (računovodstveni) prihod; PDV
  se ne dodaje, model ne razlikuje neto i bruto.
- **Raspodjela prihoda** na više predstavnika ne postoji (model ima jednog vlasnika prilike).
- **Povijest statusa** postoji od ove verzije; za starije prilike rekonstruirana je iz
  datuma kreiranja i zatvaranja (bez međukoraka kojih nije bilo zabilježeno).
- **CRM podaci** u ovoj fazi su u podatkovnoj datoteci servera; SQL pogled i funkcija u
  Supabaseu pripremljeni su za prelazak CRM-a u PostgreSQL.
- Ograničenja broja zahtjeva i memorija ID-jeva slanja vrijede po procesu (jedan server).
- PDF ima oko 200 KB (dva ugrađena fonta).
- Nisu u v1.0 (sljedeće verzije): dodatni izvještaji, automatsko/periodično slanje,
  napredna analitika, izvoz u Excel.
