// UI layer — DOM rendering, chart, share-URL, sensitivity, CSV export.
// All simulation logic lives in sim.js; all schema/defaults in config.js.

import {
  simulateAll, computeNPV, cumulativeReal,
} from './sim.js';
import {
  MODEL_VERSION, MODEL_DATE, REVENUE_BENCHMARKS,
  DEFAULTS, PRESETS, WRAPPERS,
  INPUTS, INPUT_BY_ID, SENSITIVITY_INPUTS,
} from './config.js';

// ---------------- formatting helpers ----------------

const $ = id => document.getElementById(id);
// Money formatter that puts the minus sign before the currency symbol.
// Previous version produced "€-500" — wrong typographic convention.
const fmt = n => (n < 0 ? '-€' : '€') + Math.round(Math.abs(n)).toLocaleString('en-IE');
const pct = n => (n * 100).toFixed(1) + '%';
const fmtBn = n => {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + '€' + (a/1e9).toFixed(2) + 'bn';
  if (a >= 1e6) return s + '€' + (a/1e6).toFixed(1) + 'm';
  if (a >= 1e3) return s + '€' + (a/1e3).toFixed(0) + 'k';
  return fmt(n);
};
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// ---------------- state ----------------

const state = { ...DEFAULTS };

// Non-slider controls that still need diff-badge wrapping. We track them so
// markChanged() works uniformly across radios, toggles, and sliders.
const NON_SLIDER_CONTROLS = ['taxMode', 'realTerms', 'pensionMeansTested', 'noUseIncomeTax'];

// ---------------- DOM rendering of inputs ----------------

function buildControls() {
  const host = $('controls');
  let html = '';
  let currentSection = '';

  // Tax-mode radio (first, because it gates the tax controls).
  html += `<div class="section-title">Tax environment (Irish defaults)</div>`;
  html += `<div class="input-wrap" data-id="taxMode">
    <label style="font-weight:600; color:var(--text); margin-bottom:0.1rem;">Taxable baseline account type</label>
    <div class="radio-row">
      <label><input type="radio" name="taxMode" value="fund" ${state.taxMode==='fund'?'checked':''}> Fund wrapper (exit tax)</label>
      <label><input type="radio" name="taxMode" value="equity" ${state.taxMode==='equity'?'checked':''}> Direct equities (CGT)</label>
    </div>
    <p class="currency-note">Fund wrapper: 41% exit tax + deemed disposal (no annual dividend tax on accumulating UCITS ETFs). Direct equities: income tax on dividends, CGT on disposals with annual exemption.</p>
  </div>`;

  // Real-terms toggle
  html += `<div class="input-wrap" data-id="realTerms">
    <div class="toggle-row" style="margin-top:0.8rem;">
      <label class="toggle"><input type="checkbox" id="realTerms" ${state.realTerms?'checked':''}><span class="slider"></span></label>
      <label style="font-weight:600; color:var(--text); cursor:pointer;" for="realTerms">Show in real (inflation-adjusted) terms</label>
    </div>
  </div>`;

  // Means-test toggle for pension
  html += `<div class="input-wrap" data-id="pensionMeansTested">
    <div class="toggle-row" style="margin-top:0.5rem;">
      <label class="toggle"><input type="checkbox" id="pensionMeansTested" ${state.pensionMeansTested?'checked':''}><span class="slider"></span></label>
      <label style="font-weight:600; color:var(--text); cursor:pointer;" for="pensionMeansTested">Assume pension is means-tested (non-contributory)</label>
    </div>
    <p class="currency-note">Irish State Pension Contributory is NOT means-tested, so wrapper wealth does not displace it. Toggle on only if modelling a non-contributory benefit.</p>
  </div>`;

  // Norway income-tax toggle
  html += `<div class="input-wrap" data-id="noUseIncomeTax">
    <div class="toggle-row" style="margin-top:0.5rem;">
      <label class="toggle"><input type="checkbox" id="noUseIncomeTax" ${state.noUseIncomeTax?'checked':''}><span class="slider"></span></label>
      <label style="font-weight:600; color:var(--text); cursor:pointer;" for="noUseIncomeTax">Norway: tax excess at marginal income rate (else CGT)</label>
    </div>
  </div>`;

  // Sliders, grouped by section.
  for (const inp of INPUTS) {
    if (inp.section !== currentSection) {
      html += `<div class="section-title">${inp.section}</div>`;
      currentSection = inp.section;
    }
    const v = state[inp.id];
    const gateAttr = inp.gate ? ` data-gate="1"` : '';
    html += `<div class="input-wrap" data-id="${inp.id}"${gateAttr}>
      <label for="i_${inp.id}">${inp.label} <span class="val" id="v_${inp.id}">${inp.fmt(v)}</span></label>
      <div class="slider-row">
        <input type="range" id="i_${inp.id}" min="${inp.min}" max="${inp.max}" step="${inp.step}" value="${v}">
        <input type="number" id="n_${inp.id}" min="${inp.min}" max="${inp.max}" step="${inp.step}" value="${v}" aria-label="${inp.label} numeric input">
      </div>
      ${inp.note ? `<p class="currency-note">${inp.note}</p>` : ''}
      <div class="warning-banner" id="warn_${inp.id}"></div>
    </div>`;
  }

  host.innerHTML = html;
}

