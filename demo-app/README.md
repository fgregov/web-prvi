# Renvara — demo aplikacija

Cijela Renvara (početna, Follow-up Engine, leadovi, kupci, prilike, zadaci,
mobilne obavijesti) u tri datoteke koje se na računalu otvaraju **dvoklikom**
u pregledniku. Bez instalacije, bez poslužitelja i bez računa.

Provjereno u Chromeu (Edge radi na istoj osnovi); Safari i Firefox nisu
provjereni. Na mobitelu se datoteka iz aplikacije Datoteke obično ne pokreće;
na mobitelu otvorite objavljeni demo ili web adresu Renvare u pregledniku.

| Datoteka | Što je |
| --- | --- |
| `renvara-demo.html` | Demo s primjerima podataka (kupci, prilike, ponude, zadaci). |
| `renvara-prazni-pocetak.html` | Prazna Renvara: samo ono što sami unesete. |
| `renvara-mobilni-prikaz.html` | Demo s primjerima u okviru mobitela, za prezentaciju na računalu (u uskom prozoru preko cijele širine). |

## Kako koristiti

1. Otvorite datoteku (dvoklik ili povucite je u preglednik).
2. Prijava prihvaća **bilo koje korisničko ime i lozinku**: to je demo, ništa
   se ne šalje nikamo.
3. Za prikaz kao na mobitelu na računalu: `renvara-mobilni-prikaz.html`, ili
   u pregledniku F12 → prikaz uređaja.

## Važno

- **Podaci ostaju samo u tom pregledniku** na tom uređaju (lokalno
  spremište). Drugi preglednik ili drugo računalo kreće ispočetka; brisanje
  podataka preglednika briše i unesene podatke.
- Demo s primjerima se **svaki dan vraća na primjere** (datumi su vezani uz
  današnji dan). Prazni početak čuva ono što unesete.
- Prazni početak i demo s primjerima ne miješaju podatke ni prijavu.
- Obavijesti (podsjetnici, push) se u demou **ne šalju**; postavke se spremaju.
- S internetom se učitavaju font (Google Fonts) i preglednik PDF-a (pdf.js s
  jsDelivr); bez interneta aplikacija radi sa sistemskim fontom, a stranice
  PDF ponuda se ne iscrtavaju.
- Poveznice za dijeljenje ponuda u demou otvaraju se samo u tom pregledniku.
- **Korisnici**: demo račun je vlasnik organizacije. Korisnike možete dodati,
  urediti, dati im prava i deaktivirati ih, ali se oni u demou ne prijavljuju
  (nema lozinki ni poziva e-mailom); to radi BETA poslužitelj.

Za pravu prijavu i podatke na poslužitelju služi BETA
(`apps/beta-web/README.md`).

## Nova verzija mape

Datoteke su izgrađene iz koda ovog repozitorija. Nakon promjena u aplikaciji:

```bash
pnpm install
pnpm --filter @renvara/beta-web demo:folder
```
