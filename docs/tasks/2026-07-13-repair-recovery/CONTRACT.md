# Frozen contract — repair-prompt recovery (selective neutralization + no truncated repair)

**Date:** 2026-07-13
**Owner:** technical lead (single source of truth for Lots C and D; do not
deviate without lead approval)
**Base commit:** `efd9b21` (HEAD = origin/main)
**Evidence:** `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v11/`
(especially `metrics/batch-status.json`) and
`docs/tasks/2026-07-12-stage4-diagnostics/CONTRACT.md` (previous contract,
still in force).

## Root cause being fixed (proven by v11 diagnostics)

All three v11 initial attempts were near-passes (1-2 surgical errors on
16-24k-char candidates). Every completed repair attempt then collapsed to
69-80 `missing_closed_key` errors, ALL at `location: "section"`, NONE at
frontmatter. Two product defects cause this:

1. **Indiscriminate neutralization** — `buildRepairPrompt`
   (`packages/core/src/prompts.ts:279-282`) passes the prior candidate
   through `neutralizeUntrustedControlMarkers`, which whites out EVERY
   `lw:*` marker — including the candidate's own VALID section markers —
   and the prompt says markers "are NOT copyable syntax", while the error
   instructions demand minimal surgical edits. The model reproduces the
   document without section markers; the validator correctly rejects the
   whole section-side coverage. The repair path is structurally unable to
   succeed. (Frontmatter anchors are YAML, not `lw:*` markers, hence
   survive — exactly the asymmetry in the v11 data.)
2. **Silent truncation** — `REPAIR_PRIOR_CANDIDATE_CHAR_LIMIT = 16_000`
   amputates the embedded candidate; all three v11 initial candidates
   exceeded it (19,015 / 18,743 / 16,192 chars).

## Non-negotiable rules

- No paid API calls; stub LLM clients only.
- Validators are UNTOUCHED (`normalizeStage4Artifact`,
  `validateStage4Artifact`, verify). This fix changes only what the model
  is SHOWN, never what is ACCEPTED.
- The injection defense is not weakened: in every prompt surface, the only
  `lw:*` syntax that may survive is an `lw:anchors` marker whose keys are
  ALL byte-for-byte members of the closed list for THIS call. Everything
  else (fake markers, `lw:manual`, unknown `lw:*` types, malformed
  markers, any marker with one or more out-of-list keys) remains
  whitespace-neutralized exactly as today.
- Source context embedding remains FULLY neutralized (unchanged). The
  selective preservation applies ONLY to the prior-candidate block of the
  repair prompt.
- Provider-agnostic. No new magic constants (the embed limit is derived
  from the existing `charBudget` knob).
- English durable text; no commits/pushes by executors; never touch
  `docs/benchmarks/**`, `.claude/`, `.codegraph/`; never `git clean -fdx`.
- The previous contract (stage-4 diagnostics) remains in force: its state
  machine, `DiagnosticAttempt` shape, and invariants I1-I5 must not
  regress.

## Change 1 — selective neutralization for the repair candidate

New pure function in `packages/core/src/prompts.ts`:

```ts
/**
 * Repair-candidate variant of neutralizeUntrustedControlMarkers.
 * Preserves an lw:anchors marker verbatim IFF every whitespace-separated
 * key inside it is byte-for-byte present in closedKeyList. Every other
 * lw:* marker (any type, malformed, closing forms, lw:anchors with any
 * unknown key) is whitespace-neutralized (same-length spaces, exactly
 * like neutralizeUntrustedControlMarkers).
 */
export function neutralizeUntrustedControlMarkersExceptValidAnchors(
  text: string,
  closedKeyList: ReadonlyArray<string>,
): string;
```

Semantics:
- Match with the existing `LW_CONTROL_MARKER_RE` (single pass; do not
  introduce a second, weaker grammar).
- A match is preserved only if it ALSO matches the strict
  `LW_ANCHORS_RE` shape from `anchors.ts` AND its parsed key set is
  non-empty AND every key is in `closedKeyList` (exact string equality,
  case-sensitive). Duplicate keys inside one marker do not disqualify it
  (the validator handles duplicates; we only gate on list membership).
- Preserved means byte-for-byte untouched. Neutralized means same-length
  whitespace (today's behavior).
- Pure function: no mutation of inputs, deterministic.

`buildRepairPrompt` uses this function for the prior-candidate block ONLY.
The source block keeps `neutralizeUntrustedControlMarkers` unchanged.

The prior-candidate header text must be updated to match reality, e.g.:
"Prior candidate (what the validator saw; section markers whose keys are
all in the closed list are preserved and are the exact syntax to keep;
every other lw:* marker has been neutralized and is NOT copyable syntax;
do NOT copy invalid keys)". Exact wording is the senior executor's call,
but it MUST no longer claim all markers were neutralized, and MUST still
tell the model not to copy invalid keys.

## Change 2 — never repair against a truncated candidate

- `buildRepairPrompt` gains a required `maxCandidateChars: number`
  parameter replacing the module-level 16k constant as the effective
  limit. It still applies `.slice(0, maxCandidateChars)` as
  defense-in-depth, but the orchestrator guarantees it never triggers
  (see below). Delete or deprecate `REPAIR_PRIOR_CANDIDATE_CHAR_LIMIT`
  as the behavioral limit; if kept as an export for compatibility, it
  must no longer gate the embed.
- In the stage-4 loop (`packages/core/src/batch.ts`), when the state
  machine would set `nextPromptKind = "repair"` (completed-but-invalid
  candidate), add the gate:
  `if (priorCandidate.length > charBudget) → fresh instead`
  (clear `priorCandidate`/`priorErrors`, `nextPromptKind = "initial"`),
  where `charBudget` is the existing
  `opts.contextCharBudget ?? 60_000` value already passed to
  `attemptStage4Generation`. No new knob, no new constant.
- When the gate fires, the NEXT attempt is a fresh initial generation.
  Its `DiagnosticAttempt.promptKind` will read `"initial"`; the reason is
  derivable from the previous entry's `candidateChars` exceeding the
  budget. OPTIONAL (senior's call): an additive optional field
  `promptKindReason?: "oversized_candidate"` on `DiagnosticAttempt` — if
  added, it must be optional, backward compatible (I5), and documented in
  SPEC.md.
- The state-machine table gains one row; everything else in the previous
  contract's table is unchanged:

| Previous outcome | Next promptKind |
|---|---|
| completed-but-invalid AND candidate chars > charBudget | `initial` (fresh; repair inputs cleared) |

## SPEC.md delta (required, before code)

Document: selective preservation rule (exact criterion: all keys in the
closed list), full-candidate embed with the charBudget-derived bound and
the fresh-generation fallback, and the injection-defense invariant (only
provably-valid `lw:anchors` markers may survive in any prompt).

## Validation gates (both lots)

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```

All existing tests must stay green EXCEPT tests that pin today's defective
behavior (full neutralization of the repair candidate / 16k truncation);
those are updated to this contract and each update must be declared in the
executor summary.
