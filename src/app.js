import { evaluateDecision, solveBreakeven, monthlyMortgagePayment } from './engine.js';
import { loadRates, markerSvg } from './data.js';

/* ---------------------------------------------------------------- stav */

const KEY = 'rozvaha.v1';

const DEFAULT_STATE = {
  profile: {
    weights: { financial: 8, flexibility: 5, stability: 5, lifestyle: 5 },
    altReturnRatePercent: 7,
    altChoice: 'index',
    investmentDisciplinePercent: 70
  },
  draft: {
    category: 'housing',
    rent: 1200,
    years: 10,
    homePrice: 300000,
    downPercent: 20,
    lives: { rent: false, buy: true, build: true }
  },
  decisions: []
};

let state = load();
let rates = null;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...parsed };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* súkromný režim */ }
}

function update(fn) { fn(state); save(); render(); }

/* ------------------------------------------------------------- pomôcky */

const fmt = (n) => Math.round(n).toLocaleString('sk-SK').replace(/\u00A0/g, ' ') + ' $';
const pct = (n) => n.toFixed(2).replace('.', ',') + ' %';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const BENCHMARKS = {
  housing: {
    flexibility: { exitCostMaxPercent: 20, lockInMaxMonths: 60 },
    stability: { volatilityScaleMax: 10 },
    financial: { annualizedReturnFloorPercent: -5, annualizedReturnCeilingPercent: 12 }
  }
};

const FACTOR_NAMES = {
  financial: 'Financie', flexibility: 'Flexibilita', stability: 'Stabilita', lifestyle: 'Životný štýl'
};

/** Popisy faktorov. Bez nich je nastavovanie váh hádanie — človek nevie, čo posúva. */
const FACTOR_INFO = {
  financial: {
    what: 'Koľko vám na konci zostane v majetku, keď sa odráta všetko, čo rozhodnutie stálo.',
    how: 'Počíta sa z vašich čísel a z dát o sadzbách.',
    high: 'Vysoká váha znamená, že rozhoduje suma na konci.',
    low: 'Nízka váha znamená, že peniaze sú pre vás až druhoradé.'
  },
  flexibility: {
    what: 'Ako ľahko a lacno sa dá rozhodnutie zvrátiť, keď sa vám zmení život.',
    how: 'Odvodzuje sa z nákladov na výstup a z toho, ako dlho ste viazaný — pri byte je to provízia a čas predaja, pri nájme výpovedná lehota.',
    high: 'Vysoká váha dáva za pravdu nájmu a krátkym záväzkom.',
    low: 'Nízka váha znamená, že ste rozhodnutý zostať.'
  },
  stability: {
    what: 'Nakoľko viete dopredu, čo budete platiť, a nakoľko sa dá veriť predpokladom.',
    how: 'Odvodzuje sa z kolísania nákladov a z istoty vstupov — fixná splátka je stabilná, nájom môže majiteľ zdvihnúť, stavba sa môže predražiť.',
    high: 'Vysoká váha dáva za pravdu fixnej hypotéke.',
    low: 'Nízka váha znamená, že výkyvy zvládnete.'
  },
  lifestyle: {
    what: 'Čo vám to umožní v bežnom dni — či môžete zariaďovať po svojom, či to pôsobí trvalo, nakoľko máte pod kontrolou okolie.',
    how: 'Jediný faktor, ktorý sa zámerne neodvodzuje z dát. Hodnotíte ho vy, lebo trhové čísla nevedia, ako sa vám kde býva.',
    high: 'Vysoká váha dáva za pravdu vlastnému bývaniu.',
    low: 'Nízka váha znamená, že bývanie je pre vás hlavne strecha nad hlavou.'
  }
};

const ALT_CHOICES = [
  { id: 'account', label: 'Nechal by som ich na účte', hint: 'Bez zhodnotenia, kedykoľvek dostupné', rate: 0.5 },
  { id: 'savings', label: 'Sporiaci účet', hint: 'Istota, nízky výnos', rate: 2.5 },
  { id: 'bonds', label: 'Dlhopisy alebo konzervatívny fond', hint: 'Mierne kolísanie', rate: 4 },
  { id: 'index', label: 'Indexové fondy', hint: 'Dlhodobý priemer, po ceste kolíše', rate: 7 }
];

