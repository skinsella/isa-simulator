// Pure simulation functions. No DOM. Imported by ui.js and tests/run.mjs.
//
// Each simulator takes a normalised params object (all rates as decimals,
// not percentages — UI does the conversion) and returns:
//   {
//     bal:        Array<number>  per-year end-of-year net balance (after tax)
//     contrib:    Array<number>  cumulative contributions actually made
//     cumTax:     Array<number>  cumulative tax paid
//     annTax:     Array<number>  tax paid in each year
//     grossVal:   number         counterfactual no-tax FV
//     totalContrib: number       total contributed at horizon
//   }
//
// All arrays have length === horizon.

// ----- helpers ---------------------------------------------------------------

// Compute "units to sell" so that net cash to investor = wAmt, given a flat
// tax rate `t` on the gain portion only (gainRatio of each unit is gain).
//   Sell U units. Gain = U * gainRatio. Tax = gain * t. Net = U - tax.
//   U = wAmt / (1 - gainRatio * t).
// Bounded above by balance.
function grossUpUnits(wAmt, preBal, basis, taxRate) {
  if (wAmt <= 0 || preBal <= 0) return { units: 0, tax: 0 };
  const gainRatio = preBal > basis ? (preBal - basis) / preBal : 0;
  const effTax = gainRatio * taxRate;
  let U = wAmt / Math.max(1e-9, 1 - effTax);
  if (U > preBal) U = preBal;
  const tax = U * gainRatio * taxRate;
  return { units: U, tax, gainRatio };
}

// Net annual return after fees. Fees are a proportional AUM drag, so they
// reduce both the dividend and capital-growth components.
export function netReturn(nominalReturn, fee) {
  return nominalReturn - fee;
}

// ----- wrappers --------------------------------------------------------------

// Taxable Irish baseline: either fund wrapper (41% exit tax, 8-year deemed
// disposal, no annual dividend tax — the realistic ETF case) or direct equity
// (income tax on dividends, CGT on disposal with annual exemption).
export function simTaxable(p) {
  const {
    horizon, baseContrib, contribGrowthRate, r, divY,
    taxMode, exitTax, deemedYrs, incTax, cgtRate, cgtExempt,
    withdrawAmt, withdrawStart,
  } = p;

  let bal = 0, basis = 0, totalContrib = 0;
  const balArr = [], contribArr = [], cumTaxArr = [], annTaxArr = [];
  let cumTax = 0;
  let gross = 0;

  // For the fund wrapper, dividends are NOT taxed annually for an Irish
  // resident in an accumulating UCITS ETF. Tax events are 8-year deemed
  // disposal and final exit. For the equity wrapper, dividends are taxed
  // annually at the marginal rate; gains are taxed only on disposal.
  const netCapGrowth = r - divY;

  for (let y = 1; y <= horizon; y++) {
    const yearContrib = baseContrib * Math.pow(1 + contribGrowthRate, y - 1);
    const doWithdraw = y >= withdrawStart;
    const wAmt = doWithdraw ? withdrawAmt : 0;

    bal += yearContrib;
    basis += yearContrib;
    totalContrib += yearContrib;
    let annual = 0;

    if (taxMode === 'fund') {
      bal *= (1 + r); // no annual tax inside the fund wrapper

      if (y % deemedYrs === 0) {
        const gain = bal - basis;
        if (gain > 0) {
          const tax = gain * exitTax;
          bal -= tax;
          annual += tax;
          // Approximation: reset basis to post-tax value. The exact Irish
          // rule credits the tax paid against a future actual disposal;
          // resetting basis gives the same long-run result for monotonically
          // rising assets and avoids tracking per-tranche credits.
          basis = bal;
        }
      }

      if (wAmt > 0) {
        const preBal = bal;
        const { units, tax } = grossUpUnits(wAmt, preBal, basis, exitTax);
        if (units > 0) {
          basis *= (1 - units / preBal);
          bal -= units;
          annual += tax;
        }
      }
    } else {
      // Direct equities: tax dividends each year at marginal rate, CGT on disposal.
      const div = bal * divY;
      const cap = bal * netCapGrowth;
      const divTax = div * incTax;
      bal += div - divTax + cap;
      annual += divTax;

      if (wAmt > 0) {
        const preBal = bal;
        // Effective tax on gain portion (after annual exemption applied below).
        const gainRatio = preBal > basis ? (preBal - basis) / preBal : 0;
        let U = wAmt / Math.max(1e-9, 1 - gainRatio * cgtRate);
        if (U > preBal) U = preBal;
        const rawGain = U * gainRatio;
        const taxableGain = Math.max(0, rawGain - cgtExempt);
        const tax = taxableGain * cgtRate;
        basis *= (1 - U / preBal);
        bal -= U;
        annual += tax;
      }
    }

    cumTax += annual;
    balArr.push(bal);
    contribArr.push(totalContrib);
    annTaxArr.push(annual);
    cumTaxArr.push(cumTax);

    gross += yearContrib;
    if (wAmt > 0 && gross > wAmt) gross -= wAmt;
    gross *= (1 + r);
  }

  // Terminal disposal — tax remaining unrealised gain.
  const termGain = bal - basis;
  if (termGain > 0) {
    let finalTax;
    if (taxMode === 'fund') finalTax = termGain * exitTax;
    else                    finalTax = Math.max(0, termGain - cgtExempt) * cgtRate;
    bal -= finalTax;
    cumTax += finalTax;
    balArr[horizon - 1] = bal;
    cumTaxArr[horizon - 1] = cumTax;
    annTaxArr[horizon - 1] += finalTax;
  }

  return { bal: balArr, contrib: contribArr, cumTax: cumTaxArr, annTax: annTaxArr,
           grossVal: gross, totalContrib };
}

