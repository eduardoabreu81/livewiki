# Lot O — page-opening validator tolerance + granular diagnostics (SENIOR)

**Date:** 2026-07-14
**Blocks:** clean v20 benchmark rerun. Nothing else starts until this lot is
approved in the working tree.

## Context (read first)

Clean v19 (evidence preserved under
`docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/` — do NOT modify)
ran the Lot N page-opening contract against the real MiniMax-M3 model for
the first time and **FAILED**: `core-src-02` consumed all repair attempts
with `missing_page_opening` persisting across every attempt, and
`core-src-03` failed on a mix of truncation, `anchor_outside_closed_list`,
and `missing_page_opening`. The batch aborted with 2/24 pages.

Root cause analysis (lead, 2026-07-14): the structural check
`hasRequiredPageOpening()` (`packages/core/src/artifact.ts:548`) is
stricter than what the prompt promises, in ways a real LLM violates
habitually while being right in spirit:

1. Task bullets must start with a **letter** (`/^[-*+]\s+\p{L}/u`).
   A bullet like `- **Run** the CLI …` or `` - `livewiki init` … `` fails.
   The prompt only asks for "verb-led bullets" and never forbids bold or
   inline code.
2. The H2 headings must match `When to use this page` / `How it fits`
   **case-sensitively**. Title Case output (`When to Use This Page`) fails.
3. The `How it fits` block must be **exactly one** paragraph; two short
   paragraphs fail.
4. The structured error is generic: `offending` carries the *expected*
   structure, not what the page actually contained, so every repair prompt
   gets the same undifferentiated ACTION and the model repeats the mistake.
   This violates the spirit of the diagnostics contract (precise location,
   offending text).

This was the exact "Medium" risk the NAVIGATION-SPEC recommendation table
flagged for the structural-opening requirement. Maintainer decision: loosen
presentation-irrelevant strictness; keep the check structural.

## Scope

### O1. Validator tolerance (`packages/core/src/artifact.ts`)

Loosen `hasRequiredPageOpening` (and only it — no other validation logic):

- Bullets: accept any non-empty content after the bullet marker
  (bold, inline code, links). Keep the 2–4 cardinality.
- Headings: match `When to use this page` and `How it fits`
  case-insensitively (exact words, `##` level, optional trailing
  whitespace only — no fuzzy matching).
- `How it fits`: accept one **or more** prose paragraphs; still reject
  headings, bullets, and `lw:` markers inside the block.
- Responsibility block (between H1 and `When to use this page`): unchanged
  (single prose paragraph).
- H1 requirement and overall order: unchanged.

### O2. Granular diagnostics (same file)

Refactor the boolean `hasRequiredPageOpening` into a check that reports
**which element failed first** (missing/late H1; missing or malformed
responsibility paragraph; missing `When to use this page`; bullet count
out of 2–4; missing `How it fits`; malformed `How it fits` block). The
single code stays `missing_page_opening`; the structured error must now
carry:

- `message`: names the failing element specifically;
- `offending`: the actual offending line/snippet found (or a `"(absent)"`
  placeholder), NOT the expected structure;
- location/sectionSlug semantics and the persistence cap unchanged.

### O3. Repair ACTION passthrough (`packages/core/src/prompts.ts`)

The `missing_page_opening` repair ACTION stays mechanical but must surface
the granular element so the model fixes the right thing (e.g. prefix the
existing full-structure ACTION with the specific failure taken from the
error message). Initial prompt rules: clarify that bullets may use bold or
inline code and that heading casing shown is canonical but matching is
case-insensitive — do NOT weaken any other rule.

### O4. SPEC.md alignment

The Lot N spec text describes the opening check. Update it to the
tolerated semantics (bullet content, case-insensitive headings, 1+
paragraphs in How it fits, granular error payload). Normative text only;
no restructuring.

### O5. Tests

- Unit tests: each tolerance accepted (bold bullet, inline-code bullet,
  Title Case headings, two-paragraph How it fits) and each granular
  failure reported with the correct message/offending payload.
- Repair-loop test with a scripted stub: first attempt fails with a
  specific element, the repair prompt carries that element, the corrected
  page is accepted.
- Existing gates stay green; no changes to closed-list, exactly-once,
  fence-aware, coverage, or title_equals_module_id logic.

## Hard rules

Same as always: no paid API calls; no commits/pushes (lead reviews the
working tree); English durable text; never touch `docs/benchmarks/**`,
`.claude/`, `.codegraph/`; never `git clean -fdx`. Expected files:
`SPEC.md`, `packages/core/src/artifact.ts`,
`packages/core/src/prompts.ts`, and test files. If you need more, stop
and ask the lead.

## Validation gates

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e.test.ts
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```
