/**
 * Dátová vrstva.
 *
 * Stránka beží staticky na GitHub Pages, takže FRED sa nevolá z prehliadača —
 * kľúč by bol verejný. Snímok sadzieb sťahuje GitHub Action raz denne a commitne
 * ho ako data/rates.json. Tu ho len načítame a odvodíme vek dát.
 *
 * Vek dát je prvotriedna hodnota, nie technický detail: ovplyvňuje zobrazenú
 * presnosť na troch miestach v rozhraní.
 */

const FALLBACK = {
  fetchedAt: null,
  source: 'Zabudované záložné hodnoty',
  series: {
    mortgage30: { value: 6.65, label: '30-ročná fixná hypotéka', seriesId: 'MORTGAGE30US' },
    treasury10: { value: 4.1, label: '10-ročný štátny dlhopis', seriesId: 'DGS10' },
    homePriceIndex: { value: 4.0, label: 'Zhodnotenie nehnuteľností', seriesId: 'CSUSHPINSA' },
    cpiRent: { value: 3.0, label: 'Rast nájmu', seriesId: 'CUSR0000SEHA' }
  }
};

/** Koľko dní je snímok starý. Nad 8 dní považujeme za zastaraný (PMMS vychádza vo štvrtok). */
export const STALE_AFTER_DAYS = 8;

export async function loadRates() {
  try {
    const res = await fetch('data/rates.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return decorate(json, false);
  } catch (err) {
    console.warn('Snímok sadzieb sa nepodarilo načítať:', err);
    return decorate(FALLBACK, true);
  }
}

function decorate(data, failed) {
  const fetchedAt = data.fetchedAt ? new Date(data.fetchedAt) : null;
  const ageDays = fetchedAt
    ? Math.max(0, Math.floor((Date.now() - fetchedAt.getTime()) / 86400000))
    : null;
  const stale = failed || ageDays === null || ageDays > STALE_AFTER_DAYS;

  return {
    ...data,
    fetchedAt,
    ageDays,
    stale,
    failed,
    get: (key) => (data.series[key] ? data.series[key].value : null),
    meta: (key) => data.series[key] || null
  };
}

/** Provenancia hodnoty: tvar značky nesie pôvod, farba nie. */
export const ORIGIN = {
  data: { shape: 'full', word: 'z dát' },
  profile: { shape: 'half', word: 'z profilu' },
  manual: { shape: 'ring', word: 'zadané ručne' },
  stale: { shape: 'dashed', word: 'zastarané' }
};

export function markerSvg(origin, size = 13) {
  const shape = (ORIGIN[origin] || ORIGIN.manual).shape;
  const inner = {
    full: '<circle cx="8" cy="8" r="5.5" fill="currentColor"></circle>',
    half: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"></circle><path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor"></path>',
    ring: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"></circle>',
    dashed: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.2 2"></circle>'
  }[shape];
  return `<svg class="marker" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${inner}</svg>`;
}

export function originWord(origin) {
  return (ORIGIN[origin] || ORIGIN.manual).word;
}
