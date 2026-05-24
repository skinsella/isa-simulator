// Lifetime SIA Simulator — configuration, benchmarks, defaults.
// All money values in EUR unless noted.

export const MODEL_VERSION = '1.1.0';
export const MODEL_DATE = '2026-05-24';

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
  noShieldRate: 3.0,   // skjermingsrente; recent Norwegian values 2-4%
  noCgtRate: 38,       // 38% effective rate on share income (Norway 2024)
  noUseIncomeTax: false, // if true, use marginal income tax instead of CGT

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

// Presets — leave only inputs that meaningfully change between scenarios.
export const PRESETS = {
  'young-low':   { contrib: 2000,  contribGrowth: 2,   horizon: 40, startAge: 22, annualReturn: 6, divYield: 2, fee: 0.75 },
  'mid-median':  { contrib: 6000,  contribGrowth: 1,   horizon: 25, startAge: 40, annualReturn: 6, divYield: 2, fee: 0.75 },
  'high-earner': { contrib: 20000, contribGrowth: 0,   horizon: 20, startAge: 45, annualReturn: 6, divYield: 2, fee: 0.5  },
  'lifetime':    { contrib: 3000,  contribGrowth: 2.5, horizon: 66, startAge: 0,  annualReturn: 6, divYield: 2, fee: 0.75 },
};

// Wrapper display metadata (single source of truth for colors, labels, dots).
export const WRAPPERS = [
  { key: 'taxable', name: 'Taxable (Irish)', color: '#6b7280', dot: 'dot-tax' },
  { key: 'isa',     name: 'UK ISA',          color: '#1e40af', dot: 'dot-uk'  },
  { key: 'tfsa',    name: 'Canada TFSA',     color: '#dc2626', dot: 'dot-ca'  },
  { key: 'isk',     name: 'Sweden ISK',      color: '#f59e0b', dot: 'dot-se'  },
  { key: 'no',      name: 'Norway shielding',color: '#7c3aed', dot: 'dot-no'  },
  { key: 'eu',      name: 'EU proposed',     color: '#059669', dot: 'dot-eu'  },
];