// UK ISA: contributions capped at annual allowance (no carry-forward).
// Fully tax-free growth and withdrawals.
// Note: UK "flexible ISA" rules restore withdrawal room within the same
// tax year only — not across years. We do not model this intra-year flex.
export function simISA(p) {
  const { horizon, baseContrib, contribGrowthRate, r, isaAllow, withdrawAmt, withdrawStart } = p;
  let bal = 0, totalContrib = 0, gross = 0;
  const balArr = [], contribArr = [], cumTaxArr = [], annTaxArr = [];
  for (let y = 1; y <= horizon; y++) {
    const yearContrib = baseContrib * Math.pow(1 + contribGrowthRate, y - 1);
    const wAmt = y >= withdrawStart ? withdrawAmt : 0;
    const c = Math.min(yearContrib, isaAllow);
    bal += c; totalContrib += c;
    bal *= (1 + r);
    if (wAmt > 0 && bal > wAmt) bal -= wAmt;
    balArr.push(bal); contribArr.push(totalContrib);
    cumTaxArr.push(0); annTaxArr.push(0);
    gross += c;
    if (wAmt > 0 && gross > wAmt) gross -= wAmt;
    gross *= (1 + r);
  }
  return { bal: balArr, contrib: contribArr, cumTax: cumTaxArr, annTax: annTaxArr,
           grossVal: gross, totalContrib };
}

// Canada TFSA: annual room accumulates and carries forward; withdrawals
// restore room the following year (gross withdrawal amount, including gains).
export function simTFSA(p) {
  const { horizon, baseContrib, contribGrowthRate, r, tfsaAnnualRoom, withdrawAmt, withdrawStart } = p;
  let bal = 0, totalContrib = 0, unusedRoom = 0, restoredRoom = 0, gross = 0;
  const balArr = [], contribArr = [], cumTaxArr = [], annTaxArr = [];
  for (let y = 1; y <= horizon; y++) {
    const yearContrib = baseContrib * Math.pow(1 + contribGrowthRate, y - 1);
    const wAmt = y >= withdrawStart ? withdrawAmt : 0;
    unusedRoom += tfsaAnnualRoom + restoredRoom;
    restoredRoom = 0;
    const c = Math.min(yearContrib, unusedRoom);
    unusedRoom -= c;
    bal += c; totalContrib += c;
    bal *= (1 + r);
    let withdrawn = 0;
    if (wAmt > 0 && bal > wAmt) { bal -= wAmt; withdrawn = wAmt; }
    restoredRoom = withdrawn;
    balArr.push(bal); contribArr.push(totalContrib);
    cumTaxArr.push(0); annTaxArr.push(0);
    gross += c;
    if (wAmt > 0 && gross > wAmt) gross -= wAmt;
    gross *= (1 + r);
  }
  return { bal: balArr, contrib: contribArr, cumTax: cumTaxArr, annTax: annTaxArr,
           grossVal: gross, totalContrib };
}

