# Promjene

## 1.1.0-test.1 – testna verzija (2026-10-24)

Testna verzija za provjeru na stvarnom Televend Cloud računu. Načelo rada: **ručno se unosi samo nabavna (ulazna)
cijena** (i, po želji, ulaz robe s cijenom). Artikle, automate i kretanja zaliha aplikacija generira sama iz Televenda.

### Novo
- **Automatsko stvaranje artikala** iz Televend artikala (iz liste artikala ili iz prodaje): šifra `TV-<ID>`, naziv i
  kategorija iz Televenda, nabavna cijena 0 € s oznakom „nije unesena”. Ako već postoji aktivan lokalni artikl istog
  naziva, Televend artikl se povezuje s njim (bez duplikata).
- **Artikli → Nabavne cijene**: tablični unos nabavnih cijena (filtar „samo artikli bez unesene cijene”, izvoz).
  Ulaz robe s cijenom i dalje ažurira cijenu artikla. Svaka promjena cijene bilježi se u revizijski zapis.
- **Automatsko skladište:**
  - prodaja iz Televenda knjiži se na zalihu automata (od datuma početka, koji se postavlja automatski pri prvom uvozu –
    povijesna prodaja ulazi u analitiku, ali se ne knjiži na zalihe);
  - dopune iz Televenda knjiže se kao prijenos *izvorna lokacija (zadano centralno skladište) → automat*; dopuna koja je
    već ručno evidentirana prijenosom samo se povezuje;
  - stanja u automatima iz Televenda usklađuju zalihu automata – knjiži se samo razlika, isti snimak ne stvara novi dokument.
  - Automatski dokumenti označeni su (`auto_generated`) i smiju dovesti centralno stanje u minus (npr. nedostaje ručni
    ulaz robe) – to se jasno prikazuje na Dashboardu i u Skladištu, a ručni dokumenti i dalje ne smiju u minus.
- **Postavke → Automatizacija i skladište**: uključivanje/isključivanje pojedinih automatizama, izvorna lokacija dopuna,
  datum početka, pregled (artikli bez cijene, automatski stvoreni artikli, negativno centralno stanje, dopune na čekanju).
- Dashboard: upozorenja za artikle bez nabavne cijene i za negativno centralno stanje.
- Verzija aplikacije prikazuje se na prijavi i u izborniku (`/api/health`, `/api/auth/me`).

### Televend Cloud
- Zadana adresa stranice za prijavu: **https://app.televendcloud.com** (službena adresa koju je dao korisnik);
  polje se predpopunjava, a može se promijeniti.
- Zadani popis dopuštenih domena: `TELEVEND_ALLOWED_HOSTS=app.televendcloud.com`, navigacija/preusmjeravanja:
  `TELEVEND_EXTRA_NAVIGATION_HOSTS=*.televendcloud.com` (vrijednost `*` isključuje ograničenje).
- Skup podataka „artikli” ima polje **Kategorija** (koristi se pri automatskom stvaranju artikala).
- Konektor i dalje ne sadrži izmišljene selektore, putanje izvještaja ni nazive stupaca – oni se zadaju nakon
  istraživanja stvarnog portala.

### Ispravci
- Statičke datoteke klijenta (`/assets/*`) više se ne vraćaju kao `index.html` nakon nove izgradnje; nepostojeća
  datoteka vraća 404, `index.html` se ne sprema u predmemoriju.

### Testiranje
- 95/95 automatskih testova (8 datoteka, novo: `server/test/automation.test.ts`, 9 testova) i 1/1 E2E test sučelja
  (uključuje unos nabavne cijene kroz sučelje). Detalji: `docs/TESTIRANJE.md`.
- **Stvarni Televend portal nije testiran:** razvojno okruženje nema mrežni pristup domeni `app.televendcloud.com`
  (proxy odbija vezu, HTTP 403). Nijedan rezultat prijave ili preuzimanja nije simuliran.

## 1.0.0 (2026-10-24)

Prva verzija: skladišna knjiga, artikli, automati, analitika, nabava, e-mail upozorenja, normativi, backup,
sigurnost, Televend konektor (testiran na lokalnom testnom portalu), Windows skripte.
