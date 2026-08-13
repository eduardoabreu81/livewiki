---
title: Batch state shape and diagnostic bounds
owner: generated
anchors:
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/batch-state.ts#summarizeDiagnosticErrors
---

# Batch state shape and diagnostic bounds

This page documents the canonical shape that `batch_tasks.checkpoint_json` takes in the livewiki batch pipeline, with a focus on the bounded, content-safe summaries that diagnostics produce for persistence.

## When to use this page

- **Inspect** the diagnostic bounds (`DIAGNOSTIC_MAX_ERRORS`, `DIAGNOSTIC_TEXT_CAP`) when you need to know how many error entries and how much text survive into a persisted `DiagnosticAttempt`.
- **Trace** a stage-4 LLM failure through `summarizeDiagnosticErrors` when debugging why a checkpoint shows fewer errors than the underlying validator produced.
- **Extend** the diagnostic or checkpoint schema by following the same `usageHistory` / `diagnosticHistory` additive patterns documented here.

## How it fits

`packages/core/src/batch-state.ts` is the single source of truth for the TypeScript shapes that flow through the batch orchestrator, the LLM adapters, and the persistence layer. The orchestrator reads and writes `batch_tasks.checkpoint_json` (a free-form TEXT column in DB schema v4), and the LLM adapters validate responses against the types declared here at runtime. The file also defines the append-only `DiagnosticAttempt` history that stage-4 emits per LLM attempt, and the bounded helpers that keep that history safe to persist.

Within the repo, this module sits in `packages/core/src/` alongside the LLM type definitions (`./llm/types.js`), the prompt-level artifact validator (`./prompts.js`), the mechanical artifact repair post-processor (`./artifact-repair.js`), and the topic/community planners (`./topics.js`, `./community.js`). The constants and the summarizer below are the only symbols with explicit runtime behavior in this excerpt; the surrounding interfaces describe the contract that other modules honor when reading or writing a checkpoint.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-batch-state.mmd
```

## Diagnostic caps

<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS -->

Two numeric constants set the upper bounds for what a `DiagnosticAttempt` is allowed to retain. They exist so the append-only diagnostic history does not bloat checkpoints or leak unbounded text into a free-form DB column.

```ts
export const DIAGNOSTIC_TEXT_CAP = 200;
export const DIAGNOSTIC_MAX_ERRORS = 50;
```

`DIAGNOSTIC_TEXT_CAP` caps, at 200 characters, the length of each error's `offending` excerpt and `message` string that survives into a `DiagnosticErrorSummary`. `DIAGNOSTIC_MAX_ERRORS` caps, at 50 entries, the total number of structured error summaries a single `DiagnosticAttempt.errors` array may carry. Any entries beyond that cap are not dropped silently — they are counted into `truncatedErrorCount`, so a reader can tell that the cap fired.

The comments on `DiagnosticErrorSummary` and `DiagnosticAttempt` in the source explicitly state that the offending-text and message fields are truncated to `DIAGNOSTIC_TEXT_CAP` chars and that the errors array is capped at `DIAGNOSTIC_MAX_ERRORS` entries. These caps are the only enforcement visible in the excerpt; nothing in this file clamps the candidate text length or the mechanical-repair list — those concerns live elsewhere.

## Summarizing validation errors

<!-- lw:anchors packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

`summarizeDiagnosticErrors` is the bridge between the validator's `ArtifactValidationError[]` and the persistence-safe `DiagnosticErrorSummary[]`. It exists so that the orchestrator can build a `DiagnosticAttempt` without mutating the caller's errors and without retaining unbounded text.

```ts
export function summarizeDiagnosticErrors(
  input: ReadonlyArray<ArtifactValidationError>,
): { errors: DiagnosticErrorSummary[]; truncatedErrorCount: number }
```

In words: `summarizeDiagnosticErrors` takes the read-only list of validation errors produced by the artifact validator and returns an object whose `errors` field is a list of bounded summaries safe to persist in a `DiagnosticAttempt`, and whose `truncatedErrorCount` field reports how many input errors did not fit.

The function works in three steps. First, it slices the input down to the first `DIAGNOSTIC_MAX_ERRORS` entries — this is the only place where the count cap is enforced, and it caps only the upper side (no minimum or floor is applied). Second, it maps each retained error into a `DiagnosticErrorSummary`, copying `code` and `location` verbatim and conditionally copying `sectionSlug` and `offending` only when those fields are present on the source error, so absent fields stay absent rather than becoming `undefined` keys. The `message` field is always copied; both `offending` and `message` are sliced to `DIAGNOSTIC_TEXT_CAP` characters. Third, it computes `truncatedErrorCount` as `Math.max(0, input.length - errors.length)`, so the count is never negative even when the input is shorter than the cap, and the resulting object is returned.

The visible behavior is bounded and deterministic: a caller that passes a longer list gets exactly `DIAGNOSTIC_MAX_ERRORS` summaries plus an honest overflow count, and a caller that passes a shorter list gets one summary per input error with `truncatedErrorCount` of `0`. The function does not throw on empty input, does not mutate `input`, and does not invent `offending` or `sectionSlug` fields when the source error omitted them — that omission is the only conditional copy visible in the source.