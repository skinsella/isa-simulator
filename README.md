# Lifetime Savings/Investment Account Simulator

An interactive web tool comparing how the same investor fares under different
national tax wrappers for savings and investment accounts, against the Irish
baseline.

**Live:** https://skinsella.github.io/isa-simulator/

## What it compares

| Wrapper | Mechanism |
|---|---|
| **Taxable (Irish)** baseline | Fund-wrapper (41% exit tax, 8-year deemed disposal) **or** direct equities (income tax on dividends, 33% CGT on disposals, €1,270 annual exemption) |
| **UK ISA** | Fixed annual allowance, fully tax-free growth, no carry-forward |
| **Canada TFSA** | Annual room accumulates and carries forward; withdrawals restore room next year |
| **Sweden ISK** | No contribution limit; annual notional tax on (approx) average account value; optional 2025 SEK 150k tax-free threshold |
| **Norway shielding** | Tax-free "shielding deduction" compounds on cost basis at a configured rate; only gains above accumulated allowance taxed at CGT rate. Based on the Norwegian shareholder model (*aksjonærmodellen*) — see [METHODS.md](METHODS.md) |
| **EU proposed** | Illustrative only — partial-exemption with annual allowance. Parameters invented to explore design space; do not cite as a real proposal |

## Why this exists

Ireland taxes long-horizon retail investment unusually heavily and unusually
opaquely (41% fund exit tax + 8-year deemed disposal + the requirement to
self-assess). This tool lets policymakers and researchers vary the parameters
and see headline trade-offs:

- **Investor outcome:** Net wealth at horizon after all taxes and fees
- **Exchequer outcome:** Tax foregone vs the current Irish baseline, NPV and aggregate
- **Comparison anchors:** Aggregate cost vs CGT receipts, income tax, total tax, State Pension spending

Outputs are headline figures — see [METHODS.md](METHODS.md) for the exact
formulas, sources, and known limitations.

## Running locally

It's a static site — no build step.

```bash
# Open directly in a browser
open index.html

# Or serve via any local server
python3 -m http.server 8000
```

## Tests

Closed-form sanity checks for each wrapper:

```bash
npm test     # equivalent to: node tests/run.mjs
```

Tests run automatically on every push and PR via GitHub Actions
([badge](https://github.com/skinsella/isa-simulator/actions/workflows/test.yml)).

These compare simulated outputs against analytical formulas (e.g. UK ISA =
geometric annuity FV) and pin golden numbers for the four presets. Any change
to the simulation must keep these green.

## Citation

If you use figures from this tool, please cite the model version shown in the
footer (e.g. `Kinsella, S. (2026). Lifetime SIA Simulator v1.1.0`) and link to
this repo. The "Cite this" button in the app produces a ready-to-paste
attribution that includes the configuration hash.

## License

MIT — see [LICENSE](LICENSE).

## Known limitations

See [METHODS.md § Known limitations](METHODS.md#known-limitations). The biggest
ones:

1. Steady-state assumption for the "aggregate national cost" tables — a new
   scheme's year-1 cost would be much smaller.
2. EU model parameters are invented.
3. No DIRT, no pension wrapper (PRSA/EPP), no property.
4. All values normalised to EUR; the real-world allowances are denominated in
   GBP, CAD, SEK, NOK.
5. Single-investor model — does not capture behavioural responses (substitution
   from other vehicles) that would shrink the static fiscal cost.
