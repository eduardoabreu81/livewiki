# Lot B — truthful reporting + regression hardening (MID-LEVEL)

**Starts ONLY after Lot A is delivered and green in the working tree.**
You build on Lot A's uncommitted changes — do not revert or rework them; if
something in Lot A blocks you, stop and report to the lead instead of
changing Lot A's semantics.

**Read first, fully and in this order:**
1. `AGENTS.md`
2. `docs/benchmarks/2026-07-10-minimax-m3/HANDOVER-2026-07-12.md`
3. `docs/tasks/2026-07-12-stage4-diagnostics/CONTRACT.md` — frozen contract.
4. `docs/tasks/2026-07-12-stage4-diagnostics/TASK-A-SENIOR.md` — so you know
   exactly what Lot A changed.

**Preconditions to verify:** `pnpm -r build` and `pnpm -r test` green on the
current working tree (with Lot A applied); `git status` diff matches Lot A's
declared file list plus the known untracked entries.

**Hard rules:** same as Lot A — no paid API calls, no commits/pushes,
English durable text, no validator weakening, additive-only changes to
public JSON shapes, never touch `.claude/`, `.codegraph/`,
`docs/benchmarks/**`.

## Scope — what you deliver

### B1. Truthful `repair_exhausted` (packages/core/src/batch.ts)

Replace the construction at `batch.ts:626-645` (line numbers pre-Lot A;
locate by the `repair_exhausted` code):

- Build the message from the task's `diagnosticHistory` slice for THIS
  bounded loop: one compact line per attempt in order —
  `attempt <n>: <stopReason ?? "-"> -> <outcome> [<code>, ...]`.
- Report real totals: number of attempts in this loop, and errors summed
  across those attempts (sum of `errors.length + truncatedErrorCount`).
- NEVER present the last attempt's error count as "Total errors recorded".
- Keep the error `code` as `"repair_exhausted"` and keep the retry hint
  behavior (`failedAt` logic) equivalent.

### B2. Expose diagnostics in status (packages/core/src/batch-status.ts + CLI)

- `buildStatusReport` / `batch status --json`: expose per-task diagnostic
  history (or a deterministic per-attempt summary derived from it) as an
  ADDITIVE field on the existing per-task structure. Follow how
  `usageHistory` is already surfaced; mirror its placement. No existing
  field may change name, shape, or meaning.
- Human output (`formatStatusHuman` / `formatResultHuman` in
  `packages/cli/src/commands/batch.ts`): for failed stage-4 tasks, print the
  compact per-attempt sequence. Keep token-first reporting (AGENTS.md):
  tokens lead, USD stays secondary, diagnostics appear with the failure
  details — do not reorder existing sections.

### B3. Regression tests

Extend the closest existing test files (`batch-repair.test.ts`,
`batch.test.ts`, the batch-status tests, CLI tests as appropriate). H# =
handover's required regression tests:

1. **H5:** `repair_exhausted` reports the full attempt sequence and correct
   counts — assert the exact ordered per-attempt lines and the real totals
   for a scripted `stop`+invalid → `stop`+invalid → `abort` run.
2. **H6 backward compatibility:** a checkpoint JSON WITHOUT
   `diagnosticHistory` (fixture copied from the current shape) still loads;
   `batch status --json` reports it exactly as today (additive field absent
   or empty — pick one, assert it deterministically).
3. **H7 accounting:** with the new state machine, `usageHistory` stays
   monotonic (`attempt` 1,2,3,... across resume/--only) and stage/module/run
   token totals reconcile exactly with the sum of usage entries — including
   runs that mix fresh and repair attempts.
4. **H8 key-leak:** extend `packages/core/src/key-leak.test.ts` so the
   scanned surface includes serialized `diagnosticHistory` (checkpoint JSON
   and `batch status --json` output) produced from a run whose stubbed
   provider/config uses a sentinel API key; assert the sentinel never
   appears. Also assert no raw candidate/prompt content leaks (use a
   sentinel string embedded in the stubbed candidate text and assert it only
   ever appears truncated to `DIAGNOSTIC_TEXT_CAP` inside
   `offending`/`message`, never whole).
5. **JSON shape guard:** snapshot-or-explicit-field test that
   `batch status --json` for a pre-diagnostics checkpoint is byte-stable
   except for the new additive field.

### Out of scope for you

The stage-4 state machine, `DiagnosticAttempt` recording, SPEC.md, and
Lot A's tests. If you believe a Lot A behavior is wrong, report it; do not
patch it.

## Definition of done

- `pnpm -r build` green; `pnpm -r test` green;
  `pnpm --filter @livewiki/core test -- src/key-leak.test.ts` green.
- Your changes touch ONLY: `packages/core/src/batch.ts` (the
  `repair_exhausted` block), `packages/core/src/batch-status.ts` (+ its
  tests), `packages/core/src/key-leak.test.ts`,
  `packages/cli/src/commands/batch.ts` (+ CLI tests), and test files listed
  in B3.
- No commit, no push. Write a short summary (what changed, test counts
  before/after, exact JSON field you added and where) and hand back to the
  lead for the combined review and single commit+push.
