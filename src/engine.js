/**
 * Rozvaha — výpočtový engine (port engine-v2.ts do čistého JS pre prehliadač).
 *
 * Tri vrstvy:
 *   1. runProjection()      mesačná simulácia -> čisté imanie v čase
 *   2. translateToFactors() surové dáta + benchmarky -> skóre 0–10
 *   3. computeFitScore()    skóre + váhy z profilu -> osobný fit
 *
 * Bez závislostí, bez I/O. Rovnaká logika ako serverová verzia.
 */

const clamp = (n, min = 0, max = 10) => Math.max(min, Math.min(max, n));

export function monthlyMortgagePayment(f) {
  if (!f || f.principal <= 0) return 0;
  const r = f.annualRatePercent / 100 / 12;
  if (r === 0) return f.principal / f.termMonths;
  return (f.principal * r) / (1 - Math.pow(1 + r, -f.termMonths));
}

const sumUpfront = (o) =>
  (o.financialInputs.upfrontCosts || []).reduce((s, c) => s + c.amount, 0);

export function monthOneOutflow(o, housingCost) {
  const f = o.financialInputs;
  const pmt = f.financing ? monthlyMortgagePayment(f.financing) : 0;
  const flows = (f.recurringCashFlows || []).reduce(
    (s, cf) => s + (cf.type === 'cost' ? cf.monthlyAmount : -cf.monthlyAmount),
    0
  );
  const housing = !o.providesHousing && housingCost ? housingCost.monthlyAmount : 0;
  return pmt + flows + housing;
}

/**
 * Každá možnosť je zaťažená rovnakým mesačným rozpočtom aj rovnakým vstupným
 * kapitálom. To, čo nespotrebuje, sa investuje pri alternatívnom výnose —
 * v tom je oportunitný náklad vyjadrený explicitne.
 */
export function runProjection(option, opts) {
  const {
    timeHorizonYears,
    altReturnRatePercent,
    housingCost,
    monthlyBudget,
    commonUpfront,
    investmentDisciplinePercent
  } = opts;

  const months = timeHorizonYears * 12;
  const monthlyAlt = altReturnRatePercent / 100 / 12;
  const discipline = (investmentDisciplinePercent ?? 100) / 100;
  const fin = option.financialInputs;

  const upfront = sumUpfront(option);
  const common = commonUpfront ?? upfront;
  const financing = fin.financing || null;
  const pmt = financing ? monthlyMortgagePayment(financing) : 0;
  const m1 = monthOneOutflow(option, housingCost);
  const budget = monthlyBudget ?? m1;

  let loanBalance = financing ? financing.principal : 0;
  let side = Math.max(common - upfront, 0);
  let totalCashSpent = upfront;
  const netWorthByYear = [];

  const flows = (fin.recurringCashFlows || []).map((cf) => ({
    type: cf.type,
    current: cf.monthlyAmount,
    growth: (cf.annualGrowthRatePercent ?? 0) / 100
  }));

  let housingCurrent =
    !option.providesHousing && housingCost ? housingCost.monthlyAmount : 0;
  const housingGrowth = housingCost ? housingCost.annualGrowthRatePercent / 100 : 0;

  const assetValueAt = (y) =>
    fin.asset
      ? fin.asset.initialValue * Math.pow(1 + fin.asset.appreciationRatePercent / 100, y)
      : 0;

  const equityAt = (y) => {
    if (!fin.asset) return 0;
    const v = assetValueAt(y);
    const sell = fin.exitCost ? v * (fin.exitCost.percentOfAssetValue / 100) : 0;
    return v - loanBalance - sell;
  };

  for (let m = 0; m < months; m++) {
    if (m > 0 && m % 12 === 0) {
      for (const f of flows) f.current *= 1 + f.growth;
      housingCurrent *= 1 + housingGrowth;
    }

    let outflow = 0;
    if (financing && m < financing.termMonths && loanBalance > 0) {
      const r = financing.annualRatePercent / 100 / 12;
      const interest = loanBalance * r;
      const principal = Math.min(pmt - interest, loanBalance);
      loanBalance -= principal;
      outflow += pmt;
    }
    for (const f of flows) outflow += f.type === 'cost' ? f.current : -f.current;
    outflow += housingCurrent;

    totalCashSpent += Math.max(outflow, 0);
    side = (side + (budget - outflow) * discipline) * (1 + monthlyAlt);

    if ((m + 1) % 12 === 0) {
      const year = (m + 1) / 12;
      netWorthByYear.push({ year, value: equityAt(year) + side - common });
    }
  }

  const netEquityAtExit = equityAt(timeHorizonYears);
  const finalNetWorth = netEquityAtExit + side - common;
  const base = Math.max(common, 1);
  const annualizedReturnPercent =
    (Math.pow(Math.max(finalNetWorth + base, 1) / base, 1 / timeHorizonYears) - 1) * 100;

  return {
    netWorthByYear,
    finalNetWorth,
    annualizedReturnPercent,
    totalCashSpent,
    netEquityAtExit,
    sidePortfolioAtExit: side,
    loanBalanceAtExit: loanBalance,
    assetValueAtExit: assetValueAt(timeHorizonYears),
    monthOneOutflow: m1
  };
}

