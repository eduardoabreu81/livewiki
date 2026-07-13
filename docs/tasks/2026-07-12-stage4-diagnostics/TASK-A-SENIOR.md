# Lot A — stage-4 diagnostic persistence + attempt state machine (SENIOR)

**Read first, fully and in this order:**
1. `AGENTS.md`
2. `docs/benchmarks/2026-07-10-minimax-m3/HANDOVER-2026-07-12.md`
3. `docs/tasks/2026-07-12-stage4-diagnostics/CONTRACT.md` — the frozen
   contract. It overrides any interpretation you form from the other two.

**Preconditions to verify before touching code:**
- `git rev-parse HEAD origin/main` → both `74dba09`.
- `git status --short` shows only the known untracked entries (handover,
  `.claude/`, `.codegraph/`, `docs/tasks/`, rerun directories). Touch none
  of them.
- `pnpm -r build` and `pnpm -r test` are green at base.

**Hard rules:** no paid API calls (stub LLM clients only); no commits or
pushes — leave all changes in the working tree for lead review; English for
all new durable text; never weaken a validator; branch on normalized
`StopReason` semantics only, never on raw provider strings.

## Scope — what you deliver

### A1. SPEC.md delta (write this BEFORE code)

Add to `SPEC.md` (batch pipeline / stage 4 section):

- The `diagnosticHistory` checkpoint field: purpose, shape (reference the
  contract), append-only + seeding semantics, 1:1 invariant with
  `usageHistory`, content-safety guarantees.
- The attempt state machine table from the contract (fresh vs repair),
  including: `length` and `incomplete` never feed a repair candidate;
  `unknown` still flows to validation as a completed candidate; the
  "immediately previous attempt only" rule.
- Truthful `repair_exhausted` reporting requirement (per-attempt ordered
  summary, real totals).

Keep the delta minimal and surgical — do not restructure SPEC.md.

### A2. Types in `packages/core/src/batch-state.ts`

Implement `DiagnosticOutcome`, `DiagnosticErrorSummary`,
`DiagnosticAttempt`, `DIAGNOSTIC_TEXT_CAP`, `DIAGNOSTIC_MAX_ERRORS`, and
`TaskCheckpoint.diagnosticHistory?` EXACTLY as written in the contract.
Export everything Lot B will need (it builds reporting on these types).
Add a pure helper (in `batch-state.ts` or a small new module) that converts
`ArtifactValidationError[]` → capped `DiagnosticErrorSummary[]` +
`truncatedErrorCount`, applying `DIAGNOSTIC_TEXT_CAP` and
`DIAGNOSTIC_MAX_ERRORS`. Immutable: never mutate the input errors.

### A3. Stage-4 loop in `packages/core/src/batch.ts`

Current loop: `batch.ts:513-645`; attempt function: `batch.ts:1528-1687`.

1. **Record one `DiagnosticAttempt` per LLM attempt**, for every outcome
   including `success` and `llm_timeout` (see contract I1). The outcome
   category is decided where the loop already distinguishes these cases:
   - `llmError` branch → `llm_error`
   - stop reason branch (`batch.ts:1632-1654`) → `incomplete_generation` or
     `truncated_by_token_limit` (keep the two existing validation codes)
   - normalization failure → `normalization_failed`
   - closed-list validation failure → `artifact_validation_failed`
   - `tryWriteAndVerify` rejection → `verify_failed`
   - accepted write → `success`
2. **Seed from the previous checkpoint** exactly like `usageHistory`
   (`batch.ts:476-479`), and persist `diagnosticHistory` in BOTH the failure
   checkpoint and the success checkpoint writes.
