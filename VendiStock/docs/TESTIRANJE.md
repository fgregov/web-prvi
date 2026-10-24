# Testiranje

Rezultati **stvarno izvršenih** testova u razvojnom okruženju (Linux, Node.js 22.22.0, Chromium 153, Playwright 1.63).

```
npm test            → Test Files 7 passed (7) · Tests 86 passed (86)
npm run test:e2e    → Tests 1 passed (1)
```

## Skladište (skladišna knjiga) — `server/test/inventory.test.ts` (14 testova, svi prolaze)

- ✓ Izračun stanja skladišta i ulaz/izlaz robe > ulaz robe povećava stanje centralnog skladišta i bilježi kretanje u knjizi
- ✓ Izračun stanja skladišta i ulaz/izlaz robe > izlaz u vozilo smanjuje centralno i povećava vozilo (ukupna količina ista)
- ✓ Izračun stanja skladišta i ulaz/izlaz robe > izlaz „ostalo” trajno smanjuje zalihu
- ✓ Izračun stanja skladišta i ulaz/izlaz robe > ne dopušta izlaz veći od stanja (nema negativnog stanja centralnog skladišta)
- ✓ Izračun stanja skladišta i ulaz/izlaz robe > decimalne količine (kg) bez greške zaokruživanja
- ✓ Interni prijenosi > centralno → vozilo → automat: ukupna količina se ne mijenja
- ✓ Interni prijenosi > ne dopušta prijenos na istu lokaciju niti prijenos veći od stanja vozila
- ✓ Storno, ispravak i revizijski trag > storno vraća stanje, original ostaje, dvostruki storno nije moguć
- ✓ Storno, ispravak i revizijski trag > storno ulaza nije moguć ako je roba već izdana (stanje bi otišlo u minus)
- ✓ Storno, ispravak i revizijski trag > ispravak = storno + novi dokument povezan s originalom
- ✓ Inventura i početno stanje > inventura knjiži razliku prebrojano − knjigovodstveno
- ✓ Inventura i početno stanje > početno stanje samo za artikl bez kretanja na lokaciji
- ✓ Integritet knjige i rezervacije > stanja uvijek odgovaraju zbroju knjige
- ✓ Integritet knjige i rezervacije > rezervacija umanjuje raspoloživu zalihu

## Uvoz prodaje, deduplikacija, vremenska zona, knjiženje prodaje, analitika — `server/test/sales-import.test.ts` (19 testova, svi prolaze)

- ✓ Uvoz ponovljenih Televend transakcija (deduplikacija) > isti izvještaj uvezen dvaput ne stvara duplikate (ID transakcije)
- ✓ Uvoz ponovljenih Televend transakcija (deduplikacija) > preklapajuća razdoblja bez ID-a: dvije stvarne jednake prodaje ostaju dvije, ponovni uvoz ne dodaje nove
- ✓ Uvoz ponovljenih Televend transakcija (deduplikacija) > storno u izvoru (status) ažurira postojeću transakciju i bilježi reviziju
- ✓ Uvoz ponovljenih Televend transakcija (deduplikacija) > ispravak količine u izvoru (isti ID) mijenja zapis umjesto dodavanja novog
- ✓ Kontrola nepotpunih izvještaja > odbija izvještaj kojem nedostaje mapirani stupac – ništa se ne upisuje
- ✓ Kontrola nepotpunih izvještaja > odbija izvještaj s previše neispravnih redaka (oštećen/odrezan izvoz)
- ✓ Kontrola nepotpunih izvještaja > pojedinačni neispravan redak ispod praga se preskače i evidentira
- ✓ Kontrola nepotpunih izvještaja > preskače retke sažetka (Ukupno)
- ✓ Vremenska zona i formati > lokalno vrijeme Europe/Zagreb pretvara se u UTC (zimsko/ljetno računanje)
- ✓ Vremenska zona i formati > vrijeme preuzimanja se ne koristi kao vrijeme prodaje; zapis nosi izvor i referencu
- ✓ Vremenska zona i formati > CSV u Windows-1250 kodiranju s hrvatskim znakovima i decimalnim zarezom
- ✓ Vremenska zona i formati > XLSX izvoz s datumskim ćelijama
- ✓ Vremenska zona i formati > odbija HTML stranicu poslanu umjesto izvoza
- ✓ Sprječavanje dvostrukog skidanja zaliha (prodaja → automat) > knjiženje je isključeno dok nije zadan datum početka
- ✓ Sprječavanje dvostrukog skidanja zaliha (prodaja → automat) > prodaja smanjuje automat, NE centralno skladište; ponovno knjiženje ne skida ponovno
- ✓ Sprječavanje dvostrukog skidanja zaliha (prodaja → automat) > storno u Televendu stornira knjiženje (zaliha automata se vraća)
- ✓ Sprječavanje dvostrukog skidanja zaliha (prodaja → automat) > jedinstveni source_ref onemogućuje dvostruko knjiženje iste verzije transakcije
- ✓ Sprječavanje dvostrukog skidanja zaliha (prodaja → automat) > TOP artikli po količini (primarno) i prihodu (zasebno)
- ✓ Sprječavanje dvostrukog skidanja zaliha (prodaja → automat) > svi analitički izvještaji (automati, kategorije, dnevno/mjesečno, najmanja prodaja, usporedba)

