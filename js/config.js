// Lifetime SIA Simulator — configuration, benchmarks, defaults, input schema.
// All money values in EUR unless noted.

export const MODEL_VERSION = '1.3.0';
export const MODEL_DATE = '2026-06-02';

// ---------------- formatters (shared with UI) ----------------

export const eurFmt = v => `€${Number(v).toLocaleString()}`;
export const pctFmt = v => `${v}%`;
export const yrFmt  = v => `${v} years`;
export const numFmt = v => `${v}`;

// ---------------- revenue benchmarks ----------------

// Irish revenue benchmarks. Annual aggregate cost is compared against these
// to give policymakers a sense of magnitude.
//
// Each entry: { value, year, source_url, note }
//   value:      EUR (current, not deflated)
//   year:       fiscal year the value refers to
//   source_url: primary source, current at MODEL_DATE
//   note:       short description / caveat
export const REVENUE_BENCHMARKS = {
  cgt: {
    value: 2.2e9,
    year: 2024,
    source_url: 'https://www.revenue.ie/en/corporate/information-about-revenue/statistics/receipts/receipts-statistics.aspx',
    note: 'Capital Gains Tax receipts (Revenue Annual Report).',
  },
  income_tax: {
    value: 32e9,
    year: 2024,
    source_url: 'https://www.revenue.ie/en/corporate/information-about-revenue/statistics/receipts/receipts-statistics.aspx',
    note: 'Income tax (incl. USC) receipts.',
  },
  total_tax: {
    value: 90e9,
    year: 2024,
    source_url: 'https://www.revenue.ie/en/corporate/information-about-revenue/statistics/receipts/receipts-statistics.aspx',
    note: 'Total Exchequer tax receipts.',
  },
  state_pension: {
    value: 9.5e9,
    year: 2024,
    source_url: 'https://www.gov.ie/en/department-of-social-protection/publications/',
    note: 'State Pension Contributory (SPC) annual cost (Dept of Social Protection).',
  },
};

// ---------------- defaults ----------------
//
// Defaults match the original simulator for backwards-compatible share URLs.
// Any change here must be reflected in tests/golden.json.

export const DEFAULTS = {
  // Investor profile
  contrib: 6000,
  contribGrowth: 0,
  horizon: 30,
  startAge: 25,
  annualReturn: 6,
  divYield: 2,
  fee: 0.75,
  inflation: 2.5,
  realTerms: false,

  // Taxable baseline
  taxMode: 'fund', // 'fund' | 'equity'
  exitTax: 41,
  deemedYrs: 8,
  incTax: 52,
  cgt: 33,
  cgtExempt: 1270,

  // Wrappers
  isaAllow: 20000,
  tfsaRoom: 7000,

  iskRate: 3.5,
  iskTaxRate: 30,
  iskThreshold: 13000, // 2025 SEK 150k tax-free threshold (≈€13k)

  euAllow: 10000,
  euExempt: 50,

  // Norway shielding-deduction model (aksjonærmodellen)
  noShieldRate: 3.0,
  noCgtRate: 38,
  noUseIncomeTax: false,

  // Fiscal / population scaling
  popAccounts: 1000000,
  stateRate: 3,
  gdpGrowth: 4.5,
  retireAge: 66,
  pensionOffset: 0,
  pensionMeansTested: false, // contributory pension is NOT means-tested
  pensionCost: 14400,
  pensionYears: 20,

  // Withdrawals
  withdraw: 0,
  withdrawStart: 15,
};

// ---------------- presets ----------------

export const PRESETS = {
  'young-low':   { contrib: 2000,  contribGrowth: 2,   horizon: 40, startAge: 22, annualReturn: 6, divYield: 2, fee: 0.75 },
  'mid-median':  { contrib: 6000,  contribGrowth: 1,   horizon: 25, startAge: 40, annualReturn: 6, divYield: 2, fee: 0.75 },
  'high-earner': { contrib: 20000, contribGrowth: 0,   horizon: 20, startAge: 45, annualReturn: 6, divYield: 2, fee: 0.5  },
  'lifetime':    { contrib: 3000,  contribGrowth: 2.5, horizon: 66, startAge: 0,  annualReturn: 6, divYield: 2, fee: 0.75 },
};

