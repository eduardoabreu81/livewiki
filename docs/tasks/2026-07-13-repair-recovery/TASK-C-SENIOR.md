# Lot C — repair-prompt recovery implementation (SENIOR)

**Read first, fully and in this order:**
1. `AGENTS.md`
2. `docs/tasks/2026-07-13-repair-recovery/CONTRACT.md` — the frozen
   contract; it overrides any other interpretation.
3. `docs/tasks/2026-07-12-stage4-diagnostics/CONTRACT.md` — previous
   contract, still in force (state machine, DiagnosticAttempt, I1-I5).
4. The v11 evidence summary in
   `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v11/notes.md`
   (read-only — never modify anything under docs/benchmarks/).

**Preconditions:** `git rev-parse HEAD origin/main` → both `efd9b21`;
`pnpm -r build` and `pnpm -r test` green at base (expected: 667 passed,
8 skipped).

**Hard rules:** no paid API calls; no commits/pushes — leave changes in the
working tree; English durable text; validators untouched; injection defense
per the contract (only provably-valid `lw:anchors` markers may survive);
source-block neutralization unchanged.

## Deliverables

### C1. SPEC.md delta (before code)

Per the contract's "SPEC.md delta" section. Minimal and surgical.

### C2. `neutralizeUntrustedControlMarkersExceptValidAnchors` in `prompts.ts`

Exactly per the contract (signature, semantics, purity). Reuse
`LW_CONTROL_MARKER_RE` for matching and the strict `lw:anchors` shape
(mirror `LW_ANCHORS_RE` in `anchors.ts` — import it or re-derive
identically; do not invent a looser grammar).

### C3. `buildRepairPrompt` changes

- Prior-candidate block uses the new selective function with this call's
  `closedKeyList`.
- New required `maxCandidateChars` parameter; `.slice(0, maxCandidateChars)`
  kept as defense-in-depth. The 16k constant no longer gates the embed.
- Header text updated per the contract (no longer claims all markers are
  neutralized; still forbids copying invalid keys).
- Source block: UNCHANGED (full neutralization).

### C4. Stage-4 loop gate in `batch.ts`

- Thread `charBudget` into the repair decision: where the state machine
  sets `nextPromptKind = "repair"`, apply the oversized-candidate gate
  from the contract (fresh instead; repair inputs cleared).
- Pass `maxCandidateChars = charBudget` to the attempt/prompt path.
- If you adopt the optional `promptKindReason?: "oversized_candidate"`
  field, keep it additive and I5-compatible, and add it to the SPEC delta.
- Do NOT change anything else in the state machine, diagnostics recording,
  usage accounting, or circuit breaker.

### C5. Tests

Extend `packages/core/src/prompts.test.ts` and
`packages/core/src/batch-repair.test.ts`:

1. Selective function: a valid marker (all keys in list) is preserved
   byte-for-byte; a marker with ONE out-of-list key is fully neutralized;
   `lw:manual` open/close forms neutralized; unknown `lw:*` types
   neutralized; malformed marker neutralized; empty-key marker
   neutralized; same-length whitespace invariant holds.
2. Repair prompt: prior candidate's valid section markers appear intact in
   the user prompt; fake markers embedded in the same candidate do not
   survive; source-block markers (valid-looking or not) never survive.
3. Oversized gate: with a small `contextCharBudget` override, a
   completed-but-invalid candidate longer than the budget leads to a FRESH
   next attempt (captured stub prompts prove the initial template, no
   candidate fragment embedded); a candidate within budget still leads to
   a repair attempt embedding the FULL candidate (no truncation at 16k —
   use a >16k candidate within a larger budget to pin this).
4. v11 regression shape: near-miss candidate (>16k chars, valid markers,
   one surgical error) → repair prompt contains the intact markers and the
   full candidate; scripted stub returns the corrected page → task done.
5. Existing untrusted-content tests in `prompts.test.ts`: keep green; if
   one pins full neutralization of the repair candidate, update it to the
   contract and declare it.

## Definition of done

- `pnpm -r build`, `pnpm -r test`, key-leak — all green.
- Changes ONLY in: `SPEC.md`, `packages/core/src/prompts.ts`,
  `packages/core/src/batch.ts`, `packages/core/src/prompts.test.ts`,
  `packages/core/src/batch-repair.test.ts` (+ `batch-state.ts` and
  `packages/core/src/anchors.ts` export ONLY if strictly needed for the
  optional field / regex reuse).
- No commit, no push. Summary: what changed per file, test counts
  before/after, every pre-existing test you updated and why, and whether
  you adopted the optional `promptKindReason` field.
