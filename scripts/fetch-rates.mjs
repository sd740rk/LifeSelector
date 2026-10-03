/**
 * Stiahne posledné hodnoty zo série FRED a zapíše data/rates.json.
 * Beží len v GitHub Action — kľúč je v repozitárnych secrets, nikdy v prehliadači.
 *
 * Lokálne:  FRED_API_KEY=xxx node scripts/fetch-rates.mjs
 * Kľúč zadarmo: https://fred.stlouisfed.org/docs/api/api_key.html
 */
import { writeFile, readFile } from 'node:fs/promises';

const KEY = process.env.FRED_API_KEY;
if (!KEY) {
  console.error('Chýba FRED_API_KEY. Pridajte ho do Settings → Secrets → Actions.');
  process.exit(1);
}

const SERIES = {
  mortgage30:     { id: 'MORTGAGE30US',   label: '30-ročná fixná hypotéka' },
  treasury10:     { id: 'DGS10',          label: '10-ročný štátny dlhopis' },
  homePriceIndex: { id: 'CSUSHPINSA',     label: 'Zhodnotenie nehnuteľností (medziročne)', yoy: true },
  cpiRent:        { id: 'CUSR0000SEHA',   label: 'Rast nájmu (CPI bývanie)', yoy: true }
};

async function observations(id, limit) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}`
    + `&api_key=${KEY}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const json = await res.json();
  return (json.observations || []).filter((o) => o.value !== '.');
}

const out = { fetchedAt: new Date().toISOString(), source: 'FRED (Federal Reserve Bank of St. Louis)', series: {} };
let failures = 0;

for (const [key, def] of Object.entries(SERIES)) {
  try {
    // Pri medziročnej zmene potrebujeme 13 mesiacov, inak stačí posledná hodnota.
    const obs = await observations(def.id, def.yoy ? 14 : 1);
    if (!obs.length) throw new Error('žiadne pozorovania');

    let value;
    if (def.yoy) {
      const now = Number(obs[0].value);
      const yearAgo = Number(obs[Math.min(12, obs.length - 1)].value);
      value = Number((((now - yearAgo) / yearAgo) * 100).toFixed(2));
    } else {
      value = Number(Number(obs[0].value).toFixed(2));
    }

    out.series[key] = {
      value,
      unit: '%',
      label: def.label,
      seriesId: def.id,
      observedOn: obs[0].date,
      sourceUrl: `https://fred.stlouisfed.org/series/${def.id}`
    };
    console.log(`${def.id}: ${value} % (${obs[0].date})`);
  } catch (err) {
    failures++;
    console.error(`${def.id} zlyhalo: ${err.message}`);
  }
}

// Čo sa nepodarilo stiahnuť, prenesieme z predchádzajúceho snímku — appka to
// zobrazí ako zastarané, nedosadí to ticho.
if (failures) {
  try {
    const prev = JSON.parse(await readFile('data/rates.json', 'utf8'));
    for (const key of Object.keys(SERIES)) {
      if (!out.series[key] && prev.series[key]) out.series[key] = prev.series[key];
    }
  } catch { /* prvý beh */ }
}

if (!Object.keys(out.series).length) {
  console.error('Nepodarilo sa stiahnuť nič, rates.json nechávam tak.');
  process.exit(1);
}

await writeFile('data/rates.json', JSON.stringify(out, null, 2) + '\n');
console.log(`Hotovo, ${failures} zlyhaní.`);