const CATEGORIES = [
  { id: 'housing', label: 'Bývanie', age: '35–50', ready: true, desc: 'Kde a ako budete bývať, a čo to spraví s vaším majetkom.', icon: 'M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z' },
  { id: 'edu', label: 'Vzdelanie', age: '18–25', ready: false, desc: 'Škola alebo práca, vrátane ušlej mzdy počas štúdia.', icon: 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6' },
  { id: 'invest', label: 'Investovanie', age: '25–65', ready: false, desc: 'Investovať alebo sporiť, a pri akom riziku.', icon: 'M4 19h16M6 15l4-4 3 3 5-6M15 8h3v3' },
  { id: 'car', label: 'Auto', age: '30–50', ready: false, desc: 'Kúpa, úver alebo operatívny leasing.', icon: 'M3 16v-3l2-5a2 2 0 012-1h10a2 2 0 012 1l2 5v3zM7.5 18.5a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6zM16.5 18.5a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z' }
];

/* --------------------------------------------------- zostavenie možností */

function buildOptions(d) {
  const down = d.homePrice * (d.downPercent / 100);
  const closing = d.homePrice * 0.03;
  const carry = (d.homePrice * 0.02) / 12;

  const rent = {
    id: 'rent', label: 'Nájom a investovanie rozdielu', providesHousing: d.lives.rent,
    financialInputs: {
      upfrontCosts: [{ name: 'Kaucia', amount: d.rent * 2 }],
      recurringCashFlows: [], asset: null, financing: null, exitCost: null
    },
    rawFactorInputs: { exitCostPercent: 8, lockInMonths: 12, costVolatility: 6, confidencePercent: 90 },
    selfRatedFactors: { lifestyleChecklist: [
      { item: 'Môžem zariaďovať po svojom', value: 0 },
      { item: 'Pôsobí to trvalo', value: 1 },
      { item: 'Kontrola nad okolím', value: 1 }
    ] }
  };

  const buy = {
    id: 'buy', label: 'Kúpa bytu na hypotéku', providesHousing: d.lives.buy,
    financialInputs: {
      upfrontCosts: [{ name: 'Akontácia', amount: down }, { name: 'Poplatky pri kúpe', amount: closing }],
      recurringCashFlows: [{ name: 'Dane, poistenie, údržba', type: 'cost', monthlyAmount: carry, annualGrowthRatePercent: 2 }],
      asset: { initialValue: d.homePrice, appreciationRatePercent: rates.get('homePriceIndex') ?? 4 },
      financing: { principal: d.homePrice - down, annualRatePercent: rates.get('mortgage30') ?? 6.65, termMonths: 360 },
      exitCost: { percentOfAssetValue: 6 }
    },
    rawFactorInputs: { exitCostPercent: 9, lockInMonths: 48, costVolatility: 2, confidencePercent: 85 },
    selfRatedFactors: { lifestyleChecklist: [
      { item: 'Môžem zariaďovať po svojom', value: 2 },
      { item: 'Pôsobí to trvalo', value: 2 },
      { item: 'Kontrola nad okolím', value: 1 }
    ] }
  };

  const build = {
    id: 'build', label: 'Stavba domu na vidieku', providesHousing: d.lives.build,
    financialInputs: {
      upfrontCosts: [
        { name: 'Pozemok', amount: 45000 },
        { name: 'Povolenia a projekt', amount: 8000 },
        { name: 'Akontácia na stavbu', amount: 30000 }
      ],
      recurringCashFlows: [{ name: 'Úver a prevádzka', type: 'cost', monthlyAmount: 700, annualGrowthRatePercent: 2 }],
      asset: { initialValue: 260000, appreciationRatePercent: (rates.get('homePriceIndex') ?? 4) - 1 },
      financing: { principal: 180000, annualRatePercent: (rates.get('mortgage30') ?? 6.65) + 0.4, termMonths: 300 },
      exitCost: { percentOfAssetValue: 8 }
    },
    rawFactorInputs: { exitCostPercent: 12, lockInMonths: 60, costVolatility: 5, confidencePercent: 65 },
    selfRatedFactors: { lifestyleChecklist: [
      { item: 'Môžem zariaďovať po svojom', value: 2 },
      { item: 'Pôsobí to trvalo', value: 2 },
      { item: 'Kontrola nad okolím', value: 2 }
    ] }
  };

  return [rent, buy, build];
}

function buildConfig(d) {
  return {
    timeHorizonYears: d.years,
    altReturnRatePercent: state.profile.altReturnRatePercent,
    benchmarks: BENCHMARKS.housing,
    weights: state.profile.weights,
    housingCost: { monthlyAmount: d.rent, annualGrowthRatePercent: rates.get('cpiRent') ?? 3 },
    investmentDisciplinePercent: state.profile.investmentDisciplinePercent
  };
}

function evaluate(d) {
  return evaluateDecision(buildOptions(d), buildConfig(d));
}

function breakevenFor(d) {
  return solveBreakeven(
    (rentLevel) => {
      const draft = { ...d, rent: rentLevel };
      return { options: buildOptions(draft).slice(0, 2), config: buildConfig(draft) };
    },
    'rent', 'buy', { min: 200, max: 9000 }
  );
}

/* ------------------------------------------------------------ fragmenty */

function factorBars(scores, win) {
  return `<div class="factors">` + Object.keys(FACTOR_NAMES).map((k) => `
    <div class="factor">
      <div class="n">${FACTOR_NAMES[k]}</div>
      <div class="bar-track" style="flex-grow:1"><div class="bar-fill${win ? ' win' : ''}" style="width:${Math.round(scores[k] * 10)}%"></div></div>
      <div class="v num">${scores[k].toFixed(1).replace('.', ',')}</div>
    </div>`).join('') + `</div>`;
}

function srcRow(origin, label, value, tag) {
  return `<div class="src-row">${markerSvg(origin)}<div class="l">${esc(label)}</div><div class="v num">${esc(value)}</div><div class="t">${esc(tag)}</div></div>`;
}

function staleBanner() {
  if (!rates.stale) return '';
  const days = rates.ageDays === null ? null : rates.ageDays;
  const text = rates.failed
    ? 'Snímok sadzieb sa nepodarilo načítať, počítame so zabudovanými hodnotami.'
    : `Sadzby sú ${days} dní staré — snímok sa neobnovil. Výsledok berte ako orientačný.`;
  return `<div class="banner warn">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" style="flex-shrink:0" aria-hidden="true"><path d="M12 9v4.5M12 17v.5"></path><path d="M10.3 4.2L2.8 17.5A1.5 1.5 0 004.1 20h15.8a1.5 1.5 0 001.3-2.5L13.7 4.2a1.6 1.6 0 00-2.7 0z"></path></svg>
    <div><strong>Dáta nie sú čerstvé.</strong> ${esc(text)}</div>
  </div>`;
}

function progress(step) {
  const labels = ['Kategória', 'Možnosti', 'Vstupy', 'Výsledok'];
  return `<div class="progress">` + labels.map((l, i) => {
    const cls = i < step ? 'done' : i === step ? 'now' : '';
    return `<div><div class="rail ${cls}"></div><span>${l}</span></div>`;
  }).join('') + `</div>`;
}

/* ------------------------------------------------------------ obrazovky */

function screenHome() {
  const d = state.draft;
  const be = breakevenFor(d);
  const m = rates.meta('mortgage30');

  const hasDecisions = state.decisions.length > 0;

  const list = hasDecisions ? `
    <div class="stack">
      ${state.decisions.map((dec, i) => {
        const res = evaluate(dec.draft);
        return `<a class="card" href="#/vysledok" data-open="${i}" style="text-decoration:none;color:inherit;display:flex;gap:24px;flex-wrap:wrap">
          <div style="width:300px">
            <div class="eyebrow">Bývanie · ${dec.draft.years} rokov</div>
            <h2 style="margin-top:6px">${esc(dec.title)}</h2>
            <p class="muted" style="margin-top:6px">Uložené ${esc(dec.savedAt)}</p>
          </div>
          <div style="flex-grow:1;min-width:260px;display:flex;flex-direction:column;gap:10px">
            <div class="row" style="gap:34px">
              <div><div class="muted">Finančne vedie</div><strong>${esc(res.rankedFinancially[0].option.label.split(' ')[0])}</strong></div>
              <div><div class="muted">Vám sadne</div><strong style="color:var(--accent)">${esc(res.ranked[0].option.label.split(' ')[0])}</strong></div>
            </div>
            ${factorBars(res.ranked[0].scores, true)}
          </div>
        </a>`;
      }).join('')}
    </div>` : '';

  return `
  <div class="stack">
    ${staleBanner()}
    <div class="between">
      <div>
        <h1>${hasDecisions ? 'Vaše rozhodnutia' : 'Zatiaľ tu nemáte žiadne rozhodnutie'}</h1>
        <p class="body" style="margin-top:8px;max-width:720px">
          ${hasDecisions ? 'Dnešná sadzba sa mení každý štvrtok — porovnania sa prepočítajú samé.' : 'Kým si nejaké založíte, tu je dnešná odpoveď na najčastejšiu otázku, spočítaná z verejných dát.'}
        </p>
      </div>
      <a class="btn" href="#/kategoria">Nové rozhodnutie</a>
    </div>

    <div class="banner accent" style="flex-direction:column;gap:14px">
      <div class="label eyebrow" style="display:flex;align-items:center;gap:8px"><span class="dot" style="background:var(--on-accent-label)"></span>Dnešný bod zlomu</div>
      <h2 style="font-size:30px;color:var(--on-accent)">${be === null ? 'Pri týchto parametroch bod zlomu neexistuje' : `Kúpa sa oplatí od nájmu ${fmt(be)} mesačne`}</h2>
      <p class="sub" style="max-width:640px">${be === null
        ? 'Jedna možnosť vychádza lepšie bez ohľadu na výšku nájmu.'
        : `Ak platíte viac, kúpa vás za ${d.years} rokov dostane ďalej. Ak menej, vyhráva nájom s investovaním rozdielu. Počítané pri sadzbe ${pct(rates.get('mortgage30'))}.`}</p>

      <div class="grid-3" style="gap:16px;width:100%">
        <div class="field">
          <label for="h-price" style="color:var(--on-accent-muted)">Cena bytu — ${fmt(d.homePrice)}</label>
          <input id="h-price" type="range" min="120000" max="700000" step="10000" value="${d.homePrice}" data-draft="homePrice">
        </div>
        <div class="field">
          <label for="h-down" style="color:var(--on-accent-muted)">Akontácia — ${d.downPercent} %</label>
          <input id="h-down" type="range" min="5" max="50" step="5" value="${d.downPercent}" data-draft="downPercent">
        </div>
        <div class="field">
          <label for="h-years" style="color:var(--on-accent-muted)">Horizont — ${d.years} r.</label>
          <input id="h-years" type="range" min="3" max="25" step="1" value="${d.years}" data-draft="years">
        </div>
      </div>
      <p class="sub" style="font-size:12px">Sadzba aj zhodnotenie zostávajú z dát. Meníte len to, čo sa týka vás.</p>
    </div>

    ${list}

    <div class="card">
      <div class="eyebrow">Na čom to stojí</div>
      <div style="margin-top:12px">
        ${srcRow(rates.stale ? 'stale' : 'data', m ? m.label : 'Hypotéka', pct(rates.get('mortgage30')), m ? m.seriesId : '')}
        ${srcRow(rates.stale ? 'stale' : 'data', 'Zhodnotenie nehnuteľností', pct(rates.get('homePriceIndex')), 'CSUSHPINSA')}
        ${srcRow('profile', 'Alternatívny výnos', pct(state.profile.altReturnRatePercent), 'profil')}
        ${srcRow('manual', 'Váš nájom', fmt(d.rent), 'ručne')}
      </div>
    </div>
  </div>`;
}

function screenCategory() {
  const d = state.draft;
  return `
  <div class="stack">
    ${progress(0)}
    <div>
      <h1>O čom sa rozhodujete?</h1>
      <p class="body" style="margin-top:8px;max-width:780px">Kategória určuje, ktoré dáta doplníme a na akej škále porovnávame. Viazanosť pri hypotéke a pri pracovnej zmluve znamená iné čísla, ale rovnaké skóre od 0 do 10.</p>
    </div>
    <div class="grid-4">
      ${CATEGORIES.map((c) => `
        <button class="tile" type="button" data-category="${c.id}" aria-pressed="${c.id === d.category}" ${c.ready ? '' : 'disabled style="opacity:.55;cursor:not-allowed"'}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${c.icon}"></path></svg>
          <div class="l">${c.label}</div>
          <div class="s">${c.ready ? c.age : 'čoskoro'}</div>
        </button>`).join('')}
    </div>
    <p class="muted">V deme je zapnutá len kategória bývania. Ostatné majú rovnaký engine, ale iné benchmarky a iné vstupy.</p>
    <div class="between">
      <span></span>
      <a class="btn" href="#/moznosti">Pokračovať na možnosti</a>
    </div>
  </div>`;
}

function screenOptions() {
  const d = state.draft;
  const defs = [
    { id: 'rent', type: 'Bez aktíva', label: 'Nájom a investovanie rozdielu', hint: 'Neviaže kapitál. Ušetrené peniaze idú do investície.' },
    { id: 'buy', type: 'Aktívum a hypotéka', label: 'Kúpa bytu', hint: 'Viaže kapitál, vracia ho v hodnote nehnuteľnosti.' },
    { id: 'build', type: 'Aktívum a stavba', label: 'Stavba domu na vidieku', hint: 'Pozemok a stavba zvlášť, s rizikom preplatenia.' }
  ];
  return `
  <div class="stack">
    ${progress(1)}
    <div>
      <h1>Medzi čím vyberáte?</h1>
      <p class="body" style="margin-top:8px;max-width:780px">Každá možnosť má iný tvar: nájom neviaže kapitál, kúpa ho viaže a vracia v hodnote nehnuteľnosti.</p>
    </div>
    ${defs.map((o) => `
      <div class="card" style="display:flex;gap:24px;flex-wrap:wrap">
        <div style="width:260px">
          <span class="pill accent">${o.type}</span>
          <h3 style="margin-top:9px">${o.label}</h3>
          <p class="muted" style="margin-top:5px">${o.hint}</p>
        </div>
        <div style="flex-grow:1;min-width:280px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;background:${'var(--page)'};border-radius:var(--radius)">
          <div>
            <strong style="font-size:14px">Bývali by ste tam?</strong>
            <p class="muted">${d.lives[o.id] ? 'Nájom sa pri tejto možnosti neplatí.' : 'Platíte za bývanie inde — pripočítame nájom.'}</p>
          </div>
          <div class="seg">
            <button type="button" data-lives="${o.id}" data-value="1" aria-pressed="${d.lives[o.id]}">Áno</button>
            <button type="button" data-lives="${o.id}" data-value="0" aria-pressed="${!d.lives[o.id]}">Nie</button>
          </div>
        </div>
      </div>`).join('')}
    <div class="between">
      <p class="muted" style="max-width:520px">Odpoveď „nie" znamená, že aj pri tejto možnosti platíte za bývanie inde — tá suma sa započíta do nákladov.</p>
      <a class="btn" href="#/vstupy">Pokračovať na vstupy</a>
    </div>
  </div>`;
}

function screenInputs() {
  const d = state.draft;
  const pmt = monthlyMortgagePayment({
    principal: d.homePrice * (1 - d.downPercent / 100),
    annualRatePercent: rates.get('mortgage30') ?? 6.65,
    termMonths: 360
  });
  const notes = {
    3: 'Pri troch rokoch poplatky za kúpu a predaj zvyčajne prevážia zhodnotenie.',
    5: 'Päť rokov býva hranica, kde sa kúpa začína vyplácať.',
    10: 'Desať rokov je dosť dlho, aby sa zhodnotenie prejavilo.',
    15: 'Pri pätnástich rokoch výrazne rastie podiel splatenej istiny.',
    20: 'Dvadsať rokov znamená, že väčšina hypotéky je splatená.'
  };
  const nearest = [3, 5, 10, 15, 20].reduce((a, b) => Math.abs(b - d.years) < Math.abs(a - d.years) ? b : a);

  return `
  <div class="stack">
    ${progress(2)}
    <div>
      <h1>Dve otázky, zvyšok doplníme</h1>
      <p class="body" style="margin-top:8px;max-width:760px">Úrok hypotéky a zhodnotenie ťaháme z verejných dát — budú presnejšie než odhad. Pýtame sa len na to, čo viete lepšie vy.</p>
    </div>

    <div class="card">
      <h3>Koľko platíte za nájom teraz?</h3>
      <p class="muted" style="margin:6px 0 14px">Alebo koľko by ste platili za porovnateľné bývanie. Toto je jediné číslo, ktoré sa nedá odvodiť z dát.</p>
      <div class="row" style="align-items:flex-end">
        <div class="field" style="width:220px">
          <label for="i-rent">Mesačný nájom v $</label>
          <input id="i-rent" type="number" min="0" step="50" value="${d.rent}" data-draft-num="rent">
        </div>
        <div class="field" style="width:220px">
          <label for="i-price">Cena bytu v $</label>
          <input id="i-price" type="number" min="0" step="10000" value="${d.homePrice}" data-draft-num="homePrice">
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Ako dlho tam plánujete zostať?</h3>
      <p class="muted" style="margin:6px 0 14px">Pri krátkom horizonte zjedia poplatky za kúpu a predaj celý zisk zo zhodnotenia.</p>
      <div class="seg">
        ${[3, 5, 10, 15, 20].map((y) => `<button type="button" data-years="${y}" aria-pressed="${y === d.years}">${y} r.</button>`).join('')}
      </div>
      <p class="muted" style="margin-top:12px">${notes[nearest]}</p>
    </div>

    <div class="card">
      <div class="between">
        <div>
          <h3>Predpoklady doplnené z dát</h3>
          <p class="muted" style="margin-top:4px">Každé z nich viete prepísať v profile.</p>
        </div>
        <span class="pill accent">${rates.stale ? 'zastarané' : 'aktuálne'}</span>
      </div>
      <div style="margin-top:14px">
        ${srcRow(rates.stale ? 'stale' : 'data', 'Úrok hypotéky', pct(rates.get('mortgage30')), 'MORTGAGE30US')}
        ${srcRow(rates.stale ? 'stale' : 'data', 'Zhodnotenie nehnuteľností', pct(rates.get('homePriceIndex')), 'CSUSHPINSA')}
        ${srcRow(rates.stale ? 'stale' : 'data', 'Rast nájmu', pct(rates.get('cpiRent')), 'CPI')}
        ${srcRow('profile', 'Alternatívny výnos', pct(state.profile.altReturnRatePercent), 'profil')}
        ${srcRow('profile', 'Investičná disciplína', state.profile.investmentDisciplinePercent + ' %', 'profil')}
        ${srcRow('manual', 'Odhad splátky', fmt(pmt) + ' / mes.', 'výpočet')}
      </div>
    </div>

    <div class="between">
      <p class="muted" style="max-width:520px">Váhy faktorov berieme z vášho profilu, takže sa na ne nemusíme pýtať pri každom rozhodnutí.</p>
      <a class="btn" href="#/vysledok">Zobraziť porovnanie</a>
    </div>
  </div>`;
}

function screenResult() {
  const d = state.draft;
  const res = evaluate(d);
  const be = breakevenFor(d);
  const money = res.rankedFinancially[0];
  const fit = res.ranked[0];
  const gap = Math.abs(res.rankedFinancially[0].projection.finalNetWorth - res.rankedFinancially[1].projection.finalNetWorth);

  return `
  <div class="stack">
    ${staleBanner()}
    <div class="between">
      <div>
        <div class="eyebrow">Bývanie · ${d.years}-ročný horizont</div>
        <h1 style="margin-top:6px">Nájom, kúpa alebo stavba</h1>
      </div>
      <div class="row" style="gap:10px">
        <button class="btn secondary" type="button" data-save>Uložiť rozhodnutie</button>
        <a class="btn secondary" href="#/vypocet">Ukáž mi výpočet</a>
      </div>
    </div>

    <div class="card" style="display:flex;gap:18px">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" style="flex-shrink:0;margin-top:2px" aria-hidden="true"><path d="M7 7l-4 5 4 5M17 7l4 5-4 5"></path></svg>
      <div>
        <h2>${res.moneyAndFitDisagree ? 'Peniaze a vaše priority ukazujú inam' : 'Peniaze aj vaše priority ukazujú rovnako'}</h2>
        <p class="body" style="margin-top:8px;max-width:880px">
          Finančne vychádza najlepšie <strong>${esc(money.option.label)}</strong> — o ${fmt(gap)} za ${d.years} rokov.
          ${res.moneyAndFitDisagree
            ? `Podľa toho, čo ste označili za dôležité, vám však sadne skôr <strong>${esc(fit.option.label)}</strong>. Rozhoduje o tom faktor <strong>${FACTOR_NAMES[res.decidingFactor].toLowerCase()}</strong>, ktorému ste dali váhu ${state.profile.weights[res.decidingFactor]} z 10.`
            : `Rovnaká možnosť vychádza aj podľa vašich priorít.`}
        </p>
      </div>
    </div>

    <div class="grid-3">
      ${res.ranked.map((r, i) => `
        <div class="option-card${i === 0 ? ' win' : ''}">
          <div class="between" style="align-items:center">
            <span class="eyebrow">${i + 1}. miesto</span>
            ${i === 0 ? '<span class="pill accent">Najlepší fit</span>' : ''}
          </div>
          <h3>${esc(r.option.label)}</h3>
          <div class="row" style="gap:28px;padding-top:12px;border-top:1px solid var(--border)">
            <div><div class="muted">Čisté imanie o ${d.years} r.</div><div class="num" style="font-family:var(--font-display);font-size:24px;font-weight:600">${fmt(r.projection.finalNetWorth)}</div></div>
            <div><div class="muted">Fit skóre</div><div class="num" style="font-family:var(--font-display);font-size:24px;font-weight:600">${r.fitScore.toFixed(2).replace('.', ',')}</div></div>
          </div>
          ${factorBars(r.scores, i === 0)}
        </div>`).join('')}
    </div>

    <div class="banner accent">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent-label)" stroke-width="1.8" stroke-linecap="round" style="flex-shrink:0" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"></path><path d="M21 7v5h-5"></path></svg>
      <div>
        <strong style="font-size:17px">${be === null ? 'Bod zlomu pri týchto parametroch neexistuje' : `Bod zlomu: nájom okolo ${fmt(be)} mesačne`}</strong>
        <p class="sub" style="margin-top:4px;max-width:820px">${be === null
          ? 'Jedna možnosť vychádza lepšie bez ohľadu na výšku nájmu.'
          : 'Nad touto hranicou sa kúpa finančne oplatí viac než nájom. Porovnajte si ju s reálnymi inzerátmi vo vašej lokalite — je to overiteľnejšie než akýkoľvek verdikt.'}</p>
      </div>
    </div>

    <p class="muted" style="max-width:1000px">Toto je nástroj na štruktúrované myslenie, nie predpoveď. Vstupy sú predpoklady a výstup dedí ich neistotu — model zatiaľ neráta s daňami ani infláciou.</p>
  </div>`;
}

function screenBreakdown() {
  const d = state.draft;
  const res = evaluate(d);
  const buy = res.results.find((r) => r.option.id === 'buy');
  const p = buy.projection;

  const lines = [
    { l: `Hodnota bytu o ${d.years} rokov`, v: p.assetValueAtExit, c: 'var(--accent)' },
    { l: 'Zostatok hypotéky', v: -p.loanBalanceAtExit, c: 'var(--accent-bar-alt)' },
    { l: 'Náklady na predaj', v: -(p.assetValueAtExit * 0.06), c: 'var(--inactive)' },
    { l: 'Vedľajšie portfólio', v: p.sidePortfolioAtExit, c: 'var(--accent-bar-alt)' },
    { l: 'Vstupný kapitál (spoločná báza)', v: -res.commonUpfront, c: 'var(--inactive)' }
  ];
  const max = Math.max(...lines.map((x) => Math.abs(x.v)));

  return `
  <div class="stack">
    <div>
      <a href="#/vysledok" class="btn ghost" style="padding-left:0">← Späť na porovnanie</a>
      <h1 style="margin-top:8px">Odkiaľ sa berie ${fmt(p.finalNetWorth)}</h1>
      <p class="muted" style="margin-top:4px">${esc(buy.option.label)} · ${d.years} rokov</p>
    </div>

    <div class="card waterfall">
      <div class="eyebrow" style="margin-bottom:8px">Zloženie výsledku</div>
      ${lines.map((x) => `
        <div class="line">
          <div class="lbl">${x.l}</div>
          <div class="viz"><div style="width:${Math.round((Math.abs(x.v) / max) * 100)}%;background:${x.c}"></div></div>
          <div class="amt num">${x.v < 0 ? '−' : ''}${fmt(Math.abs(x.v))}</div>
        </div>`).join('')}
      <div class="line total">
        <div class="lbl">Čisté imanie o ${d.years} rokov</div>
        <div class="viz"></div>
        <div class="amt num">${fmt(p.finalNetWorth)}</div>
      </div>
      <p class="muted" style="margin-top:14px">Každá možnosť je zaťažená rovnakým vstupným kapitálom (${fmt(res.commonUpfront)}) aj rovnakým mesačným rozpočtom (${fmt(res.monthlyBudget)}). To, čo možnosť nespotrebuje, sa investuje pri ${pct(state.profile.altReturnRatePercent)} ročne.</p>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="eyebrow">Ako vznikli skóre faktorov</div>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:12px">
          ${Object.keys(FACTOR_NAMES).map((k) => `
            <div style="padding-bottom:10px;border-bottom:1px solid var(--border)">
              <div class="between" style="align-items:baseline">
                <strong>${FACTOR_NAMES[k]}</strong>
                <span class="num" style="font-weight:600">${buy.scores[k].toFixed(1).replace('.', ',')}</span>
              </div>
              <p class="muted" style="margin-top:4px">${esc(buy.explanations[k])}</p>
            </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="eyebrow">Pôvod čísel</div>
        <div style="margin-top:12px">
          ${srcRow(rates.stale ? 'stale' : 'data', 'Úrok hypotéky', pct(rates.get('mortgage30')), 'FRED')}
          ${srcRow(rates.stale ? 'stale' : 'data', 'Zhodnotenie', pct(rates.get('homePriceIndex')), 'FRED')}
          ${srcRow('profile', 'Alternatívny výnos', pct(state.profile.altReturnRatePercent), 'profil')}
          ${srcRow('profile', 'Investičná disciplína', state.profile.investmentDisciplinePercent + ' %', 'profil')}
          ${srcRow('manual', 'Nájom', fmt(d.rent), 'ručne')}
          ${srcRow('manual', 'Cena bytu', fmt(d.homePrice), 'ručne')}
        </div>
        <p class="muted" style="margin-top:12px">Plná značka znamená z dát, polovičná z profilu, prázdna zadané ručne, prerušovaná zastarané. Význam nesie tvar, nie farba.</p>
      </div>
    </div>

    <p class="muted">Model neobsahuje dane, PMI pri akontácii pod 20 %, ani očistenie o infláciu. Všetky sumy sú nominálne.</p>
  </div>`;
}

function screenProfile() {
  const p = state.profile;
  const warn = p.investmentDisciplinePercent >= 90
    ? 'Pri takmer plnej disciplíne vychádza nájom najvýhodnejšie. Väčšina ľudí sa k tomu v skutočnosti nepriblíži.'
    : p.investmentDisciplinePercent >= 60
      ? 'Realistická hodnota. Výhoda nájmu klesá oproti bežným kalkulačkám zhruba o tretinu.'
      : 'Pri nízkej disciplíne kúpa väčšinou vyhráva — hypotéka funguje ako nútené sporenie.';

  const word = (v) => v >= 9 ? 'Zásadné' : v >= 7 ? 'Veľmi dôležité' : v >= 4 ? 'Stredne' : v >= 1 ? 'Skôr nie' : 'Nezáleží';

  return `
  <div class="stack">
    <div>
      <h1>Čo je pre vás dôležité</h1>
      <p class="body" style="margin-top:8px;max-width:760px">Každé rozhodnutie hodnotíme v štyroch oblastiach. Váhou poviete, koľko ktorá pre vás znamená — a podľa toho sa zmení, ktorá možnosť vyjde ako najvhodnejšia. Neexistuje správne nastavenie, existuje len vaše.</p>
      <p class="muted" style="margin-top:6px;max-width:760px">Ak dáte všetkým štyrom rovnako, rozhoduje priemer. Ak niečomu dáte nulu, do výsledku sa to vôbec nezaráta.</p>
    </div>

    <div class="card" style="display:flex;flex-direction:column;gap:18px">
      ${Object.keys(FACTOR_NAMES).map((k) => {
        const info = FACTOR_INFO[k];
        const v = p.weights[k];
        return `
        <div class="field" style="gap:8px;padding-bottom:18px;border-bottom:1px solid var(--border)">
          <div class="between" style="align-items:baseline">
            <label for="w-${k}"><strong style="color:var(--text-ink);font-size:16px">${FACTOR_NAMES[k]}</strong></label>
            <span class="muted">${word(v)} · ${v}/10</span>
          </div>
          <p class="body" style="font-size:13px;max-width:640px">${info.what}</p>
          <p class="muted" style="font-size:12px;max-width:640px">${info.how}</p>
          <input id="w-${k}" type="range" min="0" max="10" step="1" value="${v}" data-weight="${k}">
          <p class="muted" style="font-size:12px">${v >= 6 ? info.high : v <= 3 ? info.low : 'Stredná váha — tento faktor sa uplatní, ale nerozhodne sám.'}</p>
        </div>`;
      }).join('')}
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Kam by ste reálne dali ušetrené peniaze?</h3>
        <p class="muted" style="margin:6px 0 14px">Toto určuje alternatívny výnos — najsilnejšiu páku celého modelu. Nepýtame sa na percentá, ale na správanie.</p>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${ALT_CHOICES.map((c) => `
            <button class="tile" type="button" data-alt="${c.id}" aria-pressed="${c.id === p.altChoice}" style="flex-direction:row;justify-content:space-between;align-items:center;min-height:60px;text-align:left">
              <span><span class="l">${c.label}</span><br><span class="s">${c.hint}</span></span>
              <strong class="num">${c.rate.toFixed(1).replace('.', ',')} %</strong>
            </button>`).join('')}
        </div>
      </div>

      <div class="card">
        <h3>Koľko z úspory naozaj odložíte?</h3>
        <p class="muted" style="margin:6px 0 14px">Buďte k sebe úprimní. Bežné kalkulačky predpokladajú 100 % a tým systematicky nadhodnocujú nájom.</p>
        <div style="font-family:var(--font-display);font-size:40px;font-weight:600;color:var(--accent)">${p.investmentDisciplinePercent} %</div>
        <input type="range" min="10" max="100" step="10" value="${p.investmentDisciplinePercent}" data-discipline style="margin-top:10px">
        <div class="banner warn" style="margin-top:14px;padding:14px 16px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="flex-shrink:0;margin-top:2px" aria-hidden="true"><path d="M12 9v4M12 16.5v.5"></path><circle cx="12" cy="12" r="9"></circle></svg>
          <p style="font-size:13px">${warn}</p>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="between" style="align-items:center">
        <div>
          <h3>Vzhľad</h3>
          <p class="muted" style="margin-top:4px">Tmavý režim sleduje systém, ak ho neprepnete ručne.</p>
        </div>
        <div class="seg">
          <button type="button" data-theme="auto" aria-pressed="${!localStorage.getItem('rozvaha.theme')}">Systém</button>
          <button type="button" data-theme="light" aria-pressed="${localStorage.getItem('rozvaha.theme') === 'light'}">Svetlý</button>
          <button type="button" data-theme="dark" aria-pressed="${localStorage.getItem('rozvaha.theme') === 'dark'}">Tmavý</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* --------------------------------------------------------------- router */

const ROUTES = {
  '#/': screenHome,
  '#/kategoria': screenCategory,
  '#/moznosti': screenOptions,
  '#/vstupy': screenInputs,
  '#/vysledok': screenResult,
  '#/vypocet': screenBreakdown,
  '#/profil': screenProfile
};

const NAV = [
  { href: '#/', label: 'Prehľad', icon: 'M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z' },
  { href: '#/kategoria', label: 'Nové', icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v8M8 12h8' },
  { href: '#/profil', label: 'Profil', icon: 'M5 12h3M16 12h3M10 7h9M5 7h2M13 17h6M5 17h5' }
];

function currentRoute() {
  const h = location.hash || '#/';
  return ROUTES[h] ? h : '#/';
}

function navHtml(current) {
  const active = (href) => (href === current || (href === '#/kategoria' && ['#/moznosti', '#/vstupy'].includes(current)) ? ' aria-current="page"' : '');
  return {
    side: NAV.map((n) => `<a href="${n.href}"${active(n.href)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="${n.icon}"></path></svg>${n.label === 'Nové' ? 'Nové rozhodnutie' : n.label === 'Profil' ? 'Váš profil' : n.label}</a>`).join(''),
    tabs: NAV.map((n) => `<a href="${n.href}"${active(n.href)}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="${n.icon}"></path></svg>${n.label}</a>`).join('')
  };
}

function render() {
  const route = currentRoute();
  const nav = navHtml(route);
  const freshness = rates.stale
    ? `<div class="t"><span class="dot warn"></span>Dáta nie sú čerstvé</div><div class="d">${rates.failed ? 'Snímok sa nepodarilo načítať.' : `Posledný snímok pred ${rates.ageDays} dňami.`}</div>`
    : `<div class="t"><span class="dot"></span>Dáta aktuálne</div><div class="d">Snímok z ${rates.fetchedAt.toLocaleDateString('sk-SK')}. Obnovuje sa každý deň cez GitHub Action.</div>`;

  document.getElementById('app').innerHTML = `
    <aside class="shell">
      <div class="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M12 3v18M12 8l6-3M12 8L6 5"></path><circle cx="19.5" cy="12.5" r="3"></circle><circle cx="4.5" cy="12.5" r="3"></circle></svg>
        Rozvaha
      </div>
      <nav class="nav">${nav.side}</nav>
      <div class="shell-foot">${freshness}</div>
    </aside>
    <main class="main" id="main">${ROUTES[route]()}</main>
    <nav class="tabs">${nav.tabs}</nav>`;

  document.title = 'Rozvaha — ' + (route === '#/' ? 'prehľad' : route.replace('#/', ''));
}

/* --------------------------------------------------------------- vstupy */

function onInput(e) {
  const t = e.target;
  if (t.dataset.draft) return update((s) => { s.draft[t.dataset.draft] = +t.value; });
  if (t.dataset.draftNum) return update((s) => { s.draft[t.dataset.draftNum] = Math.max(0, +t.value || 0); });
  if (t.dataset.weight) return update((s) => { s.profile.weights[t.dataset.weight] = +t.value; });
  if ('discipline' in t.dataset) return update((s) => { s.profile.investmentDisciplinePercent = +t.value; });
}

function onClick(e) {
  const t = e.target.closest('button, a[data-open]');
  if (!t) return;

  if (t.dataset.category) return update((s) => { s.draft.category = t.dataset.category; });
  if (t.dataset.years) return update((s) => { s.draft.years = +t.dataset.years; });
  if (t.dataset.lives) return update((s) => { s.draft.lives[t.dataset.lives] = t.dataset.value === '1'; });
  if (t.dataset.alt) {
    const c = ALT_CHOICES.find((x) => x.id === t.dataset.alt);
    return update((s) => { s.profile.altChoice = c.id; s.profile.altReturnRatePercent = c.rate; });
  }
  if (t.dataset.theme) {
    const v = t.dataset.theme;
    if (v === 'auto') { localStorage.removeItem('rozvaha.theme'); document.documentElement.removeAttribute('data-theme'); }
    else { localStorage.setItem('rozvaha.theme', v); document.documentElement.setAttribute('data-theme', v); }
    return render();
  }
  if ('save' in t.dataset) {
    return update((s) => {
      s.decisions.unshift({
        title: 'Nájom, kúpa alebo stavba',
        savedAt: new Date().toLocaleDateString('sk-SK'),
        draft: structuredClone(s.draft)
      });
      location.hash = '#/';
    });
  }
  if (t.dataset.open !== undefined) {
    const dec = state.decisions[+t.dataset.open];
    if (dec) update((s) => { s.draft = structuredClone(dec.draft); });
  }
}

/* ----------------------------------------------------------------- štart */

(async function init() {
  const saved = localStorage.getItem('rozvaha.theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  rates = await loadRates();
  render();

  window.addEventListener('hashchange', render);
  document.addEventListener('input', onInput);
  document.addEventListener('click', onClick);
})();
