# Lot D — adversarial regression + evidence replay (MID-LEVEL)

**Starts ONLY after Lot C is delivered and green in the working tree.**
You build on Lot C's uncommitted changes — do not revert or rework them; if
something in Lot C looks wrong, stop and report to the lead instead of
patching it.

**Read first, fully and in this order:**
1. `AGENTS.md`
2. `docs/tasks/2026-07-13-repair-recovery/CONTRACT.md` — frozen contract.
3. `docs/tasks/2026-07-13-repair-recovery/TASK-C-SENIOR.md` — what Lot C
   changed.
4. `docs/tasks/2026-07-12-stage4-diagnostics/CONTRACT.md` — previous
   contract (DiagnosticAttempt shape, invariants I1-I5).

**Preconditions:** `pnpm -r build` and `pnpm -r test` green on the current
working tree (with Lot C applied); diff matches Lot C's declared file list.

**Hard rules:** same as Lot C — no paid API, no commits/pushes, English
durable text, validators untouched, never touch `docs/benchmarks/**`,
`.claude/`, `.codegraph/`. Out of scope: Lot C's implementation and SPEC.md
(report concerns; do not patch).

## Deliverables — tests only (no production code changes)

### D1. Adversarial injection suite (`packages/core/src/prompts.test.ts`)

Attack-shaped cases against the selective function and the full repair
prompt, each asserting byte-exact survival/neutralization:

1. Candidate mixing, adjacent on consecutive lines: one valid marker, one
   fake marker with an invented key, one `lw:manual` block, one closing
   `<!-- /lw:anchors -->` form — only the valid marker survives.
2. A marker whose keys are all valid EXCEPT one that differs only by case,
   or by a trailing character — fully neutralized (exact match only).
3. A valid-shaped marker inside a fenced code block in the candidate —
   whatever the implementation does must equal what it does OUTSIDE a
   fence (the neutralizer is fence-agnostic today; pin the actual
   behavior so a future "smart" change is a conscious decision).
4. Marker split across the 200-char boundary of an error `offending`
   excerpt — diagnostics never contain a complete fake marker (ties into
   the previous contract's I4).
5. Source block with a FULLY VALID closed-list marker — still neutralized
   (selective preservation is candidate-only).

### D2. v11 end-to-end replay (`packages/core/src/batch-repair.test.ts`)

Scripted-stub reproductions of the three v11 task shapes, asserting the
NEW outcomes:

1. **core-src-02 shape:** attempt 1 = 19k-char candidate, valid section
   markers, 2 frontmatter-side errors → repair prompt embeds the FULL
   candidate with markers intact; stub attempt 2 returns the corrected
   page → task `done`, diagnostics `[artifact_validation_failed, success]`.
2. **core-src-04 shape:** attempt 1 = >16k candidate, one
   `todo_marker_present` → same recovery in one repair.
3. **core-src-03 shape:** attempt 1 invalid, attempt 2 provider `abort`
   (incomplete) → attempt 3 fresh initial (previous contract's rule still
   holds after Lot C's changes).
4. **Oversized path:** candidate exceeding `contextCharBudget` → next
   attempt fresh; diagnostic history shows the sequence and (if Lot C
   adopted `promptKindReason`) the reason field; checkpoint round-trips
   through JSON parse (I5).

### D3. Guard-rails

1. Key-leak (`packages/core/src/key-leak.test.ts`): extend the existing H8
   surface so a candidate containing BOTH a valid marker and a
   sentinel-bearing fake marker never leaks the sentinel whole through
   checkpoint or status JSON.
2. Confirm diagnostics invariants I1 (1:1 join) and I2 (seeding) still
   pass under the new gate — add one assertion to an existing seeding test
   if not already covered by Lot C.

## Definition of done

- `pnpm -r build`, `pnpm -r test`, key-leak — all green.
- Your changes touch ONLY test files: `prompts.test.ts`,
  `batch-repair.test.ts`, `key-leak.test.ts` (and shared stub helpers if
  strictly needed).
- No commit, no push. Summary: tests added per file, test counts
  before/after, and any Lot C behavior you believe is wrong (reported, not
  patched).