// Wire up event handlers after the controls are in the DOM.
function wireControls() {
  for (const inp of INPUTS) {
    const slider = $('i_' + inp.id);
    const num    = $('n_' + inp.id);
    const valEl  = $('v_' + inp.id);
    if (!slider) continue;

    // Clamp out-of-range typed values to [min, max].
    const sync = (source) => {
      const raw = parseFloat(source.value);
      if (!Number.isFinite(raw)) return;
      const v = clamp(raw, inp.min, inp.max);
      state[inp.id] = v;
      slider.value = num.value = v;
      valEl.textContent = inp.fmt(v);
      markChanged(inp.id);
      scheduleRun();
    };
    slider.addEventListener('input',  () => sync(slider));
    num.addEventListener('input',     () => sync(num));
    num.addEventListener('change',    () => sync(num));
  }

  document.querySelectorAll('input[name="taxMode"]').forEach(r => {
    r.addEventListener('change', () => {
      state.taxMode = document.querySelector('input[name="taxMode"]:checked').value;
      applyGates();
      markChanged('taxMode');
      scheduleRun();
    });
  });

  for (const id of ['realTerms', 'pensionMeansTested', 'noUseIncomeTax']) {
    $(id).addEventListener('change', e => {
      state[id] = e.target.checked;
      markChanged(id);
      scheduleRun();
    });
  }

  applyGates();
}

function applyGates() {
  // Show/hide tax-mode-dependent rows. INPUT_BY_ID is O(1).
  document.querySelectorAll('.input-wrap[data-gate]').forEach(el => {
    const inp = INPUT_BY_ID[el.dataset.id];
    el.style.display = (inp && inp.gate(state)) ? '' : 'none';
  });
}

function markChanged(id) {
  const wrap = document.querySelector(`.input-wrap[data-id="${id}"]`);
  if (!wrap) return;
  wrap.classList.toggle('changed', state[id] !== DEFAULTS[id]);
}

function markAllChanged() {
  for (const k of Object.keys(DEFAULTS)) markChanged(k);
}

// ---------------- presets / reset ----------------

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  Object.entries(p).forEach(([k, v]) => { state[k] = v; });
  refreshAllControls();
  scheduleRun();
}

