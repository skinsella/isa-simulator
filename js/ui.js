// UI layer — DOM rendering, chart, share-URL, sensitivity, CSV export.
// Imports pure functions from sim.js and config from config.js.

import {
  simulateAll, normaliseParams, computeNPV, cumulativeReal,
} from './sim.js';
import {
  MODEL_VERSION, MODEL_DATE, REVENUE_BENCHMARKS,
  DEFAULTS, PRESETS, WRAPPERS,
} from './config.js';

// ---------------- formatting helpers ----------------

const $ = id => document.getElementById(id);
const fmt = n => '€' + Math.round(n).toLocaleString('en-IE');
const pct = n => (n * 100).toFixed(1) + '%';
const fmtBn = n => {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + '€' + (a/1e9).toFixed(2) + 'bn';
  if (a >= 1e6) return s + '€' + (a/1e6).toFixed(1) + 'm';
  if (a >= 1e3) return s + '€' + (a/1e3).toFixed(0) + 'k';
  return fmt(n);
};

// ---------------- input definitions ----------------
//
// One declarative list controls slider rendering, value-display formatting,
// step sizes, ranges, and which section each control sits in. Adding a new
// input means adding one row here.

const eurFmt = v => `€${Number(v).toLocaleString()}`;
const pctFmt = v => `${v}%`;
const yrFmt  = v => `${v} years`;
const numFmt = v => `${v}`;

const INPUTS = [
  // section, id, label, min, max, step, displayFormat
  ['Profile',         'contrib',        'Annual contribution',       500,    50000, 500,  eurFmt],
  ['Profile',         'contribGrowth',  'Contribution growth rate',  0,      5,     0.5,  pctFmt, 'Annual increase in contributions (e.g. wage growth). 0% = flat.'],
  ['Profile',         'horizon',        'Investment horizon',        1,      70,    1,    yrFmt],
  ['Profile',         'startAge',       'Starting age',              0,      65,    1,    numFmt],
  ['Profile',         'annualReturn',   'Nominal annual return',     0,      15,    0.5,  pctFmt],
  ['Profile',         'divYield',       'Dividend yield (within return)', 0,  6, 0.25, pctFmt],
  ['Profile',         'fee',            'Annual management fee',     0,      3,     0.05, pctFmt],
  ['Profile',         'inflation',      'Inflation rate',            0,      8,     0.25, pctFmt],

  ['Tax — Fund',      'exitTax',        'Exit tax / deemed-disposal rate', 0, 50, 1, pctFmt, null, p => p.taxMode === 'fund'],
  ['Tax — Fund',      'deemedYrs',      'Deemed-disposal period',    1,      15,    1,    yrFmt,  null, p => p.taxMode === 'fund'],
  ['Tax — Equity',    'incTax',         'Marginal income tax + USC + PRSI', 0, 60, 1, pctFmt, 'Applied to dividend income.', p => p.taxMode === 'equity'],
  ['Tax — Equity',    'cgt',            'Capital gains tax rate',    0,      50,    1,    pctFmt, null, p => p.taxMode === 'equity'],
  ['Tax — Equity',    'cgtExempt',      'Annual CGT exemption',      0,      5000,  10,   eurFmt, null, p => p.taxMode === 'equity'],

  ['Wrapper',         'isaAllow',       'UK ISA annual allowance',   1000,   50000, 1000, eurFmt],
  ['Wrapper',         'tfsaRoom',       'Canada TFSA annual room',   1000,   20000, 500,  eurFmt],
  ['Wrapper',         'iskRate',        'Sweden ISK notional rate (govt rate + spread)', 0.5, 8, 0.25, pctFmt],
  ['Wrapper',         'iskTaxRate',     'ISK tax rate on notional base', 10, 50,    1,    pctFmt],
  ['Wrapper',         'iskThreshold',   'ISK tax-free threshold (2025+)', 0, 30000, 500, eurFmt],
  ['Wrapper',         'noShieldRate',   'Norway shielding rate',     0,      8,     0.25, pctFmt, 'Annual tax-free deduction = rate × (basis + carried shielding).'],
  ['Wrapper',         'noCgtRate',      'Norway CGT/income rate on excess', 0, 50, 1, pctFmt],
  ['Wrapper',         'euAllow',        'EU proposed annual allowance', 1000, 50000, 1000, eurFmt],
  ['Wrapper',         'euExempt',       'EU gains exemption %',      0,      100,   5,    pctFmt],

  ['Fiscal',          'popAccounts',    'Participating accounts',    100000, 3500000, 50000, v => Number(v).toLocaleString(), 'Number of active accounts. Ireland: ~3.8m adults, ~5.1m residents.'],
  ['Fiscal',          'stateRate',      'State borrowing rate (for NPV)', 0.5, 6, 0.25, pctFmt],
  ['Fiscal',          'gdpGrowth',      'Nominal GDP growth',        1,      8,     0.5,  pctFmt, 'Used to project revenue benchmarks forward.'],
  ['Fiscal',          'retireAge',      'Retirement age',            60,     70,    1,    numFmt],
  ['Fiscal',          'pensionOffset',  'Pension offset rate',       0,      30,    1,    pctFmt, 'Only applies if the relevant pension is means-tested (e.g. non-contributory). The Irish State Pension Contributory is NOT means-tested — leave at 0 unless you toggle the means-test assumption.'],
  ['Fiscal',          'pensionCost',    'Annual state pension cost per person', 5000, 25000, 200, eurFmt],
  ['Fiscal',          'pensionYears',   'Pension draw years',        5,      35,    1,    numFmt],

  ['Withdrawals',     'withdraw',       'Withdrawal per year',       0,      30000, 500,  eurFmt],
  ['Withdrawals',     'withdrawStart',  'Withdrawals begin in year', 1,      60,    1,    numFmt, 'TFSA: withdrawals restore room next year. ISA: flexible. Taxable/EU/Norway: triggers tax on embedded gain.'],
];

