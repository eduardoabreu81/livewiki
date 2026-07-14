# Lot M — deterministic navigation layer (SENIOR)

**Date:** 2026-07-14
**Base commit:** `c30258c` (HEAD = origin/main)
**Normative document:**
`docs/tasks/2026-07-14-navigation-investigation/NAVIGATION-SPEC.md` — this
task implements its DETERMINISTIC recommendations. The spec's §"Scope and
product boundary" constraints are non-negotiable. All 7 open questions
were decided by the maintainer (2026-07-14) per the spec's own
recommendations: top-level `livewiki/tasks.md`; stage-2 title optional
with mandatory deterministic fallback; Navigate includes dependencies AND
dependents, combined cap 3, product-role preference; verbatim task-cue
reuse; no installation syntax in Quickstart. (The two new validation codes
belong to Lot N, not this lot.)

## Scope — DETERMINISTIC only, zero LLM involvement

### M1. SPEC.md delta (before code)

Document: the new deterministic Quickstart outline (spec §Q2), the new
`livewiki/tasks.md` page (spec §Q4 — path, owner: generated, no anchors,
manifest inclusion, verify link-checking, never enters the closed-key
denominator), the `displayTitle` presentation channel and its deterministic
fallback (spec §Q5 — explicitly listing everything displayTitle has NO
role in), the overview card format, and the per-page `## Navigate` block.

### M2. Deterministic Quickstart (`packages/core/src/init.ts`)

Implement the spec §Q2 outline exactly (headings, order, content rules).
Regenerated after batch completion like today. No provider config
required; no LLM client constructed. Cap: ≤100 nonblank lines / ≤700 words
in the English fixture. No ranked module list, no top-symbol dump, no
phase/test-count snapshot, no installation syntax.

### M3. `livewiki/tasks.md` assembly (`init.ts`)

Per spec §Q4: owner: generated; product task groups first (each product
module exactly once), then Fixture / Tooling-and-benchmark /
Documentation-maintenance sections; pre-stage-4 it uses deterministic
display-title fallbacks, post-stage-4 it reuses each accepted page's
`When to use this page` bullets VERBATIM when present (the bullets arrive
with Lot N — your machinery must handle both present and absent); links
only to existing pages, labeled unavailable text otherwise; no anchors, no
lw:anchors markers; included in the manifest snapshot.

### M4. `displayTitle` deterministic fallback

Readable label from shortest unique directory context + split ordinal
("Core source — part 3 of 5"), never the raw id. Used by overview cards
and tasks.md when no accepted frontmatter title exists. `Module.id`
remains the ONLY identity for filename, HTML fragments, task targets,
checkpoints, diagrams, graph nodes, and partition validation — pin with
tests (spec criterion 19, 28).

### M5. Architecture overview cards + `## Navigate` block

Overview cards per spec §Q4 (display title first, "module ID" labeled,
counts, ≤3 representative paths deterministic, existence-only links,
dependency/dependent neighbors by display title). Per-page deterministic
`## Navigate` block appended/regenerated after stage 4 (spec §Q3 end):
Quickstart, Tasks, Architecture, ≤3 related modules from direct
import-graph neighbors (dependencies AND dependents, product-role
preference, deterministic under input reordering); emitted only for
existing targets; no anchors; byte-for-byte manual-block preservation;
never touches `owner: human` pages.

### M6. Tests

Implement spec acceptance criteria **1-15, 19-20, 25-26, 28** (§5.1-5.3,
identity/ownership rows of §5.4, §5.6). Criteria 16-18, 21-24, 27, 30-31
belong to Lot N. Determinism criteria (2, 3, 15) need explicit
input-reordering tests. Verify must stay exit-0/zero-issues after init and
after a stubbed full batch (existing E2E patterns).

## Hard rules

No paid API calls; no prompt-text changes (Lot N owns prompts.ts); no new
validation codes; no commits/pushes; English durable text; never touch
`docs/benchmarks/**`, `.claude/`, `.codegraph/`; never `git clean -fdx`.
Expected files: `SPEC.md`, `packages/core/src/init.ts`,
`packages/core/src/modules.ts` (fallback title helper if it belongs
there), possibly a small new `packages/core/src/navigation.ts`, and test
files (+ `packages/core/src/index.ts` exports). If you need to touch
anything else, stop and ask the lead.

## Validation gates

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e.test.ts
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```
