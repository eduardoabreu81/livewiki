# Frozen contract — stage-4 per-attempt diagnostics

**Date:** 2026-07-12
**Owner:** technical lead (this document is the single source of truth for
both execution lots; do not deviate without lead approval)
**Base commit:** `74dba09` (HEAD = origin/main)
**Context:** `docs/benchmarks/2026-07-10-minimax-m3/HANDOVER-2026-07-12.md`
and `AGENTS.md` — read both fully before writing code.

## Non-negotiable rules (inherited from the handover)

- No paid API calls. All work is local with stub LLM clients.
- New durable repository text is English.
- Do not weaken any validator (stage-4 normalization, artifact validation,
  verify). These changes make failures observable; they do not relax gates.
- No provider-, module-, or page-specific branches. Branch only on
  normalized semantics (`StopReason`), never on raw strings like `"abort"`.
- No arbitrary output/context caps as a workaround. (The text/entry caps in
  this contract bound *diagnostic persistence size*, not LLM behavior.)
- Do not stage, modify, or delete: `.claude/`, `.codegraph/`,
  `docs/benchmarks/**` (including the untracked rerun directories), or this
  handover. Never run `git clean -fdx`.
- Executors do NOT commit or push. Leave changes in the working tree; the
  lead reviews the diff and performs a single combined commit+push.

## New types (in `packages/core/src/batch-state.ts`)

```ts
/** Outcome category of one stage-4 attempt. Exactly one per attempt. */
export type DiagnosticOutcome =
  | "llm_error"                 // generate() threw (timeout, network, 5xx)
  | "incomplete_generation"     // normalized stopReason === "incomplete"
  | "truncated_by_token_limit"  // normalized stopReason === "length"
  | "normalization_failed"
  | "artifact_validation_failed"
  | "verify_failed"
  | "success";

/** Bounded, content-safe summary of one structured error. */
export interface DiagnosticErrorSummary {
  /** ArtifactValidationCode, verify issue code, or llm error code. */
  code: string;
  location: "frontmatter" | "section" | "body" | "global";
  sectionSlug?: string;
  /** Truncated to DIAGNOSTIC_TEXT_CAP chars. */
  offending?: string;
  /** Truncated to DIAGNOSTIC_TEXT_CAP chars. */
  message: string;
}

/** One append-only diagnostic record per stage-4 LLM attempt. */
export interface DiagnosticAttempt {
  /**
   * GLOBAL attempt number — same counter as UsageAttempt.attempt.
   * Join key for the 1:1 invariant (see I1).
   */
  attempt: number;
  /** Normalized stop reason, when a provider response arrived. */
  stopReason?: import("./llm/types.js").StopReason;
  /** Raw provider value, when known. */
  rawStopReason?: string;
  outcome: DiagnosticOutcome;
  /** Prompt kind actually used on THIS attempt. */
  promptKind: "initial" | "repair";
  /** Structured errors, capped at DIAGNOSTIC_MAX_ERRORS entries. Empty on success. */
  errors: DiagnosticErrorSummary[];
  /** Number of error entries dropped by the cap. 0 when none. */
  truncatedErrorCount: number;
  /** Char count of the candidate text. Absent when no candidate exists (llm_error). */
  candidateChars?: number;
  /** SHA-256 (hex) of the candidate text. Absent when no candidate exists. */
  candidateSha256?: string;
  finishedAt: number;
}
```

Constants (export from `batch-state.ts`):

```ts
export const DIAGNOSTIC_TEXT_CAP = 200;   // chars, per offending/message field
export const DIAGNOSTIC_MAX_ERRORS = 50;  // entries per attempt
```

`TaskCheckpoint` gains one OPTIONAL field:

```ts
diagnosticHistory?: DiagnosticAttempt[];
```

## Invariants (all must be tested)

- **I1 — 1:1 join.** Every stage-4 LLM attempt appends exactly one entry to
  `usageHistory` AND exactly one entry to `diagnosticHistory`, sharing the
  same global `attempt` number. This includes `llm_timeout` (usage entry has
  `usage: null`; diagnostic entry has `outcome: "llm_error"`).
- **I2 — append-only + seeding.** On `resume`/`--only`, `diagnosticHistory`
  is seeded from the previous checkpoint and appended to — exactly the
  existing `usageHistory` semantics (`batch.ts:476-479`). Never reset.
- **I3 — candidate hash semantics.** `candidateSha256` hashes the LLM
  candidate at the point of that attempt's outcome (the normalized artifact
  when normalization succeeded, otherwise the raw response text). It is NOT
  required to equal `TaskArtifacts.pageHash` on success — the final page may
  differ (manual-block preservation). Do not assert equality anywhere.
- **I4 — content safety.** `diagnosticHistory` never contains raw prompts,
  raw source, raw candidates, or API keys. Only codes, locations, slugs,
  capped `offending`/`message` excerpts, counts, hashes, timestamps.
- **I5 — backward compatibility.** Checkpoints without `diagnosticHistory`
  parse and report exactly as before. The field is additive everywhere
  (checkpoint JSON, `batch status --json`).

## Attempt state machine (fresh vs repair)

The prompt kind of the NEXT attempt depends ONLY on the outcome of the
IMMEDIATELY PREVIOUS attempt. Never resurrect candidates from older attempts.

| Previous outcome | Next promptKind | priorCandidate / priorErrors |
|---|---|---|
| (none — first attempt) | `initial` | empty |
| `llm_error` (non-timeout) | `initial` | cleared |
| `incomplete_generation` | `initial` | cleared |
| `truncated_by_token_limit` | `initial` | cleared |
| `normalization_failed` | `repair` | that attempt's candidate + errors |
| `artifact_validation_failed` | `repair` | that attempt's candidate + errors |
| `verify_failed` | `repair` | that attempt's candidate + errors |
| `llm_timeout` | — terminal for the task (unchanged behavior) | — |

Implementation note: today the prompt kind is positional
(`isRepair: i > 0`, `batch.ts:534`). Replace with explicit
`nextPromptKind: "initial" | "repair"` state carried across loop iterations.
Note this also fixes a latent defect: today an `llm_error` on attempt 1
makes attempt 2 a degenerate repair prompt with an empty candidate.

`stopReason === "unknown"` continues to flow into normalization/validation
as a completed candidate (validators are the gate). Do not change this;
document it in SPEC.md.

Bounded loop size, circuit breaker, rollback handling, timeout terminality,
and usage accounting are all UNCHANGED.

## Truthful reporting

- `repair_exhausted` message must be built from `diagnosticHistory`: one
  compact line per attempt (`attempt N: <stopReason ?? "-"> -> <outcome>
  [codes...]`), plus real totals (attempts, errors summed across attempts).
  NEVER present the last attempt's error count as a total.
- `batch status --json` exposes the per-task diagnostic history (or a
  deterministic per-attempt summary) as an ADDITIVE field. No existing field
  changes shape or meaning. Human output stays token-first (AGENTS.md).

## Validation gates (both lots)

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```

All green, plus lead diff review, before anything is committed.