// ---------------- params object ----------------

const state = { ...DEFAULTS };

function getParams() {
  return { ...state };
}

// ---------------- DOM rendering of inputs ----------------

function buildControls() {
  const host = $('controls');
  let html = '';
  let currentSection = '';

  // Tax-mode radio (first, because it gates the tax controls)
  html += `<div class="section-title">Tax environment (Irish defaults)</div>`;
  html += `<label style="font-weight:600; color:var(--text); margin-bottom:0.1rem;">Taxable baseline account type</label>
    <div class="radio-row">
      <label><input type="radio" name="taxMode" value="fund" ${state.taxMode==='fund'?'checked':''}> Fund wrapper (exit tax)</label>
      <label><input type="radio" name="taxMode" value="equity" ${state.taxMode==='equity'?'checked':''}> Direct equities (CGT)</label>
    </div>
    <p class="currency-note">Fund wrapper: 41% exit tax + deemed disposal (no annual dividend tax on accumulating UCITS ETFs). Direct equities: income tax on dividends, CGT on disposals with annual exemption.</p>`;

  // Real-terms toggle
  html += `<div class="toggle-row" style="margin-top:0.8rem;">
    <label class="toggle"><input type="checkbox" id="realTerms" ${state.realTerms?'checked':''}><span class="slider"></span></label>
    <label style="font-weight:600; color:var(--text); cursor:pointer;" for="realTerms">Show in real (inflation-adjusted) terms</label>
  </div>`;

  // Means-test toggle for pension
  html += `<div class="toggle-row" style="margin-top:0.5rem;">
    <label class="toggle"><input type="checkbox" id="pensionMeansTested" ${state.pensionMeansTested?'checked':''}><span class="slider"></span></label>
    <label style="font-weight:600; color:var(--text); cursor:pointer;" for="pensionMeansTested">Assume pension is means-tested (non-contributory)</label>
  </div>
  <p class="currency-note">Irish State Pension Contributory is NOT means-tested, so wrapper wealth does not displace it. Toggle on only if modelling a non-contributory benefit.</p>`;

  // Norway income-tax toggle
  html += `<div class="toggle-row" style="margin-top:0.5rem;">
    <label class="toggle"><input type="checkbox" id="noUseIncomeTax" ${state.noUseIncomeTax?'checked':''}><span class="slider"></span></label>
    <label style="font-weight:600; color:var(--text); cursor:pointer;" for="noUseIncomeTax">Norway: tax excess at marginal income rate (else CGT)</label>
  </div>`;

  // Now render sliders, sectioned.
  for (const row of INPUTS) {
    const [section, id, label, min, max, step, fmtFn, note, gate] = row;
    if (section !== currentSection) {
      html += `<div class="section-title">${section}</div>`;
      currentSection = section;
    }
    const v = state[id];
    const gateAttr = gate ? ` data-gate="${section}"` : '';
    html += `<div class="input-wrap" data-id="${id}"${gateAttr}>
      <label for="i_${id}">${label} <span class="val" id="v_${id}">${fmtFn(v)}</span></label>
      <div class="slider-row">
        <input type="range" id="i_${id}" min="${min}" max="${max}" step="${step}" value="${v}">
        <input type="number" id="n_${id}" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${label} numeric input">
      </div>
      ${note ? `<p class="currency-note">${note}</p>` : ''}
      <div class="warning-banner" id="warn_${id}"></div>
    </div>`;
  }

  host.innerHTML = html;
}

