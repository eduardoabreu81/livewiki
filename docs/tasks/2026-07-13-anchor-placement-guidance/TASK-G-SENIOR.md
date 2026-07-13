# Lot G — anchor placement guidance (SENIOR)

**Date:** 2026-07-13
**Base commit:** `0f6436e` (HEAD = origin/main)
**Evidence:** `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v14/`
(especially `metrics/batch-status.json`). Read-only — never modify anything
under `docs/benchmarks/`.

## Root cause (diagnosed by the lead from v14 diagnostics)

v14 reached 11/13 with three on-wire repair recoveries (the Lot F
duplicate_anchor recipe works). The two remaining failures:

1. **`core-src-03` — thematic duplicating section.** Every duplicate (17 →
   15 → 12 across attempts) sits in ONE section, `test-helpers`: the model
   created a roundup section re-anchoring symbols already anchored in
   their per-file sections. Repair converges too slowly because the ACTION
   says "delete the extra occurrence(s)" without saying WHERE — even
   though the error's `sectionSlug` already names the surplus site.
2. **`tools` — ellipsis anchors on fresh generations.** Both failed
   attempts were INITIAL prompts emitting `...` / `…` as anchor keys while
   documenting the benchmark scripts. The prohibition "NEVER keep ellipsis
   or placeholder tokens as keys" exists ONLY in the repair prompt
   (`prompts.ts`, repair hard constraints); the initial prompt never
   states it.

## Non-negotiable rules

Same as Lot F: validators untouched; prompt text only; provider-agnostic;
previous contracts (diagnostics, repair-recovery) must not regress; no
paid API calls; no commits/pushes; English durable text; never touch
`docs/benchmarks/**`, `.claude/`, `.codegraph/`; never `git clean -fdx`.

## Deliverables

### G1. Site-specific duplicate_anchor ACTION (`buildRepairPrompt`)

Rework the Lot F ACTION so it uses the error's `sectionSlug` when present:
the key must be DELETED from THIS section's marker (the one named in the
error) because it already appears in its proper marker elsewhere; when
`location` is frontmatter, delete the extra list entry instead. Keep the
aggregate-marker clause. The instruction must be mechanical — say exactly
which marker to edit, leaving the model no placement decision.

### G2. Initial prompt parity — ellipsis/placeholder prohibition

`buildStage4Prompt` gains the same rule the repair prompt already has:
anchor keys are copied byte-for-byte from the closed list ONLY; NEVER an
ellipsis (`...` or `…`), placeholder, or example token — including when
the documented source itself contains marker-like examples.

### G3. Initial prompt — primary-section rule

Add: a symbol relevant to several sections gets its key in EXACTLY ONE
marker — the section that primarily documents it; other sections may
reference it in prose but NEVER in their marker. Do not create a roundup/
thematic section (e.g. "helpers", "utilities") whose marker re-lists keys
that belong to other sections' markers.

### G4. Tests (`packages/core/src/prompts.test.ts`)

1. duplicate_anchor ACTION with a `sectionSlug` names that exact section
   as the deletion site; frontmatter-location variant names the
   frontmatter list.
2. Initial prompt contains the ellipsis/placeholder prohibition.
3. Initial prompt contains the primary-section / no-roundup-marker rule.
4. Existing tests stay green; update only tests pinning the old ACTION
   string verbatim, and declare each update.

## Validation gates

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```

Changes ONLY in: `packages/core/src/prompts.ts`,
`packages/core/src/prompts.test.ts`.
