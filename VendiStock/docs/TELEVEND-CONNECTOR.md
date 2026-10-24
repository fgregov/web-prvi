# Televend Cloud Connector

Integracija s Televend Cloudom **bez javnog API-ja**: VendiStock se prijavljuje u korisnički web portal kroz izolirani
preglednik (Playwright/Chromium) na serveru, s korisničkim imenom i lozinkom koje unese administrator, i preuzima
podatke dostupne prijavljenom korisniku – prvenstveno kroz postojeće funkcije izvoza (CSV/XLSX).

## Status

| Što | Stanje |
|---|---|
| Mehanizam konektora (prijava, MFA/CAPTCHA detekcija, ručna sesija, istraživanje, izvoz, tablice, uvoz, sinkronizacija, ponavljanje) | izrađen i automatski testiran na **lokalnom testnom portalu** (`server/test/fixtures/mockPortal.ts`, izmišljena struktura) |
| Povezivanje sa **stvarnim** Televend Cloudom | **nije testirano** – razvojno okruženje nije imalo mrežni pristup domenama Televenda; adresa portala, struktura stranica i format izvoza nisu poznati |
| Dostupnost pojedinih podataka (automati, artikli, prodaja s datumom/vremenom, prihod po artiklu, prodaja po automatu, stanja u automatima, dopune) | **nije potvrđena** – utvrđuje se istraživanjem stvarnog portala |

Konektor zato **ne sadrži ugrađene URL-ove, HTML selektore, nazive stupaca ni identifikatore Televenda**. Sve što ovisi
o portalu konfigurira se nakon prijave, na temelju stvarnih stranica (Postavke → Izvori podataka).

## Tijek rada

```
Postavke → Televend Cloud                    Postavke → Izvori podataka               Planer (svakih 15 min)
┌────────────────────────────┐   uspjeh   ┌──────────────────────────────┐        ┌───────────────────────────┐
│ URL, korisnik, lozinka     │ ─────────► │ Istraži portal (samo čitanje) │ ─────► │ prijava (ili valjana sesija)
│ Testiraj povezivanje       │            │ izvor po skupu podataka:      │        │ za svaki uključeni izvor:  │
│  ├ ok → sesija (šifrirano) │            │  stranica, izvoz/tablica,     │        │  preuzmi → parsiraj →      │
│  ├ MFA/CAPTCHA → ručna     │            │  mapiranje stupaca            │        │  validiraj → uvezi (1 tx)  │
│  │   kontrolirana sesija   │            │ Testiraj izvor (bez uvoza)    │        │  → knjiži prodaju (opc.)   │
│  └ greška → poruka + koraci│            └──────────────────────────────┘        └───────────────────────────┘
└────────────────────────────┘
```

### 1. Prijava (`server/src/televend/login.ts`)

- Otvara se zadana adresa; u stranici (i iframeovima) traže se vidljivo polje lozinke, pripadajuće korisničko ime
  (autocomplete/naziv/položaj) i gumb za prijavu – generička heuristika, ne Televend selektori.
- Podržana je prijava u dva koraka (korisničko ime → lozinka).
- Ako heuristika ne odgovara, u naprednim postavkama unose se CSS selektori sa stvarne stranice i „indikator prijave”.
- Ishodi: `ok`, `already_logged_in`, `invalid_credentials` (s porukom portala), `mfa_required`, `captcha_required`,
  `form_not_found`, `uncertain`, `error`.
- **MFA i CAPTCHA se nikad ne zaobilaze.** Prijava se prekida, automatska sinkronizacija obustavlja, a korisnik
  koristi **ručnu kontroliranu sesiju**: preglednik radi na serveru, sučelje prikazuje njegov zaslon (snimka svakih 1,5 s),
  korisnik klikom i tipkanjem sam dovršava prijavu, a VendiStock sprema samo kolačiće sesije (šifrirano).
- Jedan pokušaj prijave po radnji; neuspjele prijave se ne ponavljaju automatski. Ručni testovi: najviše 1 u 30 s i 6 na sat.
  Nakon 2 uzastopne neuspjele prijave automatska sinkronizacija se obustavlja dok uspješan test ne potvrdi ispravke.