// Wire up the controls after they're in the DOM.
function wireControls() {
  for (const row of INPUTS) {
    const [, id, , , , , fmtFn] = row;
    const slider = $('i_' + id);
    const num    = $('n_' + id);
    const valEl  = $('v_' + id);
    if (!slider) continue;

    const sync = (source) => {
      const v = parseFloat(source.value);
      if (isNaN(v)) return;
      state[id] = v;
      slider.value = num.value = v;
      valEl.textContent = fmtFn(v);
      markChanged(id);
      runSim();
    };
    slider.addEventListener('input', () => sync(slider));
    num.addEventListener('input',    () => sync(num));
    num.addEventListener('change',   () => sync(num));
  }

  document.querySelectorAll('input[name="taxMode"]').forEach(r => {
    r.addEventListener('change', () => {
      state.taxMode = document.querySelector('input[name="taxMode"]:checked').value;
      applyGates();
      markChanged('taxMode');
      runSim();
    });
  });

  $('realTerms').addEventListener('change', e => {
    state.realTerms = e.target.checked;
    markChanged('realTerms');
    runSim();
  });
  $('pensionMeansTested').addEventListener('change', e => {
    state.pensionMeansTested = e.target.checked;
    markChanged('pensionMeansTested');
    runSim();
  });
  $('noUseIncomeTax').addEventListener('change', e => {
    state.noUseIncomeTax = e.target.checked;
    markChanged('noUseIncomeTax');
    runSim();
  });

  applyGates();
}

function applyGates() {
  // Show/hide tax-mode-dependent rows.
  document.querySelectorAll('.input-wrap[data-gate]').forEach(el => {
    const id = el.dataset.id;
    const row = INPUTS.find(r => r[1] === id);
    const gate = row && row[8];
    el.style.display = (!gate || gate(state)) ? '' : 'none';
  });
}

function markChanged(id) {
  const wrap = document.querySelector(`.input-wrap[data-id="${id}"]`);
  if (!wrap) return;
  const isChanged = state[id] !== DEFAULTS[id];
  wrap.classList.toggle('changed', isChanged);
}

function markAllChanged() {
  for (const k of Object.keys(DEFAULTS)) markChanged(k);
}

// ---------------- presets ----------------

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  Object.entries(p).forEach(([k, v]) => { state[k] = v; });
  refreshAllControls();
  runSim();
}

function refreshAllControls() {
  for (const row of INPUTS) {
    const [, id, , , , , fmtFn] = row;
    const slider = $('i_' + id);
    const num    = $('n_' + id);
    const valEl  = $('v_' + id);
    if (slider) { slider.value = state[id]; num.value = state[id]; valEl.textContent = fmtFn(state[id]); }
  }
  document.querySelectorAll('input[name="taxMode"]').forEach(r => {
    r.checked = (r.value === state.taxMode);
  });
  $('realTerms').checked          = state.realTerms;
  $('pensionMeansTested').checked = state.pensionMeansTested;
  $('noUseIncomeTax').checked     = state.noUseIncomeTax;
  applyGates();
  markAllChanged();
}

