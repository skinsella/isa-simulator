# Methodology

> Version: **v1.1.0** (2026-05-24). Material changes from v1.0.x are listed at
> the bottom of this file.

This document specifies the simulation precisely enough that anyone with
access to a spreadsheet could replicate it. If you spot an error, please open
an issue.

---

## Conventions

- All money values normalised to **EUR**. The real-world allowances for ISA,
  TFSA, ISK, and Norway shielding are denominated in their home currencies;
  the simulator does not perform FX conversion — it applies the rules to a
  EUR-denominated investor.
- Contributions are assumed made at the **start** of each year and earn a
  full year of growth (annuity-due convention).
- Returns and fees are applied at the **end** of each year (single
  compounding period), except for the Swedish ISK simulation which uses
  quarterly compounding.
- "Real terms" means deflated to **year-0 purchasing power** at the inflation
  rate the user specifies.

---

## Wrapper specifications

Let
- `C_y` = contribution in year y, possibly growing at rate `g`: `C_y = C₀ · (1+g)^(y-1)`
- `r` = net annual return after fees (`r = nominal − fee`)
- `d` = dividend yield (capped at `r`, scaled down by fee in the same ratio)
- `B_y`, `K_y` = end-of-year balance and cost basis
- `n` = horizon (years)

### Irish Taxable — fund wrapper (default baseline)

The realistic Irish case is an accumulating UCITS ETF, which has:
- **No** annual tax on dividends accruing inside the wrapper
- 41% exit tax on the entire gain at 8-year **deemed disposal**
- 41% exit tax on residual gain at final exit
- After deemed disposal, basis is reset to the post-tax balance (approximation
  of the Revenue rule that tax paid is credited against later actual-disposal
  tax — equivalent for monotonically rising assets)

Year update:
```
B_y = (B_{y-1} + C_y) · (1 + r)
K_y = K_{y-1} + C_y
if y mod 8 == 0 and B_y > K_y:
    tax = (B_y − K_y) · 0.41
    B_y -= tax
    K_y  = B_y
```
Withdrawals (see "Withdrawal gross-up" below) reduce B and K proportionally
and trigger 41% tax on the gain portion of units sold.

### Irish Taxable — direct equities

```
B_y = (B_{y-1} + C_y) · (1 + r) − (B_{y-1} + C_y) · d · t_inc
```
where `t_inc` is the marginal income tax rate on dividends. Capital gains
are taxed only on disposal:
```
tax_disposal = max(0, (B_n − K_n) − exemption) · t_CGT
```

### UK ISA

```
c_y = min(C_y, allowance)        # no carry-forward
B_y = (B_{y-1} + c_y) · (1+r) − withdrawal_y
tax = 0
```
Note: the "flexible ISA" rule (restoring room within the same tax year) is
**not** modelled — it only operates intra-year and has negligible long-run
effect.

### Canada TFSA

Annual room accumulates and carries forward across years; withdrawals
restore room the following year (full gross amount, including gains):
```
unusedRoom_y = unusedRoom_{y-1} + annualRoom + restored_{y-1}
c_y = min(C_y, unusedRoom_y)
unusedRoom_y -= c_y
restored_y   = withdrawal_y
```

### Sweden ISK

Annual notional tax on the *kapitalunderlag*:
```
kapitalunderlag = (Q1_open + Q2_open + Q3_open + Q4_open + Σ deposits) / 4
taxableBase     = max(0, kapitalunderlag − threshold) · notionalRate
tax             = taxableBase · taxRate
```
- Quarterly compounding: `Q_{k+1}_open = (Q_k_open + dep/4) · (1+r)^0.25`
- The 2025 reform introduced a SEK 150k (≈€13k) **threshold** below which
  the base is tax-free. Set to 0 to model the pre-2025 regime.
- For steady DCA this matches reality exactly; for lumpy contributions the
  simulator slightly understates tax because it spreads deposits evenly
  across quarters.

### Norway shielding-deduction (aksjonærmodellen)

Each year the investor earns a tax-free *skjermingsfradrag*:
```
shieldBasis_y  = K_y + shieldAccum_{y-1}
shieldEarned_y = shieldBasis_y · shieldRate
shieldAccum_y  = shieldAccum_{y-1} + shieldEarned_y
```
On disposal, only gains **above** the accumulated shielding are taxed at the
standard CGT/income rate:
```
realisedGain  = (B − K) · (units_sold / B)
shieldApplied = min(shieldAccum, realisedGain)
tax           = (realisedGain − shieldApplied) · t_CGT
shieldAccum  -= shieldApplied
```
No annual tax; no deemed disposal — tax is only on actual realisation.

The example in [Note on SIA.docx](../Note%20on%20SIA.docx) — €30,000 invested
at a 2.5% shielding rate produces an accumulated shielding of
**30,000 × ((1.025)^8 − 1) = €6,552** after 8 years — is reproduced exactly
by this implementation (test in `tests/run.mjs`).

### EU proposed (illustrative)