function refreshAllControls() {
  for (const inp of INPUTS) {
    const slider = $('i_' + inp.id);
    const num    = $('n_' + inp.id);
    const valEl  = $('v_' + inp.id);
    if (slider) { slider.value = state[inp.id]; num.value = state[inp.id]; valEl.textContent = inp.fmt(state[inp.id]); }
  }
  document.querySelectorAll('input[name="taxMode"]').forEach(r => { r.checked = (r.value === state.taxMode); });
  $('realTerms').checked          = state.realTerms;
  $('pensionMeansTested').checked = state.pensionMeansTested;
  $('noUseIncomeTax').checked     = state.noUseIncomeTax;
  applyGates();
  markAllChanged();
}

function resetDefaults() {
  Object.assign(state, DEFAULTS);
  refreshAllControls();
  scheduleRun();
}

// ---------------- run coalescing ----------------

// Multiple input events within the same animation frame collapse to one
// simulation + render. Without this a rapid slider drag could trigger 60+
// full sim/render cycles per second on a fast monitor.
let runPending = false;
function scheduleRun() {
  if (runPending) return;
  runPending = true;
  requestAnimationFrame(() => {
    runPending = false;
    runSim();
  });
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

  simData = {
    series, horizon, showReal, inflationRate,
    labels: Array.from({length: horizon}, (_, i) => `Year ${i+1}`),
    byKey: Object.fromEntries(series.map(s => [s.key, s])),
  };

  renderChart();
  renderSummary();
  renderFiscal();
  renderTornado();
  renderTradeoffs();
  renderBrief();
  updateHashURL();
}

// ---------------- chart ----------------

function chartViewMeta() {
  const realLabel = simData.showReal ? ' (real)' : '';
  if (activeChart === 'wealth')  return { dataKey: 'bal',     yLabel: `Net value${realLabel} (€)`,               title: 'Net portfolio value after all taxes and fees' };
  if (activeChart === 'tax')     return { dataKey: 'cumTax',  yLabel: `Cumulative tax${realLabel} (€)`,          title: 'Total tax paid over time' };
  if (activeChart === 'annual')  return { dataKey: 'annTax',  yLabel: `Annual tax${realLabel} (€)`,              title: 'Tax cost each year' };
  return                                  { dataKey: 'contrib', yLabel: `Cumulative contributions${realLabel} (€)`, title: 'Total contributions into each account (capped by allowance rules)' };
}

function renderChart() {
  if (!simData) return;
  const { labels, series, showReal } = simData;
  const view = chartViewMeta();

  $('chartNote').textContent = view.title + (showReal ? ' — inflation-adjusted' : ' — nominal');
  const cap = $('chartCaption');
  if (cap) cap.textContent = `${view.title}, ${showReal ? 'inflation-adjusted' : 'nominal'}, ${labels.length} years. Six lines, one per wrapper.`;

  const datasets = series.map(s => ({
    label: s.name,
    data: s[view.dataKey],
    borderColor: s.color,
    backgroundColor: s.color + '18',
    borderWidth: 2,
    pointRadius: 0,
    pointHitRadius: 8,
    tension: 0.3,
    fill: false,
  }));

  // Reuse the Chart instance to avoid the destroy/recreate flicker on every
  // slider tick. First run creates it; subsequent runs just swap data.
  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.options.scales.y.title.text = view.yLabel;
    chart.update('none');
    return;
  }

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
          title: { display: true, text: view.yLabel }
        },
        x: { ticks: { maxTicksLimit: 15 }, title: { display: true, text: 'Year' } }
      }
    }
  });
}

// ---------------- summary table ----------------