### 2. Istraživanje portala (`discovery.ts`)

Nakon prijave obilaze se poveznice iz izbornika (najviše 40 stranica, pauza 1 s, samo GET navigacija – nikakvi klikovi
na gumbe). Poveznice koje bi mogle mijenjati podatke ili odjaviti korisnika (odjava, brisanje, spremanje, reset…) se
preskaču. Za svaku stranicu bilježi se naslov, tablice (zaglavlja, broj redaka, selektor), gumbi/poveznice za izvoz
(CSV/XLSX/Excel/Izvoz/Preuzmi…) i polja za datum. Izvještaj se sprema i prikazuje; gumb „Koristi za odabrani izvor”
prenosi stranicu u konfiguraciju.

### 3. Izvori podataka (`config.ts`, `extract.ts`)

Za svaki skup podataka (automati, artikli, prodaja, stanja u automatima, dopune):

| Postavka | Opis |
|---|---|
| Stranica | putanja ili URL na domeni portala; predlošci `{from:FORMAT}` i `{to:FORMAT}` za razdoblje (npr. `{from:dd.MM.yyyy}`) |
| Način | **izvoz datoteke** (gumb prema tekstu/selektoru ili izravna poveznica na datoteku) – prednost; ili **čitanje tablice** (selektor, opcionalno „sljedeća stranica”) |
| Polja filtra | selektor + vrijednost (npr. razdoblje) i gumb „Prikaži” |
| Mapiranje stupaca | ciljno polje VendiStocka → naziv stupca iz stvarnog izvještaja |
| Format datuma, decimalni separator, redak zaglavlja | prazno = automatsko prepoznavanje |
| Vrijednosti storna, prag odbijenih redaka (%), artikli po automatu | kontrola kvalitete i tumačenja |

OCR se ne koristi; čitaju se strukturirani podaci (datoteke ili tekst tablica).

### 4. Parsiranje i uvoz (`parse.ts`, `mapping.ts`, `importers.ts`)

- CSV (UTF-8 s/bez BOM-a, UTF-16, **Windows-1250**; separator `;`, `,`, TAB ili `|` automatski) i XLSX (ExcelJS).
  Stari `.xls` i HTML „Excel” izvozi se odbijaju s jasnom porukom.
- Hrvatski formati brojeva (`1.234,56`) i datuma (`dd.MM.yyyy HH:mm:ss` i varijante). Vrijeme bez zone tumači se kao
  **Europe/Zagreb** (uključujući ljetno računanje vremena) i sprema u UTC uz lokalni datum za izvještaje.
  Vrijeme preuzimanja se nikad ne koristi kao vrijeme prodaje.
- **Kontrola nepotpunih izvještaja:** ako nedostaje mapirani stupac ili je udio neispravnih redaka veći od praga (zadano 5 %),
  cijeli izvještaj se odbija – ništa se ne upisuje (uvoz je jedna transakcija). Redci sažetka („Ukupno”) se preskaču.
- **Deduplikacija:** s ID-om transakcije ključ je `id:<ID>`; bez ID-a ključ je hash (automat, artikl, vrijeme, količina,
  iznos) + redni broj pojavljivanja istog sadržaja u izvještaju – dvije stvarne jednake prodaje u istoj sekundi ostaju
  dvije, a ponovni uvoz istog ili preklapajućeg razdoblja ne stvara duplikate.
- **Ispravci i storna:** promjena postojeće transakcije (isti ključ) bilježi se kao nova revizija s vrijednostima
  prije/poslije; status storna (konfigurabilne vrijednosti) označava transakciju kao poništenu.