## Nabava, upozorenja i e-mail — `server/test/procurement-alerts.test.ts` (15 testova, svi prolaze)

- ✓ Izračun preporučene nabave > primjer iz specifikacije: cilj 250, stanje 70, otvoreno 0 → 180
- ✓ Izračun preporučene nabave > MAX(0, …): nikad negativno
- ✓ Izračun preporučene nabave > zaokruživanje na cijela pakiranja (prema gore)
- ✓ Izračun preporučene nabave > otvorene narudžbe i rezervacije ulaze u formulu
- ✓ Izračun preporučene nabave > narudžbe iz preporuka grupiraju se po dobavljaču
- ✓ Aktivacija i resetiranje upozorenja; sprječavanje dupliciranih e-mailova > prvi pad ispod minimuma stvara JEDNO upozorenje; daljnji padovi ne stvaraju nova
- ✓ Aktivacija i resetiranje upozorenja; sprječavanje dupliciranih e-mailova > povratak na minimum resetira stanje; sljedeći pad stvara novo upozorenje
- ✓ Aktivacija i resetiranje upozorenja; sprječavanje dupliciranih e-mailova > artikl koji se oporavi prije slanja ne dobiva upozorenje (objedinjavanje)
- ✓ Aktivacija i resetiranje upozorenja; sprječavanje dupliciranih e-mailova > više artikala u jednoj poruci
- ✓ Aktivacija i resetiranje upozorenja; sprječavanje dupliciranih e-mailova > neuspjelo slanje se ponavlja na istom zapisu – bez duplikata nakon uspjeha
- ✓ Aktivacija i resetiranje upozorenja; sprječavanje dupliciranih e-mailova > bez konfiguriranog e-maila upozorenje se evidentira, ali se ne šalje kasnije „zastarjelo”
- ✓ Aktivacija i resetiranje upozorenja; sprječavanje dupliciranih e-mailova > promjena minimuma na kartici artikla aktivira upozorenje
- ✓ Aktivacija i resetiranje upozorenja; sprječavanje dupliciranih e-mailova > rezervacija može aktivirati, a otpuštanje resetirati upozorenje
- ✓ Aktivacija i resetiranje upozorenja; sprječavanje dupliciranih e-mailova > dnevni podsjetnik šalje se najviše jednom dnevno
- ✓ Aktivacija i resetiranje upozorenja; sprječavanje dupliciranih e-mailova > sadržaj e-maila prema predlošku (HTML escaping)

## Televend konektor (lokalni testni portal) — `server/test/connector.test.ts` (14 testova, svi prolaze)