// ---------------- wrappers ----------------

export const WRAPPERS = [
  { key: 'taxable', name: 'Taxable (Irish)', color: '#6b7280', dot: 'dot-tax' },
  { key: 'isa',     name: 'UK ISA',          color: '#1e40af', dot: 'dot-uk'  },
  { key: 'tfsa',    name: 'Canada TFSA',     color: '#dc2626', dot: 'dot-ca'  },
  { key: 'isk',     name: 'Sweden ISK',      color: '#f59e0b', dot: 'dot-se'  },
  { key: 'no',      name: 'Norway shielding',color: '#7c3aed', dot: 'dot-no'  },
  { key: 'eu',      name: 'EU proposed',     color: '#059669', dot: 'dot-eu'  },
];

// ---------------- inputs schema ----------------
//
// One declarative list controls slider rendering, value-display formatting,
// step sizes, ranges, sections, and gating.
//
// Schema:
//   { section, id, label, min, max, step, fmt, note?, gate?, sensitivity? }
//
// `gate(state)` is an optional predicate that decides whether to show the
// input given the current state (used for tax-mode-dependent fields).
//
// `sensitivity: true` flags this input as a candidate for the tornado.

export const INPUTS = [
  // Profile
  { section: 'Profile', id: 'contrib',       label: 'Annual contribution',                 min: 500,    max: 50000,  step: 500,  fmt: eurFmt, sensitivity: true },
  { section: 'Profile', id: 'contribGrowth', label: 'Contribution growth rate',            min: 0,      max: 5,      step: 0.5,  fmt: pctFmt,
    note: 'Annual increase in contributions (e.g. wage growth). 0% = flat.' },
  { section: 'Profile', id: 'horizon',       label: 'Investment horizon',                  min: 1,      max: 70,     step: 1,    fmt: yrFmt,  sensitivity: true },
  { section: 'Profile', id: 'startAge',      label: 'Starting age',                        min: 0,      max: 65,     step: 1,    fmt: numFmt },
  { section: 'Profile', id: 'annualReturn',  label: 'Nominal annual return',               min: 0,      max: 15,     step: 0.5,  fmt: pctFmt, sensitivity: true },
  { section: 'Profile', id: 'divYield',      label: 'Dividend yield (within return)',      min: 0,      max: 6,      step: 0.25, fmt: pctFmt },
  { section: 'Profile', id: 'fee',           label: 'Annual management fee',               min: 0,      max: 3,      step: 0.05, fmt: pctFmt, sensitivity: true },
  { section: 'Profile', id: 'inflation',     label: 'Inflation rate',                      min: 0,      max: 8,      step: 0.25, fmt: pctFmt, sensitivity: true },

  // Fund tax
  { section: 'Tax — Fund', id: 'exitTax',    label: 'Exit tax / deemed-disposal rate',     min: 0,      max: 50,     step: 1,    fmt: pctFmt,
    gate: p => p.taxMode === 'fund' },
  { section: 'Tax — Fund', id: 'deemedYrs',  label: 'Deemed-disposal period',              min: 1,      max: 15,     step: 1,    fmt: yrFmt,
    gate: p => p.taxMode === 'fund' },

  // Equity tax
  { section: 'Tax — Equity', id: 'incTax',   label: 'Marginal income tax + USC + PRSI',    min: 0,      max: 60,     step: 1,    fmt: pctFmt,
    note: 'Applied to dividend income.',
    gate: p => p.taxMode === 'equity' },
  { section: 'Tax — Equity', id: 'cgt',      label: 'Capital gains tax rate',              min: 0,      max: 50,     step: 1,    fmt: pctFmt,
    gate: p => p.taxMode === 'equity' },
  { section: 'Tax — Equity', id: 'cgtExempt',label: 'Annual CGT exemption',                min: 0,      max: 5000,   step: 10,   fmt: eurFmt,
    gate: p => p.taxMode === 'equity' },

  // Wrapper parameters
  { section: 'Wrapper', id: 'isaAllow',      label: 'UK ISA annual allowance',             min: 1000,   max: 50000,  step: 1000, fmt: eurFmt, sensitivity: true },
  { section: 'Wrapper', id: 'tfsaRoom',      label: 'Canada TFSA annual room',             min: 1000,   max: 20000,  step: 500,  fmt: eurFmt },
  { section: 'Wrapper', id: 'iskRate',       label: 'Sweden ISK notional rate',            min: 0.5,    max: 8,      step: 0.25, fmt: pctFmt },
  { section: 'Wrapper', id: 'iskTaxRate',    label: 'ISK tax rate on notional base',       min: 10,     max: 50,     step: 1,    fmt: pctFmt },
  { section: 'Wrapper', id: 'iskThreshold',  label: 'ISK tax-free threshold (2025+)',      min: 0,      max: 30000,  step: 500,  fmt: eurFmt },
  { section: 'Wrapper', id: 'noShieldRate',  label: 'Norway shielding rate',               min: 0,      max: 8,      step: 0.25, fmt: pctFmt, sensitivity: true,
    note: 'Annual tax-free deduction = rate × (basis + carried shielding).' },
  { section: 'Wrapper', id: 'noCgtRate',     label: 'Norway CGT/income rate on excess',    min: 0,      max: 50,     step: 1,    fmt: pctFmt },
  { section: 'Wrapper', id: 'euAllow',       label: 'EU proposed annual allowance',        min: 1000,   max: 50000,  step: 1000, fmt: eurFmt },
  { section: 'Wrapper', id: 'euExempt',      label: 'EU gains exemption %',                min: 0,      max: 100,    step: 5,    fmt: pctFmt },

  // Fiscal
  { section: 'Fiscal', id: 'popAccounts',    label: 'Participating accounts',              min: 100000, max: 3500000,step: 50000, fmt: v => Number(v).toLocaleString(),
    note: 'Number of active accounts. Ireland: ~3.8m adults, ~5.1m residents.' },
  { section: 'Fiscal', id: 'stateRate',      label: 'State borrowing rate (for NPV)',      min: 0.5,    max: 6,      step: 0.25, fmt: pctFmt },
  { section: 'Fiscal', id: 'gdpGrowth',      label: 'Nominal GDP growth',                  min: 1,      max: 8,      step: 0.5,  fmt: pctFmt,
    note: 'Used to project revenue benchmarks forward.' },
  { section: 'Fiscal', id: 'retireAge',      label: 'Retirement age',                      min: 60,     max: 70,     step: 1,    fmt: numFmt },
  { section: 'Fiscal', id: 'pensionOffset',  label: 'Pension offset rate',                 min: 0,      max: 30,     step: 1,    fmt: pctFmt,
    note: 'Only applies if the relevant pension is means-tested. The Irish State Pension Contributory is NOT means-tested — leave at 0 unless you toggle the means-test assumption.' },
  { section: 'Fiscal', id: 'pensionCost',    label: 'Annual state pension cost per person',min: 5000,   max: 25000,  step: 200,  fmt: eurFmt },
  { section: 'Fiscal', id: 'pensionYears',   label: 'Pension draw years',                  min: 5,      max: 35,     step: 1,    fmt: numFmt },

  // Withdrawals
  { section: 'Withdrawals', id: 'withdraw',      label: 'Withdrawal per year',             min: 0,      max: 30000,  step: 500,  fmt: eurFmt },
  { section: 'Withdrawals', id: 'withdrawStart', label: 'Withdrawals begin in year',       min: 1,      max: 60,     step: 1,    fmt: numFmt,
    note: 'TFSA: withdrawals restore room next year. ISA: flexible. Taxable/EU/Norway: triggers tax on embedded gain.' },
];

// Lookup helpers built once at import time.
export const INPUT_BY_ID = Object.fromEntries(INPUTS.map(i => [i.id, i]));
export const SENSITIVITY_INPUTS = INPUTS.filter(i => i.sensitivity).map(i => i.id);