// Sweden ISK: annual notional tax on the *kapitalunderlag*
// = (Q1 + Q2 + Q3 + Q4 quarter-opening balances + deposits during year) / 4
// less a tax-free threshold (SEK 150k from 2025 ≈ €13k).
//
// We simulate with quarterly compounding and uniform DCA. For steady
// contributions and steady returns this is exact; for lumpy contributions
// it understates tax slightly because we spread contributions evenly across
// quarters.
export function simISK(p) {
  const { horizon, baseContrib, contribGrowthRate, r,
          iskNotional, iskTaxRate, iskThreshold, withdrawAmt, withdrawStart } = p;
  let bal = 0, totalContrib = 0, cumTax = 0, gross = 0;
  const balArr = [], contribArr = [], cumTaxArr = [], annTaxArr = [];
  const qR = Math.pow(1 + r, 0.25);

  for (let y = 1; y <= horizon; y++) {
    const yearContrib = baseContrib * Math.pow(1 + contribGrowthRate, y - 1);
    const wAmt = y >= withdrawStart ? withdrawAmt : 0;
    const qDep = yearContrib / 4;

    const q1Open = bal;                     // Jan 1
    let b = (bal + qDep) * qR;
    const q2Open = b;                       // Apr 1
    b = (b + qDep) * qR;
    const q3Open = b;                       // Jul 1
    b = (b + qDep) * qR;
    const q4Open = b;                       // Oct 1
    b = (b + qDep) * qR;
    // End of Q4 (Dec 31)

    const capitalBase = (q1Open + q2Open + q3Open + q4Open + yearContrib) / 4;
    const taxableBase = Math.max(0, capitalBase - iskThreshold) * iskNotional;
    const tax = taxableBase * iskTaxRate;
    bal = b - tax;
    totalContrib += yearContrib;
    cumTax += tax;

    if (wAmt > 0 && bal > wAmt) bal -= wAmt;

    balArr.push(bal); contribArr.push(totalContrib);
    cumTaxArr.push(cumTax); annTaxArr.push(tax);

    gross += yearContrib;
    if (wAmt > 0 && gross > wAmt) gross -= wAmt;
    gross *= (1 + r);
  }
  return { bal: balArr, contrib: contribArr, cumTax: cumTaxArr, annTax: annTaxArr,
           grossVal: gross, totalContrib };
}

