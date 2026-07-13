# Lot H — markers are never abbreviated (SENIOR)

**Date:** 2026-07-13
**Base commit:** `651ec51` (HEAD = origin/main)
**Evidence:** `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v15/`
(read-only — never modify anything under `docs/benchmarks/`).

## Root cause (diagnosed by the lead from v15 diagnostics)

v15 reached 12/13. The sole failure, `tools`, emitted the Unicode ellipsis
`…` as an out-of-list anchor on BOTH completed initial generations (its
only repair attempt was a provider abort). The Lot G prohibition says
"NEVER use an ellipsis ... as a key" — but the failing sections
(`acceptance-analysismjs-page-scanning`, `-helpers`) are many-helper
sections, and the behavioral signature is the model writing
`<!-- lw:anchors key1 key2 … -->` with `…` meaning "and so on" — a LIST
ABBREVIATION, not "a key". The model does not parse its `…` as violating
the as-a-key rule. The instruction must forbid the character anywhere
inside a marker and state that markers are never abbreviated.

## Non-negotiable rules

Same as Lots F/G: validators untouched; prompt text only;
provider-agnostic; previous contracts in force; no paid API calls; no
commits/pushes; English durable text; never touch `docs/benchmarks/**`,
`.claude/`, `.codegraph/`; never `git clean -fdx`.

## Deliverables

### H1. Initial prompt (`buildStage4Prompt`)

Strengthen the Lot G key-hygiene rule (keep byte-for-byte copying) with an
explicit no-abbreviation clause, e.g.:

> An `lw:anchors` marker is NEVER abbreviated: write every key in full,
> one by one, separated by spaces. The characters "…" or "..." must never
> appear ANYWHERE inside a marker — not as a key, not as a list
> continuation — a marker containing them is rejected outright. If a
> section has many keys, list them all.

Exact wording is yours; the mandatory elements are: never abbreviated /
every key in full / `…` and `...` forbidden anywhere inside a marker (not
only "as a key") / no exceptions for long lists.

### H2. Repair prompt parity (`buildRepairPrompt`)

The repair hard constraints gain the same clause. Additionally, when an
`anchor_outside_closed_list` error's `offending` is `…` or `...`, the
ACTION should say the marker was abbreviated and must be rewritten with
every key in full (still: remove the ellipsis, never substitute another
key arbitrarily).

### H3. Tests (`packages/core/src/prompts.test.ts`)

1. Initial prompt contains the no-abbreviation clause (assert stable
   substrings covering "never abbreviated" and both ellipsis forms).
2. Repair prompt hard constraints contain the same clause.
3. anchor_outside_closed_list with offending `…` (and `...`) produces the
   abbreviation-specific ACTION; a non-ellipsis offending key keeps the
   existing REMOVE ACTION unchanged.
4. Existing tests stay green; update only tests pinning the old rule
   string verbatim, and declare each update.

## Validation gates

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```

Changes ONLY in: `packages/core/src/prompts.ts`,
`packages/core/src/prompts.test.ts`.