Cross-border partial-exemption wrapper. Contributions capped at allowance;
dividends and disposal gains taxed at `exitTax · (1 − exemption)`. Parameters
are **invented** to explore design space — do not cite as a real proposal.

---

## Withdrawal gross-up

When the investor wants `wAmt` net cash, they must sell `U` units gross,
where `U − U · gainRatio · t = wAmt`, giving
```
U = wAmt / (1 − gainRatio · t)
```
bounded above by current balance. Tax = `U · gainRatio · t`. Basis is reduced
by `K · (U / B)`. This corrects an earlier bug where the simulator computed
tax on `wAmt · gainRatio` instead — understating tax slightly and
overstating remaining basis.

---

## Fiscal cost calculations

### Per investor

- **Tax foregone** = Σ_y (taxable_y − wrapper_y)
  When real-terms toggle is on, each year's cashflow is deflated by
  inflation^y before summing — giving today's purchasing power.

- **NPV of foregone** = Σ_y (foregone_y) / (1 + stateRate)^y
  Always computed at the **nominal** state borrowing rate. NPV is currency-
  invariant — discounting nominal cashflows at a nominal rate gives a result
  in year-0 (today's) money regardless of the real-terms toggle. (Discounting
  real cashflows at the real rate gives the same result algebraically.)

- **As % of gross** = totalForegone / grossValue at horizon.

### Aggregate national cost

All per-investor figures are multiplied by the population of participating
accounts. The headline tables show:

- **NPV foregone**: aggregate present value of foregone tax over the horizon
- **Annual avg**: total foregone / horizon, aggregated
- **Year-1 cost / Final-year cost**: cashflow at the first and last year,
  aggregated. The year-1 figure approximates the cost of a *new* scheme;
  the final-year figure shows the *mature* cost.
- **Pension offset**: only credited when the user toggles "pension is
  means-tested". Scales by wealth ratio relative to the taxable baseline.
- **Net fiscal cost** = NPV foregone − aggregate pension offset PV.

### Pension offset — important caveat

The Irish State Pension Contributory (SPC) is **not** means-tested — it is
contribution-based. A wrapper that makes citizens wealthier does not displace
the SPC. The simulator defaults to no offset and requires the user to
explicitly toggle a means-test assumption (appropriate only for modelling a
non-contributory benefit, e.g. State Pension Non-Contributory or housing
supports).

---

## Revenue benchmarks

All figures from `js/config.js` (`REVENUE_BENCHMARKS`):