// Norway shielding-deduction model (aksjonærmodellen).
//
// Each year, the investor earns a tax-free "shielding deduction" equal to
//   shieldRate × (cost basis + accumulated unused shielding)
// Unused shielding carries forward and is itself shielded in subsequent
// years (so the allowance compounds).
//
// On disposal / withdrawal, the realised gain is reduced by the accumulated
// shielding deduction; only the excess is taxed at the configured CGT rate.
// No annual tax; no deemed disposal — tax only on realisation.
//
// This implementation matches the example in the policy note: 30k invested
// at 2.5% shielding rate gives a shielded allowance of 30,000 × ((1.025^8) − 1)
// = €6,552 after 8 years.
export function simNorway(p) {
  const { horizon, baseContrib, contribGrowthRate, r,
          noShieldRate, noCgtRate, withdrawAmt, withdrawStart } = p;
  let bal = 0, basis = 0, shieldAccum = 0, totalContrib = 0, cumTax = 0, gross = 0;
  const balArr = [], contribArr = [], cumTaxArr = [], annTaxArr = [];

  for (let y = 1; y <= horizon; y++) {
    const yearContrib = baseContrib * Math.pow(1 + contribGrowthRate, y - 1);
    const wAmt = y >= withdrawStart ? withdrawAmt : 0;

    bal += yearContrib;
    basis += yearContrib;
    totalContrib += yearContrib;

    // Earn this year's shielding deduction on (basis + carried shielding).
    const shieldBasis = basis + shieldAccum;
    const shieldEarned = shieldBasis * noShieldRate;
    shieldAccum += shieldEarned;

    bal *= (1 + r);
    let annual = 0;

    if (wAmt > 0 && bal > wAmt) {
      const preBal = bal;
      // Gross up: approximate effective tax rate as gainRatio × cgt, ignoring
      // shielding (which makes the actual rate lower). This slightly oversells
      // units when shielding is large but the difference is small.
      const gainRatio = preBal > basis ? (preBal - basis) / preBal : 0;
      let U = wAmt / Math.max(1e-9, 1 - gainRatio * noCgtRate);
      if (U > preBal) U = preBal;
      const realisedGain = U * gainRatio;
      const shieldApplied = Math.min(shieldAccum, realisedGain);
      const taxableGain = realisedGain - shieldApplied;
      const tax = taxableGain * noCgtRate;
      basis *= (1 - U / preBal);
      shieldAccum -= shieldApplied;
      bal -= U;
      annual += tax;
    }

    cumTax += annual;
    balArr.push(bal); contribArr.push(totalContrib);
    cumTaxArr.push(cumTax); annTaxArr.push(annual);

    gross += yearContrib;
    if (wAmt > 0 && gross > wAmt) gross -= wAmt;
    gross *= (1 + r);
  }

  // Terminal realisation.
  const termGain = bal - basis;
  if (termGain > 0) {
    const shieldApplied = Math.min(shieldAccum, termGain);
    const taxable = termGain - shieldApplied;
    const tax = taxable * noCgtRate;
    bal -= tax;
    cumTax += tax;
    balArr[horizon - 1] = bal;
    cumTaxArr[horizon - 1] = cumTax;
    annTaxArr[horizon - 1] += tax;
  }

  return { bal: balArr, contrib: contribArr, cumTax: cumTaxArr, annTax: annTaxArr,
           grossVal: gross, totalContrib };
}

// EU proposed wrapper — illustrative. Partial exemption with annual allowance
// and exit-tax-style deemed disposal on the non-exempt portion.
export function simEU(p) {
  const { horizon, baseContrib, contribGrowthRate, r, divY,
          euAllow, euExempt, exitTax, deemedYrs,
          withdrawAmt, withdrawStart } = p;
  let bal = 0, basis = 0, totalContrib = 0, cumTax = 0, gross = 0;
  const balArr = [], contribArr = [], cumTaxArr = [], annTaxArr = [];
  const netCapGrowth = r - divY;

  for (let y = 1; y <= horizon; y++) {
    const yearContrib = baseContrib * Math.pow(1 + contribGrowthRate, y - 1);
    const wAmt = y >= withdrawStart ? withdrawAmt : 0;
    const c = Math.min(yearContrib, euAllow);
    bal += c; basis += c; totalContrib += c;

    const div = bal * divY;
    const cap = bal * netCapGrowth;
    const divTaxRate = (1 - euExempt) * exitTax;
    const divTax = div * divTaxRate;
    bal += div - divTax + cap;
    let annual = divTax;

    if (y % deemedYrs === 0) {
      const gain = bal - basis;
      if (gain > 0) {
        const tax = gain * (1 - euExempt) * exitTax;
        bal -= tax;
        annual += tax;
        basis = bal;
      }
    }

    if (wAmt > 0 && bal > wAmt) {
      const preBal = bal;
      const effRate = (1 - euExempt) * exitTax;
      const { units, tax } = grossUpUnits(wAmt, preBal, basis, effRate);
      if (units > 0) {
        basis *= (1 - units / preBal);
        bal -= units;
        annual += tax;
      }
    }

    cumTax += annual;
    balArr.push(bal); contribArr.push(totalContrib);
    cumTaxArr.push(cumTax); annTaxArr.push(annual);

    gross += c;
    if (wAmt > 0 && gross > wAmt) gross -= wAmt;
    gross *= (1 + r);
  }

  // Terminal realisation.
  const termGain = bal - basis;
  if (termGain > 0) {
    const tax = termGain * (1 - euExempt) * exitTax;
    bal -= tax;
    cumTax += tax;
    balArr[horizon - 1] = bal;
    cumTaxArr[horizon - 1] = cumTax;
    annTaxArr[horizon - 1] += tax;
  }

  return { bal: balArr, contrib: contribArr, cumTax: cumTaxArr, annTax: annTaxArr,
           grossVal: gross, totalContrib };
}