function renderSummary() {
  const { series, horizon, showReal, byKey } = simData;
  const deflator = showReal ? Math.pow(1 + state.inflation/100, horizon) : 1;
  $('summaryTitle').textContent = `Summary at end of horizon${showReal ? ' (real terms)' : ''}`;

  const taxableNet = byKey.taxable.bal[horizon - 1];
  $('summaryTable').querySelector('tbody').innerHTML = series.map(s => {
    const net      = s.bal[horizon - 1];
    const tax      = s.cumTax[horizon - 1];
    const contrib  = s.contrib[horizon - 1];
    const gross    = s.grossVal / deflator;
    const grossGain= gross - contrib;
    const effRate  = grossGain > 0 ? tax / grossGain : 0;
    const adv      = net - taxableNet;
    return `<tr>
      <td><span class="dot ${s.dot}"></span>${s.name}</td>
      <td>${fmt(contrib)}</td>
      <td>${fmt(gross)}</td>
      <td>${fmt(tax)}</td>
      <td><strong>${fmt(net)}</strong></td>
      <td>${pct(effRate)}</td>
      <td style="color:${adv >= 0 ? '#059669' : '#dc2626'}">${adv >= 0 ? '+' : ''}${fmt(adv)}</td>
    </tr>`;
  }).join('');
}

// ---------------- fiscal tables ----------------

