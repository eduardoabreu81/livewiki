# Lot I — bounded non-consuming retry for provider-incomplete responses (SENIOR)

**Date:** 2026-07-13
**Base commit:** `c4cfb21` (HEAD = origin/main)
**Maintainer decision:** approved 2026-07-13 after clean v16 — this is a
product resilience feature for flaky providers, not a benchmark knob. It
changes default cost semantics (more paid calls per task worst-case) with
explicit bounds.
**Evidence:** v13/v15/v16 diagnostics: provider `abort` (normalized
`incomplete`) is implicated in nearly every remaining failure; v16's
`core-src-01` was three consecutive aborts — pure provider failure with no
model-quality component, yet it consumed the entire bounded budget.

## Frozen design (do not deviate)

1. **Scope: `incomplete` ONLY.** A stage-4 attempt whose outcome is
   `incomplete_generation` (normalized stopReason `incomplete`) does NOT
   consume a bounded-loop slot while incomplete-retries remain. All other
   outcomes are UNCHANGED: `truncated_by_token_limit` (`length`) still
   consumes a slot (it reflects the product's own output budget, not
   provider flakiness); `llm_error` unchanged; `llm_timeout` stays
   terminal; completed-but-invalid unchanged.
2. **Bound:** new config field `maxIncompleteRetries`, optional, default
   **2**, `0` disables. Plumbed exactly like `maxRepairAttempts`
   (config -> batch options -> orchestrate). Worst-case paid calls per
   task = `1 + maxRepairAttempts + maxIncompleteRetries` (default 5).
3. **Exhaustion degrades gracefully:** once the per-task incomplete-retry
   budget is spent, further `incomplete` outcomes consume bounded slots
   exactly as today. No behavior change when `maxIncompleteRetries: 0`.
4. **Every paid call remains fully accounted:** the GLOBAL attempt counter
   still increments for retries, `usageHistory` and `diagnosticHistory`
   still gain exactly one entry each per call (invariant I1 intact).
   Usage/cost accounting stays monotonic and exact — money spent on a
   retry is real and visible.
5. **Diagnostics:** `DiagnosticAttempt` gains one OPTIONAL additive field
   `budgetConsumed?: boolean` — set `false` on attempts that did not
   consume a bounded slot, omitted (meaning consumed) otherwise. Backward
   compatible (I5): absent in old checkpoints.
6. **Next prompt after a retried incomplete:** fresh initial with cleared
   repair inputs — exactly the existing incomplete rule; only the slot
   accounting changes.
7. **Circuit breaker, exit codes, rollback handling: UNCHANGED.**
8. Provider-agnostic; branch only on normalized `incomplete`.

## Deliverables

### I1. SPEC.md delta (before code)

Document the retry budget: scope (incomplete only, explicitly NOT length),
default, bounds, worst-case call count, graceful exhaustion, accounting
guarantees, and the `budgetConsumed` diagnostic field.

### I2. Config (`packages/core/src/config.ts` + types)

`maxIncompleteRetries?: number` — optional, integer >= 0, default 2
applied at the same layer where `maxRepairAttempts` defaults today.
Validate like neighboring fields. Never a secret; ordinary config.

### I3. Stage-4 loop (`packages/core/src/batch.ts`)

Implement the slot/retry accounting per the frozen design. Keep the loop
readable: an explicit retry counter alongside the existing slot loop
(e.g., convert the `for` into a while over consumed slots) — do NOT hide
the semantics inside index arithmetic. Persist `budgetConsumed: false` on
retry diagnostics.

### I4. State (`packages/core/src/batch-state.ts`)

The optional `budgetConsumed?: boolean` on `DiagnosticAttempt` with a
doc comment stating absent == consumed.

### I5. Tests (`packages/core/src/batch-repair.test.ts` + config tests)

1. v16 `core-src-01` replay: abort, abort, abort with default budget →
   5 calls total (2 retries + 3 slots), task fails only after the full
   sequence; diagnosticHistory shows 5 entries with `budgetConsumed:
   false` on exactly the two retries; usage sums all 5.
2. abort → retry (fresh) → completed invalid → repair → success: retry did
   not consume a slot; promptKinds `[initial, initial, repair]`-shaped
   sequence as applicable; accounting exact.
3. `maxIncompleteRetries: 0` → byte-identical behavior to today (an abort
   consumes a slot); pin with an existing-scenario replay.
4. `length` outcome NEVER triggers the retry budget (consumes a slot even
   with retries available).
5. Exhaustion: with budget 1, the second abort consumes a slot.
6. Global attempt monotonicity across `--only` reruns including retries
   (I2 seeding) and 1:1 usage/diagnostic join (I1).
7. Old checkpoints without `budgetConsumed` load unchanged (I5).
8. Key-leak stays green.

## Non-negotiable rules

Validators untouched; no prompt-text changes in this lot; previous
contracts in force; no paid API calls; no commits/pushes; English durable
text; never touch `docs/benchmarks/**`, `.claude/`, `.codegraph/`; never
`git clean -fdx`.

Changes ONLY in: `SPEC.md`, `packages/core/src/config.ts` (+ its types/
tests), `packages/core/src/batch.ts`, `packages/core/src/batch-state.ts`,
`packages/core/src/batch-repair.test.ts` (+ config test file).

## Validation gates

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```