3. **Replace positional `isRepair: i > 0`** with explicit
   `nextPromptKind: "initial" | "repair"` per the contract's state machine.
   Consequences you must implement:
   - After `incomplete_generation` or `truncated_by_token_limit`: clear
     `priorCandidate`/`priorErrors`; next attempt is a FRESH initial prompt
     (same authoritative closed list and source context). Do NOT feed the
     partial candidate into `buildRepairPrompt`.
   - After non-timeout `llm_error`: next attempt is also a fresh initial
     prompt (fixes the current degenerate empty-candidate repair).
   - After a completed-but-invalid candidate (normalization / validation /
     verify): unchanged — repair prompt with that attempt's exact candidate
     and structured errors.
   - `llm_timeout` remains terminal for the task; rollback and circuit
     breaker behavior unchanged.
4. **Do not change**: usage accounting, cost computation, global attempt
   counter semantics, `usageHistory` shape, bounded loop size, exit codes.

Do NOT remove `priorCandidate`/`priorErrors` — they remain the ephemeral
inputs for repair prompts (handover requirement).

### A4. Tests (extend `packages/core/src/batch-repair.test.ts`)

Use the existing scripted stub LLM seam (extend it if it cannot yet script
a per-call sequence of `stopReason`/`rawStopReason`/content). Required
scenarios (H# = handover's required regression tests):

1. **H1:** `stop`+invalid, `stop`+invalid, `abort` — three diagnostics
   persist, ordered, with correct outcomes, promptKinds
   (`initial`, `repair`, `repair`) and 1:1 attempt join with usageHistory.
2. **H2:** `abort`, `stop`+invalid, `abort` — ordered history persists;
   promptKinds are (`initial`, `initial`, `repair`).
3. **H3:** after an incomplete response, the next attempt's prompt is a
   FRESH stage-4 generation: assert (via the stub's captured prompts) that
   no fragment of the partial candidate appears in the next user prompt and
   that `buildStage4Prompt` (not the repair template) was used.
4. **H4:** a completed invalid response still produces a repair prompt
   containing its exact structured error codes.
5. **F4 mixed case, both orders:** `stop`+invalid → `abort` → attempt 3 is
   FRESH (the older invalid candidate is NOT resurrected); and
   `abort` → `stop`+invalid → attempt 3 is REPAIR of attempt 2's candidate.
6. **`length` policy:** a `length` response behaves like `incomplete`
   (fresh next attempt) but records `truncated_by_token_limit`.
7. **I2 seeding:** run a task to failure, then rerun via the `--only`
   path — `diagnosticHistory` appends across runs and `attempt` stays
   globally monotonic.
8. **I4 content safety:** with an oversized candidate and >50 validation
   errors, persisted entries are capped (`DIAGNOSTIC_MAX_ERRORS`,
   `DIAGNOSTIC_TEXT_CAP`), `truncatedErrorCount` is exact, and no raw
   candidate/source/prompt text is present in the serialized checkpoint.
9. **`llm_timeout`:** diagnostic entry appended with `outcome: "llm_error"`,
   task still fails terminally as today.
10. **Success:** accepted page appends a `success` entry with
    `candidateChars`/`candidateSha256` present and empty `errors`.

### Out of scope for you (Lot B owns it)

`repair_exhausted` message rewrite, `batch-status.ts`, CLI formatters,
key-leak test extension, backward-compat checkpoint-loading tests. Keep the
existing `repair_exhausted` construction compiling (Lot B will replace it);
if your state changes force a minimal touch there, keep it behavior-neutral.

## Definition of done

- `pnpm -r build` green; `pnpm -r test` green (including ALL pre-existing
  tests — if an existing test fails, fix your code, not the test, unless the
  test encodes the old positional-repair behavior, in which case update it
  to the contract and say so in your summary);
  `pnpm --filter @livewiki/core test -- src/key-leak.test.ts` green.
- `git status` shows changes ONLY in: `SPEC.md`,
  `packages/core/src/batch-state.ts`, `packages/core/src/batch.ts`,
  `packages/core/src/batch-repair.test.ts`, and (if strictly needed) the
  stub LLM test helper and `packages/core/src/index.ts` exports.
- No commit, no push. Write a short summary (what changed, test counts
  before/after, any deviation from the contract with justification) and
  hand back to the lead.