function renderFiscal() {
  const { series, horizon, showReal, inflationRate, byKey } = simData;
  const popAccounts      = state.popAccounts;
  const stateRate        = state.stateRate / 100;
  const pensionOffsetPct = state.pensionOffset / 100;
  const pensionCost      = state.pensionCost;
  const pensionYears     = state.pensionYears;
  const retireAge        = state.retireAge;
  const startAge         = state.startAge;
  const gdpGrowth        = state.gdpGrowth / 100;
  const meansTested      = state.pensionMeansTested;

  const taxableAnnTax = byKey.taxable.rawAnnTax;
  const taxableNet    = byKey.taxable.rawBal[horizon - 1];

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

  const otherSeries = series.filter(s => s.key !== 'taxable');
  const fiscalData = otherSeries.map(s => {
    const annForegone   = taxableAnnTax.map((t, i) => t - s.rawAnnTax[i]);
    const npvForegone   = computeNPV(annForegone, stateRate);
    const totalForegone = cumulativeReal(annForegone, inflationRate, showReal);
    const annualised    = totalForegone / horizon;
    const year1         = annForegone[0] || 0;
    const finalYear     = annForegone[horizon - 1] || 0;
    const gross         = s.grossVal / (showReal ? Math.pow(1+inflationRate, horizon) : 1);

    const wealthRatio = taxableNet > 0 ? s.rawBal[horizon - 1] / taxableNet : 1;
    const pensionOff  = basePensionPV * wealthRatio;

    return {
      series: s, totalForegone, npvForegone, annualised, year1, finalYear,
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
    const aggNPV     = d.npvForegone * popAccounts;
    const aggAnnual  = d.annualised  * popAccounts;
    const aggYear1   = d.year1       * popAccounts;
    const aggFinal   = d.finalYear   * popAccounts;
    const aggPension = d.pensionOff  * popAccounts;
    const netCost    = aggNPV - aggPension;
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
  const CGTf = CGT*grow, INCf = INC*grow, TOTf = TOT*grow, SPCf = SPC*grow;

  $('anchorTable').querySelector('tbody').innerHTML = fiscalData.flatMap(d => {
    const aggYear1 = d.year1 * popAccounts;
    const aggFinal = d.finalYear * popAccounts;
    return [
      // Negative cost = wrapper raises MORE revenue than the baseline in
      // this year (e.g. Norway after the fund wrapper's deemed-disposal
      // pre-payments have eaten the basis). Display as a revenue-gain in
      // green to avoid the visual "cost" confusion.
      `<tr>
        <td rowspan="2"><span class="dot ${d.series.dot}"></span>${d.series.name}</td>
        <td>Year 1</td>
        <td style="color:${aggYear1 < 0 ? '#059669' : ''}">${aggYear1 < 0 ? '+' + fmtBn(-aggYear1) : fmtBn(aggYear1)}</td>
        <td>${pct(aggYear1/CGT)}</td>
        <td>${pct(aggYear1/INC)}</td>
        <td>${pct(aggYear1/TOT)}</td>
        <td>${pct(aggYear1/SPC)}</td>
      </tr>`,
      `<tr>
        <td>Year ${horizon}</td>
        <td style="color:${aggFinal < 0 ? '#059669' : ''}">${aggFinal < 0 ? '+' + fmtBn(-aggFinal) : fmtBn(aggFinal)}</td>
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

function renderTornado() {
  // Find the best non-taxable wrapper at horizon for the base case.
  const h = state.horizon - 1;
  const base = simulateAll(state);
  let bestKey = 'isa', bestVal = -Infinity;
  for (const w of WRAPPERS) {
    if (w.key === 'taxable') continue;
    if (base[w.key].bal[h] > bestVal) { bestVal = base[w.key].bal[h]; bestKey = w.key; }
  }

  const rows = [];
  for (const id of SENSITIVITY_INPUTS) {
    const original = state[id];
    if (original === 0 || !Number.isFinite(original)) continue;
    const inp = INPUT_BY_ID[id];
    const isInt = inp.step >= 1 && Number.isInteger(inp.step);
    let up   = clamp(original * 1.1, inp.min, inp.max);
    let down = clamp(original * 0.9, inp.min, inp.max);
    if (isInt) { up = Math.round(up); down = Math.round(down); }
    if (up === down) continue;

    // Override-based — no mutation of `state`.
    const upSim   = simulateAll(state, { [id]: up   })[bestKey];
    const downSim = simulateAll(state, { [id]: down })[bestKey];
    const upVal   = upSim.bal[upSim.bal.length - 1];
    const downVal = downSim.bal[downSim.bal.length - 1];
    const swing   = Math.abs(upVal - downVal);
    if (!Number.isFinite(swing)) continue;
    // Drop rows with no effect — happens for inflation in nominal mode,
    // for shielding rate when there's no realised gain, etc. Threshold
    // is €1 so floating-point noise doesn't clutter the chart.
    if (swing < 1) continue;
    rows.push({ id, label: inp.label, swing });
  }
  rows.sort((a, b) => b.swing - a.swing);

  if (!rows.length) {
    $('tornado').innerHTML = `<p class="currency-note" style="margin:0;">No inputs move the best-wrapper net wealth under the current configuration.</p>`;
    return;
  }

  const max = rows[0]?.swing || 1;
  $('tornado').innerHTML = rows.slice(0, 5).map(r => {
    const w = (r.swing / max) * 100;
    return `<div class="tornado-row">
      <span class="label">${r.label}</span>
      <div class="tornado-bar" style="width:${w}%"></div>
      <span class="val">${fmtBn(r.swing)}</span>
    </div>`;
  }).join('');
}

// ---------------- trade-offs prose ----------------

function renderTradeoffs() {
  const { series, horizon, showReal, byKey } = simData;
  const taxableNet  = byKey.taxable.bal[horizon - 1];
  const taxableTax  = byKey.taxable.cumTax[horizon - 1];
  const isaTax      = byKey.isa.cumTax[horizon - 1];
  const tfsaTax     = byKey.tfsa.cumTax[horizon - 1];
  const iskTax      = byKey.isk.cumTax[horizon - 1];
  const noTax       = byKey.no.cumTax[horizon - 1];

  const best = series.reduce((a, b) => b.bal[horizon-1] > a.bal[horizon-1] ? b : a);
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
  const isaForegone  = taxableTax - isaTax;
  const tfsaForegone = taxableTax - tfsaTax;
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

// ---------------- policy brief ----------------
//
// A compact, screenshot- / print-friendly one-pager summarising the
// headline finding under the current configuration. Suitable for pasting
// into a slide deck or a department memo.

function renderBrief() {
  const { series, horizon, showReal, byKey } = simData;
  const popAccounts = state.popAccounts;
  const stateRate = state.stateRate / 100;

  const taxableNet = byKey.taxable.bal[horizon - 1];
  const taxableTax = byKey.taxable.cumTax[horizon - 1];

  // Best & worst for the investor (excluding the baseline).
  const nonBaseline = series.filter(s => s.key !== 'taxable');
  const best  = nonBaseline.reduce((a, b) => b.bal[horizon-1] > a.bal[horizon-1] ? b : a);
  const worst = nonBaseline.reduce((a, b) => b.bal[horizon-1] < a.bal[horizon-1] ? b : a);

  // Aggregate fiscal cost (NPV foregone, summed across non-baseline wrappers).
  const fiscalRows = nonBaseline.map(s => {
    const annForegone = byKey.taxable.rawAnnTax.map((t, i) => t - s.rawAnnTax[i]);
    const npv = computeNPV(annForegone, stateRate);
    return { key: s.key, name: s.name, dot: s.dot,
             net: s.bal[horizon-1],
             advantage: s.bal[horizon-1] - taxableNet,
             npvForegone: npv,
             aggregate: npv * popAccounts };
  });

  const assumptions = [
    `Investor: €${state.contrib.toLocaleString()}/yr contribution${state.contribGrowth ? `, +${state.contribGrowth}%/yr growth` : ''}, ${horizon}-year horizon (age ${state.startAge}→${state.startAge+horizon}).`,
    `Markets: ${state.annualReturn}% nominal return, ${state.divYield}% dividend yield, ${state.fee}% fee, ${state.inflation}% inflation.`,
    `Baseline: ${state.taxMode === 'fund' ? `Irish fund wrapper (${state.exitTax}% exit, ${state.deemedYrs}-yr deemed disposal)` : `Direct equities (${state.incTax}% income, ${state.cgt}% CGT, €${state.cgtExempt} exemption)`}.`,
    `Population: ${popAccounts.toLocaleString()} accounts. NPV at ${state.stateRate}% state rate.`,
  ];

  const briefHtml = `
    <p class="brief-headline">
      Under these assumptions, <strong>${best.name}</strong> leaves the investor
      <strong>${fmt(best.bal[horizon-1] - taxableNet)}</strong>
      ${best.bal[horizon-1] >= taxableNet ? 'better off' : 'worse off'}
      than the Irish baseline at year ${horizon}${showReal ? ' (real terms)' : ''}.
      Aggregate NPV foregone vs baseline:
      <strong>${fmtBn(fiscalRows.find(r => r.key === best.key).aggregate)}</strong>
      across ${popAccounts.toLocaleString()} accounts.
    </p>

    <table class="summary-table brief-table" style="margin-bottom:0.75rem;">
      <thead><tr>
        <th>Wrapper</th>
        <th>Net wealth @ y${horizon}</th>
        <th>vs Taxable</th>
        <th>Aggregate NPV foregone</th>
      </tr></thead>
      <tbody>
        <tr>
          <td><span class="dot dot-tax"></span>Taxable (Irish baseline)</td>
          <td>${fmt(taxableNet)}</td>
          <td>—</td>
          <td>—</td>
        </tr>
        ${fiscalRows.map(r => `
          <tr>
            <td><span class="dot ${r.dot}"></span>${r.name}</td>
            <td><strong>${fmt(r.net)}</strong></td>
            <td style="color:${r.advantage >= 0 ? '#059669' : '#dc2626'}">${r.advantage >= 0 ? '+' : ''}${fmt(r.advantage)}</td>
            <td style="color:${r.aggregate < 0 ? '#059669' : ''}">${fmtBn(r.aggregate)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <h3 style="margin-top:0.5rem;">Assumptions</h3>
    <ul style="font-size:0.82rem; margin: 0.2rem 0 0.75rem 1.2rem; line-height: 1.5;">
      ${assumptions.map(a => `<li>${a}</li>`).join('')}
    </ul>

    <p class="brief-footer">
      Lifetime SIA Simulator v${MODEL_VERSION} (${MODEL_DATE}).
      Live tool: <a href="https://skinsella.github.io/isa-simulator/">skinsella.github.io/isa-simulator</a>.
      Source: <a href="https://github.com/skinsella/isa-simulator">github.com/skinsella/isa-simulator</a>.
      Methodology: <a href="METHODS.md">METHODS.md</a>.
    </p>
  `;
  $('briefBody').innerHTML = briefHtml;
}

// ---------------- share / persist URL ----------------

// Only serialise parameters that differ from defaults — keeps shared links
// short and survives future schema additions (any unknown key in the hash
// will simply be ignored on load).
function updateHashURL() {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (v === DEFAULTS[k]) continue;
    params.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
  }
  const hash = params.toString();
  history.replaceState(null, '', hash ? '#' + hash : location.pathname);
}

function loadFromHash() {
  if (!location.hash || location.hash.length < 2) return;
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    let unknown = [];
    params.forEach((raw, k) => {
      if (!(k in DEFAULTS)) { unknown.push(k); return; }
      const def = DEFAULTS[k];
      if      (typeof def === 'boolean') state[k] = raw === '1' || raw === 'true';
      else if (typeof def === 'number')  state[k] = parseFloat(raw);
      else                                state[k] = raw;
    });
    if (unknown.length) console.warn('SIA: ignored unknown URL hash keys:', unknown);
  } catch (e) {
    console.warn('SIA: failed to parse URL hash:', e);
  }
}

// ---------------- CSV export ----------------

// Quote CSV fields that contain commas, quotes, or newlines. None of our
// wrapper names trigger this today, but future-proof anyway.
function csvField(v) {
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadCSV() {
  if (!simData) return;
  const { series, horizon } = simData;
  const headers = ['Year'];
  for (const w of WRAPPERS) headers.push(`${w.name} balance`, `${w.name} cumulative tax`);
  const rows = [headers.map(csvField).join(',')];
  for (let y = 0; y < horizon; y++) {
    const row = [y + 1];
    for (const s of series) row.push(s.rawBal[y].toFixed(2), s.rawCumTax[y].toFixed(2));
    rows.push(row.map(csvField).join(','));
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

// ---------------- tabs (with WAI-ARIA arrow-key nav) ----------------

function wireTabs() {
  const tabs = Array.from(document.querySelectorAll('button.tab'));
  tabs.forEach((t, idx) => {
    t.addEventListener('click', () => activateTab(t));
    t.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      let next = idx;
      if      (e.key === 'ArrowLeft')  next = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
      else if (e.key === 'Home')       next = 0;
      else if (e.key === 'End')        next = tabs.length - 1;
      tabs[next].focus();
      activateTab(tabs[next]);
    });
  });
}

function activateTab(t) {
  document.querySelectorAll('button.tab').forEach(x => x.setAttribute('aria-selected', 'false'));
  t.setAttribute('aria-selected', 'true');
  activeChart = t.dataset.chart;
  renderChart();
}

// ---------------- buttons / global wiring ----------------

function wireGlobal() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });
  $('resetBtn').addEventListener('click', resetDefaults);

  wireTabs();

  $('shareBtn').addEventListener('click', () => {
    navigator.clipboard?.writeText(location.href).then(() => flashMsg('Link copied'));
  });
  $('csvBtn').addEventListener('click', downloadCSV);
  $('citeBtn').addEventListener('click', showCitation);
  $('printBriefBtn').addEventListener('click', () => {
    document.body.classList.add('printing-brief');
    // requestAnimationFrame so the layout switch completes before window.print
    requestAnimationFrame(() => {
      window.print();
      // Restore after a tick — afterprint event isn't reliable across all browsers.
      setTimeout(() => document.body.classList.remove('printing-brief'), 100);
    });
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-brief'));

  $('footerVersion').textContent = `SIA Simulator v${MODEL_VERSION} (${MODEL_DATE})`;
}

// ---------------- init ----------------

loadFromHash();
buildControls();
wireControls();
wireGlobal();
markAllChanged();
runSim();