- ✓ Prijava u portal (heuristika obrasca, bez zaobilaženja zaštite) > uspješna prijava sprema šifriranu sesiju i status „Povezano”
- ✓ Prijava u portal (heuristika obrasca, bez zaobilaženja zaštite) > pogrešna lozinka: jedan pokušaj, bez automatskog ponavljanja; nakon 2 neuspjeha obustava automatske sinkronizacije
- ✓ Prijava u portal (heuristika obrasca, bez zaobilaženja zaštite) > MFA se prepoznaje i ne zaobilazi; ručna kontrolirana sesija dovršava prijavu
- ✓ Prijava u portal (heuristika obrasca, bez zaobilaženja zaštite) > CAPTCHA se prepoznaje – automatska prijava se ne pokušava
- ✓ Prijava u portal (heuristika obrasca, bez zaobilaženja zaštite) > prijava u dva koraka (korisničko ime → lozinka)
- ✓ Prijava u portal (heuristika obrasca, bez zaobilaženja zaštite) > stranica bez obrasca za prijavu → jasna poruka, bez pogađanja
- ✓ Prijava u portal (heuristika obrasca, bez zaobilaženja zaštite) > preusmjeravanje na nedopuštenu domenu se blokira
- ✓ Istraživanje portala > pronalazi stranice, tablice i izvoze; preskače poveznice koje mijenjaju podatke
- ✓ Sinkronizacija: preuzimanje, uvoz, duplikati, ponavljanje i prekid > bez konfiguriranih izvora sinkronizacija se preskače uz objašnjenje (ništa se ne pretpostavlja)
- ✓ Sinkronizacija: preuzimanje, uvoz, duplikati, ponavljanje i prekid > preuzima CSV izvoz i tablicu s paginacijom; ponovljena sinkronizacija ne stvara duplikate
- ✓ Sinkronizacija: preuzimanje, uvoz, duplikati, ponavljanje i prekid > privremena greška (HTTP 500) se sigurno ponavlja
- ✓ Sinkronizacija: preuzimanje, uvoz, duplikati, ponavljanje i prekid > trajna greška: neuspjela sinkronizacija se evidentira, razdoblje prodaje se ne pomiče
- ✓ Sinkronizacija: preuzimanje, uvoz, duplikati, ponavljanje i prekid > prekid sinkronizacije: zapis „u tijeku” se pri ponovnom pokretanju označava kao prekinut
- ✓ Sinkronizacija: preuzimanje, uvoz, duplikati, ponavljanje i prekid > istodobne sinkronizacije nisu moguće (zaštita od preklapanja)

## Sigurnost — `server/test/security.test.ts` (18 testova, svi prolaze)

- ✓ Lozinke korisnika VendiStocka > scrypt hash, provjera i jačina lozinke
- ✓ Šifrirana pohrana tajni > AES-GCM: dešifriranje, zaštita od izmjene i vezanje uz naziv tajne
- ✓ Šifrirana pohrana tajni > novi ključ čini stare tajne nečitljivima; ključ iz datoteke se ponovno učitava
- ✓ Šifrirana pohrana tajni > DPAPI: ključ se zaštićuje/otključava PowerShellom, a tajna se šalje samo kroz stdin
- ✓ Provjera URL-a Televend portala (zlouporaba korisnički unesene adrese) > odbija nesiguran protokol, IP adrese, lokalne adrese i vjerodajnice u URL-u
- ✓ Provjera URL-a Televend portala (zlouporaba korisnički unesene adrese) > popis dopuštenih domena iz konfiguracije servera
- ✓ Provjera URL-a Televend portala (zlouporaba korisnički unesene adrese) > preglednik blokira navigaciju na druge domene i zahtjeve prema lokalnoj mreži
- ✓ API: autentifikacija, CSRF, uloge, mrežno ograničenje > zaštićene rute traže prijavu
- ✓ API: autentifikacija, CSRF, uloge, mrežno ograničenje > prijava postavlja httpOnly SameSite=Strict kolačić; pogrešna lozinka ne otkriva postoji li korisnik
- ✓ API: autentifikacija, CSRF, uloge, mrežno ograničenje > promjene podataka zahtijevaju CSRF token i ispravan Origin
- ✓ API: autentifikacija, CSRF, uloge, mrežno ograničenje > uloga „pregled” ne može mijenjati podatke ni pristupiti administraciji
- ✓ API: autentifikacija, CSRF, uloge, mrežno ograničenje > API nikad ne vraća spremljene lozinke
- ✓ API: autentifikacija, CSRF, uloge, mrežno ograničenje > zaključavanje računa nakon 5 neuspjelih prijava
- ✓ API: autentifikacija, CSRF, uloge, mrežno ograničenje > ograničenje broja pokušaja prijave po IP adresi (rate limiting)
- ✓ API: autentifikacija, CSRF, uloge, mrežno ograničenje > pristup izvan lokalne mreže je odbijen
- ✓ API: autentifikacija, CSRF, uloge, mrežno ograničenje > početni administrator samo s računala servera (localhost)
- ✓ API: autentifikacija, CSRF, uloge, mrežno ograničenje > validacija unosa (Zod) vraća poruku na hrvatskom; SQL znakovi se tretiraju kao podatak
- ✓ API: autentifikacija, CSRF, uloge, mrežno ograničenje > sigurnosna zaglavlja (CSP, X-Frame, nosniff)