function resetDefaults() {
  Object.assign(state, DEFAULTS);
  refreshAllControls();
  runSim();
}

// ---------------- chart + tables ----------------

let activeChart = 'wealth';
let chart = null;
let simData = null;

function runSim() {
  // Dividend warning
  const warnEl = $('warn_divYield');
  if (warnEl) {
    const overshoot = state.divYield > state.annualReturn;
    warnEl.textContent = overshoot ? 'Dividend yield exceeds total return — capital growth will be negative.' : '';
    warnEl.classList.toggle('visible', overshoot);
  }

  const results = simulateAll(state);
  const horizon = state.horizon;
  const inflationRate = state.inflation / 100;
  const showReal = state.realTerms;

  const deflate = arr => showReal ? arr.map((v, i) => v / Math.pow(1+inflationRate, i+1)) : arr;
  const series = WRAPPERS.map(w => {
    const r = results[w.key];
    return {
      ...w,
      bal: deflate(r.bal),
      cumTax: deflate(r.cumTax),
      annTax: deflate(r.annTax),
      contrib: deflate(r.contrib),
      grossVal: r.grossVal,
      rawAnnTax: r.annTax,
      rawCumTax: r.cumTax,
      rawBal: r.bal,
      rawContrib: r.contrib,
      totalContrib: r.totalContrib,
    };
  });

  simData = { series, horizon, showReal, inflationRate, labels: Array.from({length: horizon}, (_, i) => `Year ${i+1}`) };

  renderChart();
  renderSummary();
  renderFiscal();
  renderTornado();
  renderTradeoffs();
  updateHashURL();
}

