# Renvara — iOS demo aplikacija za jedan iPhone

Gotov Xcode projekt: Renvara je već ugrađena u aplikaciju, a podaci ostaju na
telefonu. Potrebni su samo **Mac s Xcodeom** i **vaš iPhone**; bez Node.js-a,
bez repozitorija, bez poslužitelja i bez plaćenog Apple računa.

Aplikacija se potpisuje profilom u kojem je samo vaš iPhone, pa se ne može
instalirati ni pokrenuti na drugom uređaju.

## Sadržaj mape

| Mapa / datoteka | Što je |
| --- | --- |
| `App/App.xcodeproj` | **Ovo otvorite u Xcodeu.** |
| `App/App/` | Kod aplikacije, ikona, početni zaslon, `Info.plist` |
| `App/App/public/index.html` | Renvara u aplikaciji (sada: prazni početak) |
| `App/CapApp-SPM/` | Capacitor; Xcode ga sam preuzme s GitHuba pri prvom otvaranju |
| `debug.xcconfig` | Postavka za razvojnu verziju (ne mijenjati) |
| `sadrzaj/prazni-pocetak/` | Prazna Renvara: samo ono što sami unesete |
| `sadrzaj/demo-s-primjerima/` | Renvara s primjerima podataka (svaki dan iznova) |

## Što treba

- Mac s **Xcodeom 26** (besplatan u Mac App Storeu).
- iPhone s **iOS 15** ili novijim i kabel.
- **Apple ID** (dovoljan je besplatan).
- Internet pri prvoj izradi (Xcode preuzima Capacitor).

## Postupak (prvi put)

1. Otvorite `App/App.xcodeproj` (dvoklik). Pričekajte da Xcode dovrši
   „Resolving Package Graph” (dolje desno).
2. Xcode → **Settings → Accounts** → **+** → Apple ID → prijavite se.
3. Lijevo kliknite projekt **App** → target **App** → kartica **Signing &
   Capabilities**:
   - uključite **Automatically manage signing**,
   - **Team**: „Vaše ime (Personal Team)”,
   - **Bundle Identifier**: upišite vlastiti, npr. `hr.vaseime.renvara`
     (mora biti jedinstven; ako Xcode javi da je zauzet, promijenite ga).
4. Spojite iPhone kabelom, otključajte ga i dodirnite **Vjeruj** ovom računalu.
5. Na iPhoneu (iOS 16 i noviji): **Postavke → Privatnost i sigurnost → Način
   rada za razvojne programere** → uključite i ponovno pokrenite telefon.
   (Stavka se pojavi nakon što je iPhone spojen na Xcode.)
6. U Xcodeu gore u sredini odaberite **svoj iPhone** i kliknite **▶ (Run)**.
7. Prvo pokretanje javlja „Nepouzdan programer”: na iPhoneu **Postavke →
   Općenito → VPN i upravljanje uređajem** → vaš Apple ID → **Vjeruj**. Zatim
   otvorite Renvaru s početnog zaslona.

Prijava u aplikaciji prihvaća bilo koje korisničko ime i lozinku: to je demo,
ništa se ne šalje nikamo.

## Primjeri podataka umjesto praznog početka

Kopirajte `sadrzaj/demo-s-primjerima/index.html` u `App/App/public/`
(zamijenite postojeći `index.html`) i ponovno kliknite **▶**. Za povratak
kopirajte `sadrzaj/prazni-pocetak/index.html` na isto mjesto. Podaci obje
verzije čuvaju se odvojeno.

## Važno

- **Besplatan Apple ID: aplikacija radi 7 dana.** Nakon toga spojite iPhone i
  ponovno kliknite **▶**; podaci ostaju. S plaćenim Apple Developer Programom
  potpis traje do godinu dana. Najviše 3 takve aplikacije po iPhoneu.
- **Podaci su samo na tom iPhoneu.** Brisanje aplikacije briše i podatke.
- **Obavijesti se ne šalju** (push još nije napravljen za iOS aplikaciju);
  postavke se spremaju.
- S internetom se učitavaju font (Google Fonts) i preglednik PDF-a (jsDelivr);
  bez interneta radi sistemski font, a stranice PDF ponuda se ne iscrtavaju.
- Gumbi „Nastavi s Appleom / Googleom” i „Zaboravljena lozinka?” na prijavi ne
  rade (demo).

## Nova verzija mape

Mapa je izgrađena iz repozitorija (`apps/ios`). Nakon promjena u aplikaciji:

```bash
pnpm install
pnpm --filter @renvara/ios run export
```