- Svaki zapis nosi izvor (`televend_portal` / `manual_upload`), vrijeme preuzimanja, uvozni paket, referencu
  (datoteka#redak) i izvorni redak.
- Automati i artikli usklađuju se po ID-u i po nazivu (zapis nastao iz prodaje po nazivu nadograđuje se ID-om iz liste).

### 5. Sinkronizacija (`service.ts`, `scheduler/scheduler.ts`)

- Radi na backendu (planer svakih 20 s provjerava dospijeće) – i kad je preglednik VendiStocka zatvoren.
- Interval zadano 15 min (najmanje 15). Zaštita od preklapanja (jedna operacija s portalom u isto vrijeme).
- Razdoblje prodaje: od posljednjeg uspješno preuzetog dana minus preklapanje (zadano 2 dana) do danas; kod prve
  sinkronizacije zadano 30 dana unatrag. Datum „preuzeto zaključno s” pomiče se **samo nakon uspješnog uvoza**.
- Privremene greške (timeout, mreža, HTTP 5xx) ponavljaju se do 2 puta (30 s, 120 s). Greške prijave se ne ponavljaju.
- Pri pokretanju servera sinkronizacije koje su ostale „u tijeku” označavaju se kao **prekinute**; budući da je svaki uvoz
  transakcijski i razdoblje se pomiče tek nakon uspjeha, sljedeća sinkronizacija ponovno dohvaća isto razdoblje bez duplikata.
- Povijest sinkronizacija (Postavke) sadrži status, trajanje, pokušaje, broj zapisa i dnevnik koraka.

### 6. Knjiženje prodaje i dopune (`salesPosting.ts`, `refills.ts`)

- Uključuje se zadavanjem datuma početka (Postavke → Skladište i nabava). Prodaja povezanog artikla smanjuje zalihu
  **lokacije automata**, nikad centralnog skladišta. Svaka verzija transakcije knjiži se najviše jednom
  (`source_ref = sale:<id>:r<revizija>`, jedinstveno); storno/ispravak u Televendu stornira knjiženje.
- Dopune iz Televenda usklađuju se s lokalnim prijenosima u automat (povezivanje bez ponovnog knjiženja) ili se knjiže
  jednom kao novi prijenos (`source_ref = refill:<id>`), ili zanemaruju.

## Sigurnost konektora

- Lozinka: AES-256-GCM, glavni ključ zaštićen **Windows DPAPI-jem**; nikad se ne vraća pregledniku niti zapisuje u dnevnik.
- Kolačići sesije portala žive samo u backend pregledniku; spremaju se šifrirano (`televend.session`) i uklanjaju iz backupa.
- Provjera URL-a: samo HTTPS (port 443), bez korisničkih podataka u URL-u, bez IP adresa i lokalnih imena, DNS ne smije
  vraćati privatne/lokalne adrese, opcionalni popis `TELEVEND_ALLOWED_HOSTS`.
- U pregledniku: navigacije (uključujući **svaki korak preusmjeravanja**, provjeren prije slanja) dopuštene su samo na
  domenu portala i `TELEVEND_EXTRA_NAVIGATION_HOSTS`; zahtjevi prema lokalnim/privatnim adresama i ne-HTTPS protokolima
  se blokiraju i bilježe. Service workeri su isključeni; preuzimanja se brišu nakon obrade.
- Ručna sesija: dostupna samo administratoru, zatvara se nakon 10 min neaktivnosti, dopuštene su samo osnovne tipke.

## Što je potrebno za dovršetak (stvarni portal)

1. Pristup računalu s internetskom vezom prema portalu i važeći korisnički račun (već je u planu – server Vending Expressa).
2. „Testiraj povezivanje” → ako je ishod `form_not_found` ili `uncertain`, unijeti selektore/indikator prijave ili poslati
   HTML stranice za prijavu (bez lozinki).
3. „Istraži portal” i poslati izvještaj istraživanja (Postavke → Izvori podataka) ili snimke zaslona izbornika izvještaja.
4. Primjer izvezenog izvještaja prodaje (CSV/XLSX, može s izmijenjenim iznosima) za potvrdu mapiranja – može se učitati
   i kroz Postavke → Uvoz datoteke.
5. Provjeriti uvjete korištenja portala i preporučeni interval sinkronizacije (zadano 15 min) s Televendom/INTIS-om.
