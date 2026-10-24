# Arhitektura VendiStocka

## Pregled

```
 Preglednik (LAN)                       Windows server (Windows servis „VendiStock”)
┌───────────────────┐  HTTPS (TLS 1.2+) ┌──────────────────────────────────────────────────────────────┐
│ React SPA         │ ────────────────► │ Fastify (Node.js)                                            │
│ (Vite build)      │  kolačić sesije   │  ├ sigurnost: IP filtar (LAN), helmet/CSP, rate limit,        │
│ TanStack Query    │  + X-CSRF-Token   │  │  sesije (httpOnly, SameSite=Strict), CSRF, uloge, Zod       │
└───────────────────┘                   │  ├ REST API (/api/*) + statički klijent (client/dist)         │
                                        │  ├ servisi: skladišna knjiga, artikli, nabava, upozorenja,    │
                                        │  │  e-mail, analitika, izvozi (XLSX/PDF), backup, normativi    │
                                        │  ├ Televend konektor (Playwright/Chromium, headless)  ───────────► Televend Cloud
                                        │  ├ planer: sinkronizacija, backup, upozorenja, e-mail          │    (korisnički portal)
                                        │  └ SQLite (WAL) + šifrirane tajne (AES-256-GCM, DPAPI ključ)  ─────► SMTP
                                        └──────────────────────────────────────────────────────────────┘
```

Jedan proces (Node.js) poslužuje API i sučelje, izvodi pozadinske poslove i konektor. Baza je jedna SQLite datoteka
(`data/vendistock.db`) u WAL načinu. Nema vanjskih servisa osim Televend portala (preuzimanje) i SMTP-a (slanje).

## Model podataka (najvažnije tablice)

| Tablica | Namjena |
|---|---|
| `users`, `sessions`, `audit_log` | korisnici VendiStocka, sesije (SHA-256 tokena), revizijski zapis |
| `settings`, `secrets` | postavke (JSON) i šifrirane tajne |
| `products`, `categories`, `suppliers` | artikli i šifrarnici |
| `locations` | centralno skladište, vozila, automati, ostalo |
| `stock_movements` | zaglavlje skladišnog dokumenta (broj, vrsta, datum, izvor, veze storna/ispravka) |
| `stock_ledger` | **skladišna knjiga** – pojedinačna kretanja (artikl, lokacija, ±količina, stanje nakon) |
| `stock_balances` | materijalizirano trenutačno stanje (ažurira se u istoj transakciji) |
| `stock_reservations`, `inventory_counts(_lines)` | rezervacije, inventure |
| `machines`, `tv_products`, `product_televend_links` | automati, Televend artikli, ručno povezivanje s lokalnim artiklima |
| `sales_transactions`, `sales_transaction_revisions` | prodaja (dedupe ključ, izvor, vrijeme preuzimanja, revizije) |
| `tv_machine_stock`, `tv_refills` | stanja u automatima i dopune iz Televenda |
| `sync_runs`, `import_batches`, `televend_discovery_reports` | povijest sinkronizacija, uvoza i istraživanja |
| `purchase_orders(_lines)` | narudžbe dobavljačima |
| `stock_alert_state`, `stock_alert_events`, `email_log` | stanje upozorenja, događaji, poslani e-mailovi |
| `recipes`, `recipe_ingredients` | normativi (priprema) |

Migracije su u `server/src/db/schema.ts` i izvršavaju se automatski pri pokretanju (verzija u `schema_migrations`).

## Skladišna knjiga

Sve promjene zaliha idu isključivo kroz `postMovement()` (`server/src/modules/inventory/ledger.ts`):

1. U jednoj transakciji: zaglavlje dokumenta + stavke knjige + ažuriranje `stock_balances` + procjena upozorenja + revizijski zapis.
2. Stanje lokacije ne smije pasti ispod nule (osim lokacije automata pri knjiženju prodaje iz Televenda, jer stanje
   automata nije uvijek poznato).
3. `source_ref` je jedinstven – isti vanjski događaj (prodaja, dopuna) ne može se proknjižiti dvaput.
4. Dokumenti se ne mijenjaju: **storno** knjiži suprotne stavke (jedan storno po dokumentu), **ispravak** = storno +
   novi dokument povezan s originalom; izmjena napomene/broja dokumenta bilježi vrijednosti prije/poslije.
5. Prijenos: `−q` na izvoru i `+q` na odredištu (zbroj 0). Izlaz u vozilo/automat je prijenos iz centralnog skladišta;
   izlaz „ostalo” je trajni izlaz.
6. Provjera integriteta (`verifyLedgerIntegrity`): stanje = zbroj knjige, kontinuitet „stanja nakon knjiženja”.

## Nabava i upozorenja

- `Preporuka = MAX(0, ciljana − (centralno − rezervirano) − otvorene narudžbe)`, opcionalno zaokruženo na cijela pakiranja.
  Otvorene narudžbe = naručeno − zaprimljeno za narudžbe u statusu „naručeno” ili „djelomično”.
- Automat stanja upozorenja po artiklu (`stock_alert_state`): događaj `entered_low` samo pri prijelazu ispod minimuma,
  `recovered` kad raspoloživa zaliha dosegne minimum. Planer objedinjava nove događaje u jednu poruku (zadano 60 s),
  preskače artikle koji su se u međuvremenu oporavili; događaj se veže na zapis poruke prije slanja, a ponovni pokušaji
  koriste isti zapis (najviše 3) – nema dupliciranih poruka.

## Vrijeme

Sva vremena spremaju se u UTC (ISO 8601). Datumi dokumenata i izvještaji koriste **Europe/Zagreb**
(`sold_date_local`, `sold_month_local`); vremena iz izvještaja bez oznake zone tumače se kao Europe/Zagreb (luxon).

## Konfiguracija pokretanja

`server/src/index.ts` učitava `.env` i postavlja mapu preglednika (`VendiStock/browsers`) prije učitavanja
Playwrighta, zatim `main.ts` stvara kontekst (baza, migracije, ključ), označava prekinute sinkronizacije,
pokreće HTTP(S) server i planer.
