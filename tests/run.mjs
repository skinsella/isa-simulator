// Closed-form sanity checks and golden-number tests for the SIA simulator.
// Run with: `node tests/run.mjs`
//
// These exist to catch silent regressions when the simulation is edited.
// Each test has a tolerance — modelling code uses iterative gross-ups and
// quarter-by-quarter compounding, so exact equality is not always possible.

import {
  simTaxable, simISA, simTFSA, simISK, simNorway, simEU,
  normaliseParams, simulateAll, computeNPV, cumulativeReal,
} from '../js/sim.js';
import { DEFAULTS, PRESETS } from '../js/config.js';

let pass = 0, fail = 0;
const failures = [];

function approx(actual, expected, tolPct, label) {
  const diff = Math.abs(actual - expected);
  const tol  = Math.max(1e-6, Math.abs(expected) * tolPct);
  if (diff <= tol) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(`  ✗ ${label}\n      expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (diff ${diff.toFixed(2)}, tol ${tol.toFixed(2)})`);
  }
}

function group(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// --- Closed-form: UK ISA with flat contributions and no fees ---
// FV = C * ((1+r)^n − 1) / r  (annuity-immediate, contribution at start of year then full year growth)
group('UK ISA — closed-form annuity FV', () => {
  const raw = { ...DEFAULTS, contrib: 5000, contribGrowth: 0, horizon: 20,
    annualReturn: 5, divYield: 0, fee: 0, withdraw: 0 };
  const p = normaliseParams(raw);
  const result = simISA(p);
  const r = 0.05;
  const expected = 5000 * (Math.pow(1 + r, 20) - 1) / r * (1 + r);
  // The simulator adds the contribution first then grows for the full year,
  // so each contribution earns one extra year of growth — annuity-due form.
  approx(result.bal[19], expected, 1e-9, 'ISA balance at year 20 matches annuity-due FV');
  approx(result.cumTax[19], 0, 1e-9, 'ISA cumulative tax is exactly zero');
});

// --- Closed-form: Taxable equity wrapper with no dividends, no exemption ---
// Pure CGT on terminal gain. With C/yr, n years, r return:
//   FV_gross = C * ((1+r)^n - 1)/r * (1+r)
//   Tax = (FV_gross - n*C) * cgt
group('Taxable (equity) — no-div pure CGT', () => {
  const raw = { ...DEFAULTS, taxMode: 'equity', contrib: 5000, contribGrowth: 0,
    horizon: 15, annualReturn: 5, divYield: 0, fee: 0, cgtExempt: 0,
    incTax: 0, withdraw: 0 };
  const p = normaliseParams(raw);
  const result = simTaxable(p);
  const r = 0.05;
  const fvGross = 5000 * (Math.pow(1 + r, 15) - 1) / r * (1 + r);
  const expectedTax = (fvGross - 15 * 5000) * 0.33;
  const expectedNet = fvGross - expectedTax;
  approx(result.bal[14], expectedNet, 1e-9, 'Net balance = gross FV − CGT on terminal gain');
  approx(result.cumTax[14], expectedTax, 1e-9, 'Cumulative tax = CGT × gain');
});

// --- Norway shielding deduction: matches the example in the policy note ---
// €30,000 lump sum, 2.5% shielding rate, 8-year horizon.
// Shielding allowance after 8 years should be ≈ €6,552.
// We model this as a one-off contribution by setting baseContrib = 30000
// and horizon = 1 with subsequent zero-contribution years... actually
// the simulator contributes every year, so use a different setup:
// contribute 30k in year 1 only by setting baseContrib=30000, contribGrowth=-100%
// won't work; instead test by hand with a small wrapper.
group('Norway shielding — note example (30k @ 2.5% → 6,552 after 8y)', () => {
  // Manually run the shielding compounding to verify the formula:
  // shieldAccum_y = (basis + shieldAccum_{y-1}) * shieldRate  + shieldAccum_{y-1}
  // = shieldAccum_{y-1} * (1 + shieldRate) + basis * shieldRate
  // With basis fixed at 30k:
  let shieldAccum = 0;
  const basis = 30000;
  for (let y = 0; y < 8; y++) {
    shieldAccum = shieldAccum * (1 + 0.025) + basis * 0.025;
  }
  const expected = 30000 * (Math.pow(1.025, 8) - 1);
  approx(shieldAccum, expected, 1e-6, 'Compounded shielding formula gives 30,000·((1.025)^8 − 1)');
  approx(expected, 6552, 1e-3, 'Note value ≈ €6,552 (note rounds)');
});

// --- ISK: zero return, no contributions, no threshold → tax = bal * notional * rate ---
group('ISK — flat-balance benchmark', () => {
  // Start with €100k existing balance is not directly supported, so simulate
  // a single year with 0 contribution and 0 return to verify the formula on
  // the base case. With no contributions in year 1, capital base = bal/4 * 4
  // initially zero; not useful. Instead test: 1 year, big contrib, 0 return.
  // capital base = (Q1=0 + Q2=qDep*qR + Q3=(qDep*qR+qDep)*qR + Q4 + yearContrib)/4
  // With r=0: qR=1, Q1=0, Q2=qDep, Q3=2qDep, Q4=3qDep, deps=4qDep
  // base = (0 + qDep + 2qDep + 3qDep + 4qDep) / 4 = 10qDep/4 = 2.5*qDep = 2.5*contrib/4 = contrib*0.625
  const raw = { ...DEFAULTS, contrib: 40000, contribGrowth: 0, horizon: 1,
    annualReturn: 0, divYield: 0, fee: 0, iskRate: 3, iskTaxRate: 30,
    iskThreshold: 0, withdraw: 0 };
  const p = normaliseParams(raw);
  const result = simISK(p);
  const expectedBase = 40000 * 0.625;
  const expectedTax = expectedBase * 0.03 * 0.30;
  approx(result.annTax[0], expectedTax, 1e-9, 'Year-1 ISK tax with 0% return matches quarterly DCA formula');
});

// --- Withdrawal gross-up: net cash matches request ---
group('Withdrawal gross-up correctness', () => {
  // ISA: withdrawal does not trigger tax, so balance falls by exactly wAmt.
  // Taxable fund: withdrawal should pay tax on gain portion AND leave
  // (preBal - units sold) in the wrapper. The net cash to investor = wAmt.
  const raw = { ...DEFAULTS, contrib: 0, horizon: 5, withdraw: 1000,
    withdrawStart: 2, annualReturn: 6, divYield: 0, fee: 0 };
  // With 0 contribution the wrapper never funds the withdrawal. Use a setup
  // where the wrapper has been seeded. Easier: run the simulator and check
  // that the per-year balance change equals withdrawal + tax paid.
  const raw2 = { ...DEFAULTS, contrib: 10000, contribGrowth: 0, horizon: 10,
    annualReturn: 6, divYield: 0, fee: 0, withdraw: 5000, withdrawStart: 5,
    taxMode: 'fund', deemedYrs: 100 /* disable deemed disposal */ };
  const p2 = normaliseParams(raw2);
  const r = simTaxable(p2);
  // No tax-event before withdrawal starts at year 5 because deemedYrs=100.
  // At year 5: contribution adds 10k, growth at 6%, then 5k withdrawal triggers
  // tax on gain portion. Check: bal[5] − bal[4]*(1+0.06) − 10000 ≈ -(5000 + tax)
  const tax5 = r.annTax[4];
  // At year 5: bal_start = bal[3] + 10000; grow by r=6%; withdraw + pay tax.
  const change = r.bal[4] - (r.bal[3] + 10000) * 1.06;
  approx(change, -(5000 + tax5), 1e-6, 'Year-5 net wrapper change = -(wAmt + tax)');
});

// --- Comparative sanity: ISA ≥ Norway ≥ Taxable for all reasonable defaults ---
group('Wrapper ranking — ISA dominates Norway dominates Taxable', () => {
  const raw = { ...DEFAULTS, contrib: 6000, horizon: 30, annualReturn: 6,
    divYield: 2, fee: 0.5, withdraw: 0 };
  const all = simulateAll(raw);
  const h = raw.horizon - 1;
  if (all.isa.bal[h] >= all.no.bal[h]) {
    pass++; console.log('  ✓ ISA net wealth ≥ Norway net wealth');
  } else {
    fail++; failures.push(`  ✗ ISA (${all.isa.bal[h].toFixed(0)}) < Norway (${all.no.bal[h].toFixed(0)})`);
  }
  if (all.no.bal[h] >= all.taxable.bal[h]) {
    pass++; console.log('  ✓ Norway net wealth ≥ Taxable net wealth');
  } else {
    fail++; failures.push(`  ✗ Norway (${all.no.bal[h].toFixed(0)}) < Taxable (${all.taxable.bal[h].toFixed(0)})`);
  }
});

// --- NPV invariance: NPV at nominal rate equals NPV at real rate on deflated stream ---
group('NPV currency-invariance', () => {
  const stream = [100, 105, 110, 115, 120, 125, 130];
  const stateRate = 0.04;
  const inflation = 0.02;
  const nominalNPV = computeNPV(stream, stateRate);
  const realRate = (1 + stateRate) / (1 + inflation) - 1;
  const realStream = stream.map((v, i) => v / Math.pow(1 + inflation, i + 1));
  const realNPV = computeNPV(realStream, realRate);
  approx(realNPV, nominalNPV, 1e-9, 'NPV(nominal stream, nominal rate) = NPV(real stream, real rate)');
});

// --- Cumulative real: matches manual computation ---
group('Cumulative real terms', () => {
  const stream = [100, 100, 100];
  const inflation = 0.05;
  const real = cumulativeReal(stream, inflation, true);
  const expected = 100/1.05 + 100/Math.pow(1.05,2) + 100/Math.pow(1.05,3);
  approx(real, expected, 1e-9, '3 × 100 deflated at 5% = correct geometric series');
  const nominal = cumulativeReal(stream, inflation, false);
  approx(nominal, 300, 1e-9, 'Showreal=false returns raw sum');
});

// --- Golden numbers for default preset (regression guard) ---
group('Golden numbers — defaults preset', () => {
  const all = simulateAll(DEFAULTS);
  const h = DEFAULTS.horizon - 1;
  // These golden values are computed once and pinned; any deviation means
  // the simulation has changed. Update only when intentional.
  // Computed against v1.1.0 of the model. €6k contrib < €7k TFSA room and
  // < €10k EU allowance and < €20k ISA allowance, so all three are unconstrained.
  approx(all.taxable.bal[h], 308659.04, 0.001, 'Taxable (fund) net @ y30');
  approx(all.isa.bal[h],     438026.57, 0.001, 'ISA net @ y30');
  approx(all.tfsa.bal[h],    438026.57, 0.001, 'TFSA net @ y30 (matches ISA at €6k contrib)');
  approx(all.isk.bal[h],     363260.31, 0.001, 'ISK net @ y30');
  approx(all.no.bal[h],      383302.58, 0.001, 'Norway net @ y30');
  approx(all.eu.bal[h],      349529.35, 0.001, 'EU net @ y30 (50% exempt)');
  approx(all.taxable.cumTax[h], 89407.13, 0.001, 'Taxable total tax @ y30');
  approx(all.isk.cumTax[h],     41951.61, 0.001, 'ISK total tax @ y30');
  approx(all.no.cumTax[h],      54723.99, 0.001, 'Norway total tax @ y30');
});

// --- Lifetime preset behaves sanely ---
group('Lifetime preset — 0-66 with contribution growth', () => {
  const raw = { ...DEFAULTS, ...PRESETS.lifetime };
  const all = simulateAll(raw);
  const h = raw.horizon - 1;
  // ISA should be the largest. Norway should beat both ISK and Taxable.
  if (all.isa.bal[h] === Math.max(...['taxable','isa','tfsa','isk','no','eu'].map(k => all[k].bal[h]))) {
    pass++; console.log('  ✓ ISA is the largest wrapper');
  } else {
    fail++; failures.push(`  ✗ ISA not largest under lifetime preset`);
  }
});

console.log('\n────────────────────');
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