function renderChart() {
  if (!simData) return;
  const { labels, series, showReal } = simData;
  const realLabel = showReal ? ' (real)' : '';

  let dataKey, yLabel, title;
  if (activeChart === 'wealth')       { dataKey = 'bal';     yLabel = `Net value${realLabel} (€)`; title = 'Net portfolio value after all taxes and fees'; }
  else if (activeChart === 'tax')     { dataKey = 'cumTax';  yLabel = `Cumulative tax${realLabel} (€)`; title = 'Total tax paid over time'; }
  else if (activeChart === 'annual')  { dataKey = 'annTax';  yLabel = `Annual tax${realLabel} (€)`; title = 'Tax cost each year'; }
  else                                { dataKey = 'contrib'; yLabel = `Cumulative contributions${realLabel} (€)`; title = 'Total contributions into each account (capped by allowance rules)'; }

  $('chartNote').textContent = title + (showReal ? ' — inflation-adjusted' : ' — nominal');

  const datasets = series.map(s => ({
    label: s.name,
    data: s[dataKey],
    borderColor: s.color,
    backgroundColor: s.color + '18',
    borderWidth: 2,
    pointRadius: 0,
    pointHitRadius: 8,
    tension: 0.3,
    fill: false,
  }));

  if (chart) chart.destroy();
  chart = new Chart($('mainChart'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: €${Math.round(ctx.parsed.y).toLocaleString()}` } },
        legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 12 } } }
      },
      scales: {
        y: {
          ticks: { callback: v => '€' + (v >= 1e6 ? (v/1e6).toFixed(1) + 'M' : v >= 1e3 ? (v/1e3).toFixed(0) + 'k' : v) },
          title: { display: true, text: yLabel }
        },
        x: { ticks: { maxTicksLimit: 15 }, title: { display: true, text: 'Year' } }
      }
    }
  });
}

function renderSummary() {
  const { series, horizon, showReal } = simData;
  const deflator = showReal ? Math.pow(1 + state.inflation/100, horizon) : 1;
  $('summaryTitle').textContent = `Summary at end of horizon${showReal ? ' (real terms)' : ''}`;

  const taxableNet = series[0].bal[horizon - 1];
  $('summaryTable').querySelector('tbody').innerHTML = series.map(s => {
    const net = s.bal[horizon - 1];
    const tax = s.cumTax[horizon - 1];
    const contrib = s.contrib[horizon - 1];
    const gross = s.grossVal / deflator;
    const grossGain = gross - contrib;
    const effRate = grossGain > 0 ? tax / grossGain : 0;
    const advantage = net - taxableNet;
    return `<tr>
      <td><span class="dot ${s.dot}"></span>${s.name}</td>
      <td>${fmt(contrib)}</td>
      <td>${fmt(gross)}</td>
      <td>${fmt(tax)}</td>
      <td><strong>${fmt(net)}</strong></td>
      <td>${pct(effRate)}</td>
      <td style="color:${advantage >= 0 ? '#059669' : '#dc2626'}">${advantage >= 0 ? '+' : ''}${fmt(advantage)}</td>
    </tr>`;
  }).join('');
}

function renderFiscal() {
  const { series, horizon, showReal, inflationRate } = simData;
  const popAccounts = state.popAccounts;
  const stateRate = state.stateRate / 100;
  const pensionOffsetPct = state.pensionOffset / 100;
  const pensionCost = state.pensionCost;
  const pensionYears = state.pensionYears;
  const retireAge = state.retireAge;
  const startAge = state.startAge;
  const gdpGrowth = state.gdpGrowth / 100;
  const meansTested = state.pensionMeansTested;

  const taxableAnnTax = series[0].rawAnnTax;
  const taxableNet    = series[0].rawBal[horizon - 1];

  // Pension PV
  const pensionStartYear = Math.max(horizon, retireAge - startAge);
  function pensionPV() {
    let pv = 0;
    for (let y = 0; y < pensionYears; y++) {
      pv += pensionCost / Math.pow(1 + stateRate, pensionStartYear + y + 1);
    }
    return pv * pensionOffsetPct;
  }
  const basePensionPV = meansTested ? pensionPV() : 0;

  const otherSeries = series.slice(1);
  const fiscalData = otherSeries.map(s => {
    const annForegone = taxableAnnTax.map((t, i) => t - s.rawAnnTax[i]);
    const npvForegone = computeNPV(annForegone, stateRate);
    const totalForegone = cumulativeReal(annForegone, inflationRate, showReal);
    const annualised = totalForegone / horizon;
    const year1 = annForegone[0] || 0;
    const finalYear = annForegone[horizon - 1] || 0;
    const gross = s.grossVal / (showReal ? Math.pow(1+inflationRate, horizon) : 1);

    // Only credit pension offset if means-tested AND this wrapper raises wealth.
    const wealthRatio = taxableNet > 0 ? s.rawBal[horizon - 1] / taxableNet : 1;
    const pensionOff = basePensionPV * wealthRatio;

    return {
      series: s,
      totalForegone, npvForegone, annualised, year1, finalYear,
      pctGross: gross > 0 ? totalForegone / gross : 0,
      pensionOff,
    };
  });

  $('fiscalTable').querySelector('tbody').innerHTML = fiscalData.map(d => {
    const isNeg = d.totalForegone < 0;
    return `<tr>
      <td><span class="dot ${d.series.dot}"></span>${d.series.name}</td>
      <td style="color:${isNeg ? '#059669' : ''}">${fmt(d.totalForegone)}</td>
      <td style="color:${d.npvForegone < 0 ? '#059669' : ''}">${fmt(d.npvForegone)}</td>
      <td>${pct(d.pctGross)}</td>
      <td>${fmt(d.annualised)}/yr</td>
    </tr>`;
  }).join('');

  $('popLabel').textContent = popAccounts.toLocaleString();
  $('aggFiscalTable').querySelector('tbody').innerHTML = fiscalData.map(d => {
    const aggNPV = d.npvForegone * popAccounts;
    const aggAnnual = d.annualised * popAccounts;
    const aggYear1 = d.year1 * popAccounts;
    const aggFinal = d.finalYear * popAccounts;
    const aggPension = d.pensionOff * popAccounts;
    const netCost = aggNPV - aggPension;
    return `<tr>
      <td><span class="dot ${d.series.dot}"></span>${d.series.name}</td>
      <td style="color:${aggNPV < 0 ? '#059669' : ''}">${fmtBn(aggNPV)}</td>
      <td>${fmtBn(aggAnnual)}/yr</td>
      <td>${fmtBn(aggYear1)}</td>
      <td>${fmtBn(aggFinal)}</td>
      <td style="color:${aggPension > 0 ? '#059669' : 'var(--muted)'}">${aggPension > 0 ? fmtBn(-aggPension) : '—'}</td>
      <td style="color:${netCost > 0 ? '#dc2626' : '#059669'}"><strong>${fmtBn(netCost)}</strong></td>
    </tr>`;
  }).join('');

  // Anchors
  const grow = Math.pow(1 + gdpGrowth, horizon);
  const CGT  = REVENUE_BENCHMARKS.cgt.value;
  const INC  = REVENUE_BENCHMARKS.income_tax.value;
  const TOT  = REVENUE_BENCHMARKS.total_tax.value;
  const SPC  = REVENUE_BENCHMARKS.state_pension.value;
  const CGTf = CGT * grow, INCf = INC * grow, TOTf = TOT * grow, SPCf = SPC * grow;

  $('anchorTable').querySelector('tbody').innerHTML = fiscalData.flatMap(d => {
    const aggYear1 = d.year1 * popAccounts;
    const aggFinal = d.finalYear * popAccounts;
    return [
      `<tr>
        <td rowspan="2"><span class="dot ${d.series.dot}"></span>${d.series.name}</td>
        <td>Year 1</td>
        <td>${fmtBn(aggYear1)}</td>
        <td>${pct(aggYear1/CGT)}</td>
        <td>${pct(aggYear1/INC)}</td>
        <td>${pct(aggYear1/TOT)}</td>
        <td>${pct(aggYear1/SPC)}</td>
      </tr>`,
      `<tr>
        <td>Year ${horizon}</td>
        <td>${fmtBn(aggFinal)}</td>
        <td>${pct(aggFinal/CGTf)}</td>
        <td>${pct(aggFinal/INCf)}</td>
        <td>${pct(aggFinal/TOTf)}</td>
        <td>${pct(aggFinal/SPCf)}</td>
      </tr>`
    ];
  }).join('');

  $('anchorSources').innerHTML = `CGT = Capital Gains Tax receipts (€${(CGT/1e9).toFixed(1)}bn ${REVENUE_BENCHMARKS.cgt.year}). SPC = State Pension Contributory (€${(SPC/1e9).toFixed(1)}bn ${REVENUE_BENCHMARKS.state_pension.year}). Benchmarks grown at the nominal GDP rate you set. See <a href="METHODS.md">methodology</a> for sources.`;
}

// ---------------- sensitivity tornado ----------------

const SENSITIVITY_INPUTS = ['contrib', 'annualReturn', 'fee', 'inflation', 'horizon', 'isaAllow', 'noShieldRate'];

function renderTornado() {
  const base = simulateAll(state);
  // Identify the best wrapper at horizon (excluding taxable baseline).
  const h = state.horizon - 1;
  let bestKey = 'isa', bestVal = -Infinity;
  for (const w of WRAPPERS) {
    if (w.key === 'taxable') continue;
    if (base[w.key].bal[h] > bestVal) { bestVal = base[w.key].bal[h]; bestKey = w.key; }
  }

  const rows = [];
  for (const id of SENSITIVITY_INPUTS) {
    const original = state[id];
    if (original === 0) continue;
    const up = original * 1.1, down = original * 0.9;
    // Round horizon to whole years so we get a valid index.
    state[id] = id === 'horizon' ? Math.round(up)   : up;
    const upSim = simulateAll(state)[bestKey];
    const upVal = upSim.bal[upSim.bal.length - 1];
    state[id] = id === 'horizon' ? Math.round(down) : down;
    const downSim = simulateAll(state)[bestKey];
    const downVal = downSim.bal[downSim.bal.length - 1];
    state[id] = original;
    const swing = Math.abs(upVal - downVal);
    if (!isFinite(swing)) continue;
    rows.push({ id, label: INPUTS.find(r => r[1] === id)?.[2] || id, swing });
  }
  rows.sort((a, b) => b.swing - a.swing);

  const max = rows[0]?.swing || 1;
  $('tornado').innerHTML = rows.slice(0, 5).map(r => {
    const pctBar = (r.swing / max) * 100;
    return `<div class="tornado-row">
      <span class="label">${r.label}</span>
      <div class="tornado-bar" style="width:${pctBar}%"></div>
      <span class="val">${fmtBn(r.swing)}</span>
    </div>`;
  }).join('');
}

// ---------------- trade-offs prose ----------------

function renderTradeoffs() {
  const { series, horizon, showReal } = simData;
  const taxableNet = series[0].bal[horizon - 1];
  const best = series.reduce((a, b) => b.bal[horizon-1] > a.bal[horizon-1] ? b : a);
  const iskTax = series[3].cumTax[horizon - 1];
  const noTax  = series[4].cumTax[horizon - 1];
  const taxableTax = series[0].cumTax[horizon - 1];
  const termsLabel = showReal ? ' (real terms)' : '';
  const taxMode = state.taxMode;
  const feeVal = state.fee;
  const iskRate = state.iskRate;
  const iskEff = (iskRate * state.iskTaxRate / 100);
  const withdrawAmt = state.withdraw;
  const netR = state.annualReturn - feeVal;

  let html = `<p><strong>Best outcome for the investor${termsLabel}:</strong> ${best.name} produces the highest net wealth of ${fmt(best.bal[horizon-1])}.</p>`;

  html += `<p><strong>Taxable baseline:</strong> Modelled as ${taxMode === 'fund'
    ? `an Irish fund wrapper (${state.exitTax}% exit tax, ${state.deemedYrs}-year deemed disposal; no annual dividend tax for accumulating ETFs)`
    : `direct equities (${state.incTax}% on dividends, ${state.cgt}% CGT, €${state.cgtExempt.toLocaleString()} annual exemption)`}.</p>`;

  if (feeVal > 0) {
    html += `<p><strong>Fee drag:</strong> At ${feeVal}% annual fees, the cumulative cost over ${horizon} years is substantial. Fees reduce both dividend and capital growth proportionally.</p>`;
  }

  html += `<p><strong>Norway shielding:</strong> The shielding deduction (${state.noShieldRate}% × cost basis, compounding) means only gains above the cumulative allowance are taxed. This taxes high-return investments more than low-return ones — closer to the equity-CGT logic than to the ISA/TFSA blanket exemption.</p>`;

  html += `<p><strong>ISK fairness note:</strong> The ISK taxes notional returns even when actual returns are below ${iskRate}%. `;
  if (netR > iskRate) html += `At ${netR.toFixed(1)}% net vs ${iskRate}% notional, the ISK is favourable — effective drag ≈ ${iskEff.toFixed(2)}%/yr.</p>`;
  else                html += `At ${netR.toFixed(1)}% net vs ${iskRate}% notional, the investor is <em>overtaxed</em> relative to actual gains.${iskTax > taxableTax ? ' <strong>The ISK actually raises more revenue than the taxable baseline here.</strong>' : ''}</p>`;

  html += `<p><strong>Exchequer perspective:</strong> `;
  const isaForegone  = taxableTax - series[1].cumTax[horizon-1];
  const tfsaForegone = taxableTax - series[2].cumTax[horizon-1];
  const noForegone   = taxableTax - noTax;
  html += `ISA costs the state ${fmt(isaForegone)}; TFSA ${fmt(tfsaForegone)}; Norway shielding ${fmt(noForegone)} per investor. `;
  if (iskTax > taxableTax) html += `The ISK <em>raises</em> ${fmt(iskTax - taxableTax)} more than the taxable baseline.`;
  else                     html += `The ISK takes ${fmt(iskTax)} per investor over the horizon.`;
  html += `</p>`;

  html += `<p><strong>Distributional concern:</strong> At €${state.contrib.toLocaleString()}/yr starting contribution, ISA and TFSA blanket-exempt all returns, disproportionately benefiting higher-income households. Norway's design taxes only above-normal returns, which (per the policy note) tend to accrue to wealthier high-ability investors — a more targeted approach.</p>`;

  if (withdrawAmt > 0) {
    html += `<p><strong>Withdrawal dynamics:</strong> €${withdrawAmt.toLocaleString()}/yr from year ${state.withdrawStart}: TFSA restores room next year; ISA is flexible within tax year; taxable/EU/Norway trigger tax on the embedded gain in withdrawn units (Norway applies shielding deduction first).</p>`;
  }

  const endAge = state.startAge + horizon;
  html += `<p><strong>Lifetime framing:</strong> Age ${state.startAge} to ${endAge} (${horizon} years). `;
  if (state.startAge === 0) html += `A birth-to-${endAge} account with TFSA-style carry-forward accumulates unused room during childhood, creating a powerful catch-up mechanism when earnings begin.</p>`;
  else html += `A birth-to-retirement account with TFSA-style carry-forward would accumulate substantial unused room in early years.</p>`;

  if (showReal) html += `<p><strong>Real terms:</strong> All figures deflated by ${state.inflation}% inflation. Nominal balances would be ${pct(Math.pow(1 + state.inflation/100, horizon) - 1)} higher.</p>`;

  if (!state.pensionMeansTested && state.pensionOffset > 0) {
    html += `<p><strong>Pension offset:</strong> Set to ${state.pensionOffset}% but means-testing toggle is OFF — Irish State Pension Contributory is not means-tested, so wrapper wealth does not displace it. Offset shown as zero in the fiscal tables.</p>`;
  }

  $('tradeoffs').innerHTML = html;
}

// ---------------- share / persist URL ----------------

function updateHashURL() {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    params.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
  }
  // Replace without polluting history.
  history.replaceState(null, '', '#' + params.toString());
}

function loadFromHash() {
  if (!location.hash || location.hash.length < 2) return;
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    params.forEach((raw, k) => {
      if (!(k in DEFAULTS)) return;
      const def = DEFAULTS[k];
      if (typeof def === 'boolean')      state[k] = raw === '1' || raw === 'true';
      else if (typeof def === 'number')  state[k] = parseFloat(raw);
      else                                state[k] = raw;
    });
  } catch (e) { /* ignore bad hash */ }
}

