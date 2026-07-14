# Lot N — page-opening contract, semantic titles, factual precision (SENIOR)

**Date:** 2026-07-14
**Starts ONLY after Lot M is approved in the working tree.**
**Normative document:**
`docs/tasks/2026-07-14-navigation-investigation/NAVIGATION-SPEC.md` — this
task implements its PROMPT recommendations plus the two maintainer-approved
validation codes. Maintainer decisions (2026-07-14): missing opening is a
REPAIRABLE artifact-validation error (single structured code); the
validator rejects a PRODUCT page whose title exactly equals its stable id
(deterministic fallback remains permitted for failed/absent pages);
stage-2 may optionally suggest displayTitle but the deterministic fallback
is mandatory (`--no-refine` is a supported path).

## Scope

### N1. SPEC.md delta (before code)

The stage-4 page-opening contract (spec §Q3 block, verbatim rules), the
two new validation codes and their exact semantics, the semantic-title
requirement, the literal-signature rule and the exception-branch rule
(spec §Q7, both quoted rules), and the optional stage-2 title channel.

### N2. Stage-4 prompts (`packages/core/src/prompts.ts`)

Initial AND repair prompts carry the same contract:
- Required opening after frontmatter, before the first anchored section:
  H1 semantic title, one responsibility sentence, `## When to use this
  page` (2-4 verb-led bullets), `## How it fits` (short paragraph, no
  complete-call-graph claim). No lw:anchors markers in the opening; no
  path-inventory dump; no "entry point" claims from symbol counts; honest
  task context for fixtures/tooling pages.
- Title rule: concise responsibility title; NEVER the stable id alone.
- Literal-signature rule and exception-branch rule: the two quoted rules
  in spec §Q7, verbatim in spirit (byte-for-byte signature from the
  symbols table, once per primary function per section; no invention when
  the table has no signature; visible material branches described or the
  prose explicitly scoped to the normal path; no absolute language while
  omitting a visible exception; truncation acknowledged).
- Repair ACTION lines for the two new codes (see N3), in the established
  mechanical-ACTION style.

### N3. Two new validation codes (`packages/core/src/artifact.ts`)

1. `missing_page_opening` (name at your discretion, single code): fires
   when the required opening structure (H1 + responsibility sentence +
   `When to use this page` with 2-4 bullets + `How it fits`) is absent or
   out of order before the first section marker. REPAIRABLE (normal repair
   path). Structural check only — never a semantic/quality judgment.
2. `title_equals_module_id`: fires for PRODUCT modules when the
   frontmatter title exactly equals the stable module id. Auxiliary
   modules (fixtures/tooling/docs roles) exempt. REPAIRABLE.
Both: precise structured errors (location, offending, sectionSlug where
meaningful), capped per the diagnostics contract; NO changes to
closed-list, exactly-once, fence-aware, or coverage logic. NO semantic
signature validator (spec §Q7: validator implication none — signature
discipline is prompt + fixture work only).

### N4. Optional stage-2 title (`packages/core/src/modules.ts` refine path)

Stage-2 refinement may return a per-module `displayTitle` independent of
`id`. Missing/malformed/duplicate/low-quality titles degrade silently to
the deterministic fallback (Lot M) and NEVER reject an otherwise exact
partition. `--no-refine` path unaffected.

### N5. Tests

Implement spec acceptance criteria **16-18, 21-24, 27, 30-31** (§5.4
content rows, §5.5, §5.7 route exercise using the full stack with stubbed
LLM producing compliant pages). Plus: both new codes fire and repair
correctly with scripted stubs (invalid opening → repair prompt carries the
ACTION → corrected page accepted); auxiliary-module exemption for the
title rule; stage-2 title degradation cases; existing gates green
(criterion 25, 29).

## Hard rules

Same as always: no paid API calls; no commits/pushes; English durable
text; never touch `docs/benchmarks/**`, `.claude/`, `.codegraph/`; never
`git clean -fdx`. Do not modify Lot M's deterministic outputs beyond
consuming the accepted frontmatter titles where the spec says so.
Expected files: `SPEC.md`, `packages/core/src/prompts.ts`,
`packages/core/src/artifact.ts`, `packages/core/src/modules.ts`, and test
files. If you need more, stop and ask the lead.

## Validation gates

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e.test.ts
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```
