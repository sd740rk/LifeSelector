# Rozvaha — demo

Porovnanie životných rozhodnutí cez oportunitné náklady. Statická stránka, beží
na GitHub Pages, žiadny server.

**Prvý use case:** bývanie — nájom, kúpa alebo stavba.

---

## Ako to nasadiť

1. **Vytvorte repozitár** a nahrajte doň obsah tohto priečinka.

   ```bash
   git init
   git add .
   git commit -m "Rozvaha: prvé demo"
   git branch -M main
   git remote add origin https://github.com/POUZIVATEL/rozvaha.git
   git push -u origin main
   ```

2. **Zapnite Pages:** Settings → Pages → Source: **GitHub Actions**.
   Workflow `.github/workflows/pages.yml` nasadí stránku pri každom pushi do `main`.

3. **Pridajte kľúč k FRED** (voliteľné, ale bez neho sa sadzby neobnovujú):
   - kľúč zadarmo: https://fred.stlouisfed.org/docs/api/api_key.html
   - Settings → Secrets and variables → Actions → New repository secret
   - meno `FRED_API_KEY`, hodnota váš kľúč

4. **Prvé stiahnutie sadzieb:** Actions → *Obnova sadzieb z FRED* → Run workflow.
   Ďalej to beží samo každý deň o 6:00 UTC.

Stránka je potom na `https://POUZIVATEL.github.io/rozvaha/`.

Lokálne stačí ľubovoľný statický server, lebo ide o ES moduly:

```bash
python3 -m http.server 8000
```

---

## Prečo sa sadzby sťahujú v Action a nie v prehliadači

FRED API potrebuje kľúč. Volanie z prehliadača by ho zverejnilo komukoľvek, kto
si otvorí zdroj stránky. Preto:

```
GitHub Action (kľúč v secrets)  →  data/rates.json  →  commit  →  Pages  →  prehliadač
```

Vedľajší efekt je užitočný: keď Action zlyhá alebo vypadne, snímok zostarne a
aplikácia to **prizná** namiesto toho, aby ticho počítala so starým číslom.
Nad 8 dní (PMMS vychádza vo štvrtok) sa zobrazí upozornenie a v bočnom menu
svieti stav zdroja.

---

## Štruktúra

```
index.html                     shell stránky
assets/tokens.css              dizajnové tokeny (Blok 3), vrátane tmavého režimu
assets/app.css                 štýly rozhrania
src/engine.js                  výpočtový engine — tri vrstvy, bez závislostí
src/data.js                    načítanie snímku, provenancia, vek dát
src/app.js                     stav, router, obrazovky
data/rates.json                snímok sadzieb, commituje ho Action
scripts/fetch-rates.mjs        sťahovanie z FRED (beží len v Action)
.github/workflows/             nasadenie na Pages + denná obnova sadzieb
```

---

## Engine

Každá možnosť má rovnaký tvar:

> viazaný kapitál + tok hotovosti + (voliteľne) aktívum + (voliteľne) financovanie + náklad na výstup

Dve vyrovnania robia možnosti porovnateľnými:

- **Rovnaký mesačný rozpočet** — lacnejšia možnosť investuje rozdiel.
- **Rovnaký vstupný kapitál** — kto viaže menej, investuje zvyšok od prvého dňa.

Tri vrstvy: `runProjection()` → `translateToFactors()` → `computeFitScore()`.
Navyše `solveBreakeven()` hľadá bisekciou hranicu nájmu, pri ktorej sa poradie
prevráti — to je najhodnotnejší výstup, lebo si ho používateľ vie overiť oproti
inzerátom.

---

## Dizajn

Z Bloku 3: **význam nesie svetlosť, tvar a slovo, odtieň je až tretia vrstva.**
Dôvod je v cieľovej skupine 18–65 rokov, kde sú oslabené obe farebné osi —
nad 40 slabne modrá–žltá, asi 8 % mužov nerozlíši červenú a zelenú.

Preto pôvod každého čísla nesie **tvar značky**, nie farba: plná = z dát,
polovičná = z profilu, prázdna = zadané ručne, prerušovaná = zastarané.

Tmavý režim sleduje systém a dá sa prepnúť v profile.

---

## Čo demo zámerne nerobí

- **Nemá dane** — odpočet úrokov, oslobodenie pri predaji, zdanenie prenájmu.
  Najväčšia medzera v presnosti a závisí od jurisdikcie.
- **Nemá PMI** pri akontácii pod 20 %.
- **Počíta nominálne** — nič nie je očistené o infláciu.
- **Je deterministické** — jednobodové odhady, žiadne rozdelenie okolo výnosov.
- **Dáta sú americké** — pre ČR/SK treba ČNB ARAD a ČSÚ. Schéma je nezávislá od
  zdroja, mení sa len `scripts/fetch-rates.mjs`.
- **Zapnutá je len kategória bývania.** Ostatné majú rovnaký engine, ale iné
  benchmarky a vstupy.
- **Dáta sú len vo vašom prehliadači** (localStorage). Žiadne účty, žiadny server.

Je to nástroj na štruktúrované myslenie, nie predpoveď.