// ---------------- CSV export ----------------

function downloadCSV() {
  if (!simData) return;
  const { series, horizon } = simData;
  const headers = ['Year'];
  for (const w of WRAPPERS) headers.push(`${w.name} balance`, `${w.name} cumulative tax`);
  const rows = [headers.join(',')];
  for (let y = 0; y < horizon; y++) {
    const row = [y + 1];
    for (const s of series) row.push(s.rawBal[y].toFixed(2), s.rawCumTax[y].toFixed(2));
    rows.push(row.join(','));
  }
  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sia-simulator-${MODEL_VERSION}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------- cite-this widget ----------------

function buildCitation() {
  // Short hash of the config for traceability.
  const cfg = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < cfg.length; i++) hash = (hash * 31 + cfg.charCodeAt(i)) | 0;
  const cfgHash = (hash >>> 0).toString(36);
  const year = new Date().getFullYear();
  const url = location.origin + location.pathname + location.hash;
  return `Kinsella, S. (${year}). Lifetime SIA Simulator v${MODEL_VERSION} (model dated ${MODEL_DATE}; config ${cfgHash}). Retrieved from ${url}`;
}

function showCitation() {
  const box = $('citeBox');
  const cite = buildCitation();
  box.textContent = cite;
  box.style.display = '';
  navigator.clipboard?.writeText(cite).then(() => flashMsg('Citation copied'));
}

function flashMsg(text) {
  const m = $('shareMsg');
  m.textContent = text;
  m.classList.add('show');
  setTimeout(() => m.classList.remove('show'), 2000);
}

// ---------------- wire buttons ----------------

function wireGlobal() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });
  $('resetBtn').addEventListener('click', resetDefaults);

  // Tab buttons with ARIA
  document.querySelectorAll('button.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('button.tab').forEach(x => x.setAttribute('aria-selected', 'false'));
      t.setAttribute('aria-selected', 'true');
      activeChart = t.dataset.chart;
      renderChart();
    });
  });

  $('shareBtn').addEventListener('click', () => {
    navigator.clipboard?.writeText(location.href).then(() => flashMsg('Link copied'));
  });
  $('csvBtn').addEventListener('click', downloadCSV);
  $('citeBtn').addEventListener('click', showCitation);

  $('footerVersion').textContent = `SIA Simulator v${MODEL_VERSION} (${MODEL_DATE})`;
}

// ---------------- init ----------------

loadFromHash();
buildControls();
wireControls();
wireGlobal();
markAllChanged();
runSim();