// ----- entry point ---------------------------------------------------------

// Convert raw UI params (percentages, integers) into a normalised params
// object for all wrappers.
export function normaliseParams(raw) {
  const nominalReturn = raw.annualReturn / 100;
  const rawDivY = raw.divYield / 100;
  const fee = raw.fee / 100;
  // Cap dividend yield at total return so the warning case still computes.
  const divY = Math.min(rawDivY, nominalReturn);
  const r = nominalReturn - fee;
  const feeRatio = nominalReturn > 0 ? r / nominalReturn : 1;
  const netDivY = divY * feeRatio;

  return {
    horizon: raw.horizon,
    baseContrib: raw.contrib,
    contribGrowthRate: raw.contribGrowth / 100,
    r,
    divY: netDivY,
    taxMode: raw.taxMode,
    exitTax: raw.exitTax / 100,
    deemedYrs: raw.deemedYrs,
    incTax: raw.incTax / 100,
    cgtRate: raw.cgt / 100,
    cgtExempt: raw.cgtExempt,
    isaAllow: raw.isaAllow,
    tfsaAnnualRoom: raw.tfsaRoom,
    iskNotional: raw.iskRate / 100,
    iskTaxRate: raw.iskTaxRate / 100,
    iskThreshold: raw.iskThreshold,
    euAllow: raw.euAllow,
    euExempt: raw.euExempt / 100,
    noShieldRate: raw.noShieldRate / 100,
    noCgtRate: (raw.noUseIncomeTax ? raw.incTax : raw.noCgtRate) / 100,
    withdrawAmt: raw.withdraw,
    withdrawStart: raw.withdrawStart,
  };
}

export function simulateAll(rawParams) {
  const p = normaliseParams(rawParams);
  return {
    taxable: simTaxable(p),
    isa:     simISA(p),
    tfsa:    simTFSA(p),
    isk:     simISK(p),
    no:      simNorway(p),
    eu:      simEU(p),
  };
}

// Deflate a nominal cashflow stream to year-0 real terms. If showReal is
// false, returns the array unchanged. Indexing assumes stream[0] is year 1.
export function deflate(stream, inflationRate, showReal) {
  if (!showReal) return stream;
  return stream.map((v, i) => v / Math.pow(1 + inflationRate, i + 1));
}

// NPV of a nominal cashflow stream, discounted at the nominal state rate.
// Result is in year-0 (today's) money — NPV is currency-invariant, so the
// real/nominal toggle does not change NPV. Indexing assumes stream[0]
// is the year-1 cashflow.
export function computeNPV(stream, stateRate) {
  let npv = 0;
  for (let y = 0; y < stream.length; y++) {
    npv += stream[y] / Math.pow(1 + stateRate, y + 1);
  }
  return npv;
}

// Cumulative sum of a stream, optionally deflated to year-0 purchasing power.
// This is what the "Tax Foregone" column needs: undiscounted (no time value)
// but inflation-adjusted to today's money when realTerms is on.
export function cumulativeReal(stream, inflationRate, showReal) {
  if (!showReal) return stream.reduce((a, b) => a + b, 0);
  let total = 0;
  for (let y = 0; y < stream.length; y++) {
    total += stream[y] / Math.pow(1 + inflationRate, y + 1);
  }
  return total;
}