/** Surové, jednotkové dáta -> porovnateľné skóre 0–10 oproti benchmarkom. */
export function translateToFactors(option, projection, benchmarks) {
  const { annualizedReturnFloorPercent: floor, annualizedReturnCeilingPercent: ceil } =
    benchmarks.financial;
  const financial = clamp(
    ((projection.annualizedReturnPercent - floor) / (ceil - floor)) * 10
  );

  const { exitCostMaxPercent, lockInMaxMonths } = benchmarks.flexibility;
  const raw = option.rawFactorInputs;
  const exitPenalty = 5 * (Math.min(raw.exitCostPercent, exitCostMaxPercent) / exitCostMaxPercent);
  const lockPenalty = 5 * (Math.min(raw.lockInMonths, lockInMaxMonths) / lockInMaxMonths);
  const flexibility = clamp(10 - exitPenalty - lockPenalty);

  const volNorm = raw.costVolatility / benchmarks.stability.volatilityScaleMax;
  const stability = clamp((1 - volNorm) * 10 * 0.7 + (raw.confidencePercent / 100) * 10 * 0.3);

  const checklist = (option.selfRatedFactors && option.selfRatedFactors.lifestyleChecklist) || [];
  const earned = checklist.reduce((s, i) => s + i.value, 0);
  const maxPossible = checklist.length * 2 || 1;
  const lifestyle = clamp((earned / maxPossible) * 10);

  return {
    scores: { financial, flexibility, stability, lifestyle },
    explanations: {
      financial: `${projection.annualizedReturnPercent.toFixed(1).replace('.', ',')} % ročne, premietnuté na pásmo ${floor} až ${ceil} %.`,
      flexibility: `${raw.exitCostPercent} % náklad na výstup a ${raw.lockInMonths} mesiacov viazanosti, oproti benchmarku ${exitCostMaxPercent} % a ${lockInMaxMonths} mesiacov.`,
      stability: `Volatilita nákladov ${raw.costVolatility}/10 s váhou 70 % a ${raw.confidencePercent} % istota predpokladov s váhou 30 %.`,
      lifestyle: `Sebahodnotenie: ${earned} z ${maxPossible} možných bodov. Tento faktor sa zámerne neodvodzuje z trhových dát.`
    }
  };
}

export function computeFitScore(scores, w) {
  const total = w.financial + w.flexibility + w.stability + w.lifestyle;
  if (total === 0) return 0;
  return (
    (scores.financial * w.financial +
      scores.flexibility * w.flexibility +
      scores.stability * w.stability +
      scores.lifestyle * w.lifestyle) / total
  );
}

export function decidingFactor(a, b, w) {
  const keys = ['financial', 'flexibility', 'stability', 'lifestyle'];
  let best = keys[0], bestDelta = -Infinity;
  for (const k of keys) {
    const d = Math.abs(a[k] - b[k]) * w[k];
    if (d > bestDelta) { bestDelta = d; best = k; }
  }
  return best;
}

export function evaluateDecision(options, config) {
  const monthlyBudget = Math.max(
    ...options.map((o) => monthOneOutflow(o, config.housingCost))
  );
  const commonUpfront = Math.max(...options.map(sumUpfront));

  const results = options.map((option) => {
    const projection = runProjection(option, {
      timeHorizonYears: config.timeHorizonYears,
      altReturnRatePercent: config.altReturnRatePercent,
      housingCost: config.housingCost,
      investmentDisciplinePercent: config.investmentDisciplinePercent,
      monthlyBudget,
      commonUpfront
    });
    const { scores, explanations } = translateToFactors(option, projection, config.benchmarks);
    return { option, projection, scores, explanations, fitScore: computeFitScore(scores, config.weights) };
  });

  const ranked = [...results].sort((a, b) => b.fitScore - a.fitScore);
  const rankedFinancially = [...results].sort(
    (a, b) => b.projection.finalNetWorth - a.projection.finalNetWorth
  );

  return {
    results,
    ranked,
    rankedFinancially,
    monthlyBudget,
    commonUpfront,
    decidingFactor:
      ranked.length > 1 ? decidingFactor(ranked[0].scores, ranked[1].scores, config.weights) : null,
    moneyAndFitDisagree:
      ranked.length > 1 && ranked[0].option.id !== rankedFinancially[0].option.id
  };
}

/**
 * Bisekcia: hodnota premennej, pri ktorej si dve možnosti vymenia finančné
 * poradie. Vráti null, ak jedna možnosť dominuje v celom rozsahu.
 */
export function solveBreakeven(build, idA, idB, range, iterations = 38) {
  const delta = (x) => {
    const { options, config } = build(x);
    const res = evaluateDecision(options, config);
    const a = res.results.find((r) => r.option.id === idA);
    const b = res.results.find((r) => r.option.id === idB);
    if (!a || !b) throw new Error('solveBreakeven: možnosť sa nenašla');
    return a.projection.finalNetWorth - b.projection.finalNetWorth;
  };

  let lo = range.min, hi = range.max;
  const dLo = delta(lo), dHi = delta(hi);
  if (dLo === 0) return lo;
  if (dHi === 0) return hi;
  if (Math.sign(dLo) === Math.sign(dHi)) return null;

  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(delta(lo)) === Math.sign(delta(mid))) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
