# Lot J — fence-aware marker semantics (SENIOR)

**Date:** 2026-07-14
**Base commit:** `3bd7572` (HEAD = origin/main)
**Maintainer decision:** approved 2026-07-14 after clean v17.
**Evidence:** `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v17/`
(read-only — never modify anything under `docs/benchmarks/`).

## Root cause (diagnosed and code-confirmed by the lead)

The `tools` module failed v15/v16/v17 with ellipsis `anchor_outside_closed_list`
errors and — decisively in v17 — ZERO `missing_closed_key` errors: coverage
was complete and the ellipsis was an EXTRA token. The module documents the
benchmark scripts that scan `lw:anchors` markers; a model documenting them
correctly shows the marker syntax as an example inside a fenced code block.

The validator parses that example as a real marker:

- `packages/core/src/artifact.ts:279-297` — the section-marker regex runs
  over the RAW body, no code masking.
- Inconsistently, the SAME file masks code before the TODO/TBD check
  (`artifact.ts:448`, `maskCodeSpans`), and `verify.ts:180` masks code
  before link scanning (commit `4f7bbaa` — the established product
  semantic: fenced/inline code is display text).
- `packages/core/src/anchors.ts` (`extractAnchors`, used by verify and the
  ledger) is equally fence-unaware.

Markers were the one structural surface missing that semantic. This is a
correctness fix, not a validator weakening: coverage requirements are
unchanged; a marker inside code was never a legitimate anchor.

## Frozen design (do not deviate)

1. **New length-preserving mask** in `packages/core/src/markdown-mask.ts`:
   a variant of `maskCodeSpans` that blanks fenced-block and inline-code
   content with SPACES of the same length and preserves the original line
   terminators, so byte offsets in the masked text are valid in the
   original. (The existing `maskCodeSpans` collapses lines and normalizes
   CRLF — it must remain unchanged for its current callers.) Reuse the
   existing fence state machine; do not write a second, weaker one.
2. **`artifact.ts`**: the section-marker scan AND the heading scan used to
   associate markers with sections run over the length-preserving masked
   view. NOTHING ELSE changes in this lot — the empty-section prose check,
   frontmatter checks, TODO check, and unclosed-markdown detection keep
   their exact current inputs and semantics.
3. **`anchors.ts`**: `extractAnchors` masks the source with the
   length-preserving variant before scanning for `lw:anchors` markers (and
   heading association, if applicable). Recorded byte offsets remain valid
   in the ORIGINAL text. Frontmatter parsing untouched.
4. **Prompt (one sentence, initial + repair)**: markers inside fenced code
   blocks are never parsed as real markers — to show marker syntax as an
   example, put it inside a fenced code block. (This gives the model the
   legitimate outlet the tools module needs.)
5. Provider-agnostic; validators' acceptance criteria unchanged except the
   defined semantic: code-fenced/inline-code markers are display text
   everywhere (artifact validation, verify, ledger — consistent).

## Deliverables

### J1. SPEC.md delta (before code)

Anchors and section markers are recognized only OUTSIDE Markdown code
(fenced blocks and inline spans), consistent with link verification and
TODO checks. A marker inside code is a syntax example, not an anchor —
in artifact validation, verify, and the ledger alike. Note the migration
implication: an existing page with a marker inside a fence loses that
anchor (it was never legitimate).

### J2. `markdown-mask.ts` — length-preserving variant

Per frozen design item 1, with unit tests: offsets stable, CRLF-safe,
unclosed fence masks to end (mirroring existing behavior), inline spans,
mixed content; existing `maskCodeSpans` byte-for-byte unchanged for its
callers.

### J3. `artifact.ts` + `anchors.ts`

Per frozen design items 2-3.

### J4. Prompt sentence

Per frozen design item 4, in `buildStage4Prompt` and `buildRepairPrompt`
hard constraints.

### J5. Tests

1. **The v17 `tools` shape** (artifact validation): full closed-list
   coverage in frontmatter and real markers, PLUS a fenced code block
   containing `<!-- lw:anchors ... -->` (and a `…` variant, and a
   valid-looking marker with real keys) → artifact ACCEPTED; no
   anchor_outside_closed_list, no duplicate_anchor from the fenced
   examples.
2. Enforcement outside fences intact: an out-of-list key in a REAL marker
   still rejects; duplicates across real markers still reject; a real
   marker missing from coverage still rejects (fenced copies do NOT count
   toward coverage — assert a key present ONLY inside a fence yields
   missing_closed_key).
3. Inline code: `` `<!-- lw:anchors x -->` `` in prose is ignored.
4. `anchors.ts`: extractAnchors ignores fenced markers; offsets of real
   markers unchanged vs today (pin with a fixture containing both).
5. Verify-level: a wiki page with a fenced marker example passes verify
   without broken_anchor for the example keys.
6. Heading association: a fake heading inside a fence does not become a
   section for slug purposes.
7. prompts.test.ts: both prompts contain the fenced-example sentence.
8. Key-leak stays green.

## Non-negotiable rules

Previous contracts in force (diagnostics I1-I5, repair state machine,
retry budget). No paid API calls; no commits/pushes; English durable text;
never touch `docs/benchmarks/**`, `.claude/`, `.codegraph/`; never
`git clean -fdx`.

Changes ONLY in: `SPEC.md`, `packages/core/src/markdown-mask.ts`,
`packages/core/src/artifact.ts`, `packages/core/src/anchors.ts`,
`packages/core/src/prompts.ts`, and test files.

## Validation gates

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```
