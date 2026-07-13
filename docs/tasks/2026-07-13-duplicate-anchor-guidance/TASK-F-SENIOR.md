# Lot F — duplicate_anchor prompt guidance (SENIOR)

**Date:** 2026-07-13
**Base commit:** `890c33a` (HEAD = origin/main)
**Evidence:** `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v13/`
(especially `metrics/batch-status.json`). Read-only — never modify anything
under `docs/benchmarks/`.

## Root cause (diagnosed by the lead from v13 diagnostics)

v13 reached 10/13 pages with one on-wire repair recovery. Two of the three
remaining failures share one signature: `duplicate_anchor` errors that
persist IDENTICALLY across all repair attempts (`fase2-repo-src`: the same
4 keys, 3 attempts; `core-src-01`: every key exactly 2× — the signature of
an aggregate/summary `lw:anchors` marker at the top of the page PLUS the
per-section markers). Two product-side prompt defects make this a dead end:

1. The repair prompt's structured-error block has NO `ACTION` line for
   `duplicate_anchor` (`packages/core/src/prompts.ts:258-278` covers the
   other five codes). The model gets the error name and no fix recipe.
2. Since the repair-recovery fix, the prior-candidate header
   (`prompts.ts:303`) tells the model that preserved valid markers "are
   the exact syntax to keep" — and BOTH copies of a duplicated key are
   valid markers, so the prompt actively instructs the model to keep both.

## Non-negotiable rules

- Validators UNTOUCHED — this lot changes prompt text (initial + repair)
  and nothing about what is accepted.
- Provider-agnostic; no model-, module-, or benchmark-specific branches.
- The two previous contracts remain in force
  (`docs/tasks/2026-07-12-stage4-diagnostics/CONTRACT.md`,
  `docs/tasks/2026-07-13-repair-recovery/CONTRACT.md`): state machine,
  diagnostics, selective neutralization semantics must not regress.
- No paid API calls; no commits/pushes; English durable text; never touch
  `docs/benchmarks/**`, `.claude/`, `.codegraph/`; never `git clean -fdx`.

## Deliverables

### F1. Initial stage-4 prompt (`buildStage4Prompt`)

Add an explicit uniqueness rule alongside the COMPLETENESS rule
(`prompts.ts:131`): every closed-list key must appear EXACTLY ONCE in the
frontmatter anchors list and EXACTLY ONCE across the union of all section
markers — once per location, no more. Explicitly forbid an aggregate or
summary `lw:anchors` marker that lists all (or many) keys in one place in
addition to per-section markers: each key belongs to exactly one section
marker, the one for the section that documents it. Wording is yours;
the two behaviors (exactly-once + no aggregate marker) are mandatory.

### F2. Repair prompt — ACTION for `duplicate_anchor`

In the errorLines block (`prompts.ts:255-279` region), add:

```
if (e.offending && e.code === "duplicate_anchor") → ACTION: this exact key
appears more than once in <location>; DELETE the extra occurrence(s) and
keep EXACTLY ONE. If the page has an aggregate/summary lw:anchors marker
duplicating per-section keys, delete the aggregate marker entirely.
```

Adapt phrasing to match the surrounding ACTION style; keep the two
imperatives (delete extras / kill aggregate marker).

### F3. Repair prompt — preservation caveat

Amend the prior-candidate header (`prompts.ts:303`) and/or the hard
constraints so the preservation statement no longer contradicts duplicate
fixes: preserved markers are the correct SYNTAX reference, but when a
structured error names a key as `duplicate_anchor`, the extra preserved
copies MUST be deleted — preservation is not an instruction to keep every
occurrence.

### F4. Mirror the uniqueness rule in the repair hard constraints

The repair system prompt's COMPLETENESS line (`prompts.ts:238`) should
gain the same exactly-once-per-location clause as F1, so initial and
repair prompts state identical rules.

### F5. Tests (`packages/core/src/prompts.test.ts`)

1. Initial prompt contains the exactly-once rule and the no-aggregate-
   marker prohibition (assert on stable substrings).
2. Repair prompt with a `duplicate_anchor` error (with `offending` and
   `sectionSlug`) emits the new ACTION line including the offending key.
3. Repair prompt preservation text includes the duplicate-deletion caveat.
4. Existing prompt tests stay green; update only tests that pin the old
   header/constraint strings verbatim, and declare each update.

### F6. SPEC.md

Only if SPEC quotes the prompt rules text; otherwise no SPEC change (the
validator behavior — duplicate_anchor rejected — is already specified).

## Validation gates

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```

Changes ONLY in: `packages/core/src/prompts.ts`,
`packages/core/src/prompts.test.ts` (+ `SPEC.md` only per F6).