## Backup i oporavak — `server/test/backup.test.ts` (5 testova, svi prolaze)

- ✓ Sigurnosne kopije i vraćanje > konzistentna kopija tijekom rada, s manifestom i kontrolnim zbrojem; bez sesije portala
- ✓ Sigurnosne kopije i vraćanje > validacija odbija izmijenjenu ili oštećenu kopiju
- ✓ Sigurnosne kopije i vraćanje > vraćanje: prethodno stanje se sprema, baza se vraća, sesije se poništavaju
- ✓ Sigurnosne kopije i vraćanje > automatske kopije: čuva se zadani broj najnovijih
- ✓ Sigurnosne kopije i vraćanje > naziv kopije ne smije izaći iz mape (path traversal)

## API rute i izvozi — `server/test/api-smoke.test.ts` (1 testova, svi prolaze)

- ✓ API: sve rute za čitanje i izvozi rade nad stvarnim podacima > GET rute vraćaju 200, izvozi vraćaju ispravne XLSX/PDF datoteke

## E2E test sučelja — `server/test/e2e/ui-smoke.test.ts` (1 test, prolazi)

- ✓ prijava, sve stranice (Dashboard, Artikli, Skladište, Automati, Analitika, Nabava, Izvještaji, Postavke) i sve njihove kartice učitavaju se bez JavaScript grešaka i bez HTTP 5xx odgovora; ulaz robe kroz sučelje povećava stanje centralnog skladišta (70 → 100).

Dodatno je ručno pokrenut preglednički pregled demo baze (≈7.300 izmišljenih transakcija) na 1440×900 i 390×844 (mobitel) – bez grešaka u konzoli; snimke su u `docs/screenshots/`.

## Što testovi NE pokrivaju

| Područje | Razlog | Kako provjeriti |
|---|---|---|
| Stvarni Televend Cloud | razvojno okruženje nije imalo mrežni pristup domenama Televenda; struktura portala nepoznata | Postavke → Televend Cloud → Testiraj povezivanje, zatim Istraži portal (vidi TELEVEND-CONNECTOR.md) |
| Windows DPAPI | dostupan samo na Windowsu; u testu je PowerShell simuliran (provjereni argumenti, skripta i da ključ ide samo kroz stdin) | prvo pokretanje servisa: Postavke → Sustav → „Status ključa: dostupan” |
| Windows servis, PowerShell skripte (instalacija, certifikat, vatrozid) | nisu izvršene na Windowsu | instalacija prema README-u na ciljnom računalu |
| Slanje stvarnog e-maila | SMTP transport je u testovima zamijenjen testnim | Postavke → E-mail → Pošalji testnu poruku |
| HTTPS s PFX certifikatom | certifikat se izrađuje skriptom na Windowsu | otvoriti https://<IP>:3000 s uredskog računala |

## Testni portal

`server/test/fixtures/mockPortal.ts` je lokalni HTTP poslužitelj s **izmišljenom** strukturom (prijava, MFA, CAPTCHA, prijava u dva koraka, stranica bez obrasca, izvještaj prodaje s CSV izvozom, tablica uređaja s paginacijom, opasne poveznice „Obriši sve podatke” i „Odjava”, preusmjeravanje na drugu domenu, HTTP 500). Služi isključivo za provjeru mehanizma konektora i ne predstavlja Televend Cloud.