| Benchmark | 2024 value | Source |
|---|---|---|
| CGT receipts | €2.2 bn | [Revenue Statistics — Receipts](https://www.revenue.ie/en/corporate/information-about-revenue/statistics/receipts/receipts-statistics.aspx) |
| Income tax + USC | €32 bn | [Revenue Statistics — Receipts](https://www.revenue.ie/en/corporate/information-about-revenue/statistics/receipts/receipts-statistics.aspx) |
| Total tax receipts | €90 bn | [Revenue Statistics — Receipts](https://www.revenue.ie/en/corporate/information-about-revenue/statistics/receipts/receipts-statistics.aspx) |
| State Pension Contributory cost | €9.5 bn | [Dept of Social Protection](https://www.gov.ie/en/department-of-social-protection/publications/) |

Final-year comparisons grow each benchmark at the user-specified nominal
GDP rate. These are approximate — please verify against the most recent
Revenue / DSP publications before quoting figures.

---

## Known limitations

1. **Steady-state aggregation.** "Aggregate national cost" assumes every
   participating account has run for the full horizon. Year-1 / final-year
   cost columns bracket the cohort-mix uncertainty.

2. **No behavioural response.** The model is purely mechanical — it does
   not capture substitution from other vehicles (deposit accounts, property,
   pensions), which would shrink the static fiscal cost.

3. **Invented EU parameters.** The "EU proposed" wrapper is illustrative.
   The actual European Capital Markets Union proposal does not yet specify
   tax treatment.

4. **Currency.** Allowances are treated as EUR-denominated equivalents of
   the home-currency limits. Long-horizon FX movements are not modelled.

5. **Single agent.** No household-level effects (joint vs single, marriage
   penalty, intergenerational transfer).

6. **No DIRT / no pension wrapper.** Deposits subject to DIRT and pension
   wrappers (PRSA/EPP/Master Trust) are out of scope.

7. **Fund-wrapper basis-reset approximation.** Irish rules technically
   credit tax paid at deemed disposal against future actual-disposal tax.
   The simulator resets basis to post-tax balance instead, which gives the
   same long-run result for monotonically rising assets and differs only
   if the asset value falls between deemed disposal and final sale.

8. **Norway gross-up approximation.** The withdrawal gross-up uses the
   pre-shielding effective tax rate to size units sold. When accumulated
   shielding is large relative to the realised gain, this slightly oversells
   units. Effect is small under realistic parameters.

9. **No inheritance, no emigration, no early-death scenarios.**

---

## Change log

### v1.3.0 — 2026-06-02
- **New: Policy brief section.** A compact, screenshot-friendly one-pager
  summarising the headline finding under the current configuration. A
  dedicated "Print brief" button generates a clean A4 page (everything
  except the brief is hidden via `@media print`). Suitable for slide
  decks or department memos.
- **New: GitHub Actions CI.** Tests now run on every push and PR
  (`.github/workflows/test.yml`). Static checks confirm `index.html`
  still references the JS modules and the SRI hash on Chart.js.
- **New: 9 additional Norwegian-model tests.** Coverage now includes:
  zero-shielding-rate collapse to pure CGT; high-shielding tax-free
  regime; monotonic shielding response; withdrawal-consumes-shielding;
  override-based simulation contract; total 32 tests.
- **Polish:** Tornado now drops zero-swing rows (e.g. inflation when
  real-terms toggle is off) instead of cluttering with empty bars.
- **Polish:** Anchor table negative values (where a wrapper raises more
  revenue than the baseline in a given year) are highlighted in green
  with a `+€` prefix to disambiguate from the "cost" framing.
- **Polish:** EU model card disclaimer moved below the heading so all
  five card titles align in a row.

### v1.2.0 — 2026-05-24
- **Refactor:** `INPUTS` schema converted from positional tuples to named-field
  objects and moved to `config.js`. Adding a slider is now a one-line edit
  with no risk of column-shift bugs.
- **Fix:** `renderTradeoffs` and `renderFiscal` now look up wrappers by key
  (`byKey.isa`, `byKey.taxable`, …) instead of by position in the series
  array. Reordering `WRAPPERS` no longer silently misattributes numbers in
  the prose or fiscal tables.
- **Fix:** Money formatter now produces `-€500` instead of `€-500`. Affects
  the "vs Taxable" column whenever a wrapper underperforms the baseline.
- **Fix:** Diff badge now shows on toggle and radio controls too
  (`taxMode`, `realTerms`, `pensionMeansTested`, `noUseIncomeTax`).
- **Fix:** Number inputs are clamped to `[min, max]` on entry.
- **Fix:** `loadFromHash()` warns on unknown / malformed keys instead of
  silently dropping them.
- **Perf:** Slider/number events now coalesce via `requestAnimationFrame`.
  At most one full sim/render cycle per animation frame, regardless of how
  fast the user drags.
- **Perf:** Chart instance is reused across updates (`chart.update('none')`)
  instead of being destroyed and recreated. Removes the brief flicker on
  every slider tick.
- **Perf / safety:** Sensitivity tornado now passes overrides to
  `simulateAll(state, { [id]: value })` instead of temporarily mutating
  global state. Eliminates a class of subtle race conditions.
- **UX:** Share URL only includes parameters that differ from defaults —
  share links are ~⅓ the length they were in v1.1.
- **UX:** Sensitivity-tornado input list is now auto-derived from the
  `INPUTS` schema (`sensitivity: true` flag) instead of being hardcoded.
  Adding a new sensitivity-relevant parameter requires no UI change.
- **A11y:** Chart canvas has a `<figcaption>` description for screen
  readers. Tab buttons implement the full WAI-ARIA tab-list keyboard
  pattern (Left/Right/Home/End).
- **A11y:** CSV export now quotes fields containing commas or quotes
  (future-proofing — current wrapper names trigger no quoting).

### v1.1.0 — 2026-05-24
- **Added Norwegian shielding-deduction model** (per Sinn's policy note).
- **Fix:** Irish fund wrapper no longer double-taxes dividends. Annual
  in-fund dividend tax removed — only 8-year deemed disposal + terminal
  exit, matching the realistic accumulating-UCITS-ETF case.
- **Fix:** Withdrawal gross-up now computes units-sold correctly. Previous
  versions applied `wAmt · gainRatio` to compute tax; correct formula
  uses `U · gainRatio` where `U = wAmt / (1 − gainRatio · t)`.
- **Fix:** ISK kapitalunderlag now uses 4-quarter opening balances + deposits
  (the actual Swedish formula) instead of a 2-point average. Added 2025
  SEK 150k tax-free threshold.
- **Fix:** Pension offset defaults to zero, and only applies when the
  user explicitly toggles a means-test assumption. Previous versions
  unconditionally credited SPC savings, which is wrong because SPC is
  contribution-based.
- **Fix:** NPV computation no longer changes with the real-terms toggle
  (NPV is currency-invariant). "Tax foregone" totals are correctly
  inflation-deflated when real-terms is on.
- **New:** ARIA-correct tab buttons; paired number inputs on every slider;
  reset button; CSV export; sensitivity tornado; cite-this widget;
  meta description + OG tags; model version in footer; Subresource
  Integrity hash on Chart.js CDN tag.
- **New:** Tests (`node tests/run.mjs`) with closed-form sanity checks
  and pinned golden numbers.
- **Architecture:** Monolithic `simulator.html` split into
  `index.html` + `styles.css` + `js/{config,sim,ui}.js`. Pure simulation
  functions are now testable in isolation.
- **Docs:** This methodology document; README; MIT LICENSE.
