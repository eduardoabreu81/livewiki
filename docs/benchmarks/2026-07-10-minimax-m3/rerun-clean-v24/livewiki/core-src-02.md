---
title: core batch pipeline state, status and test fixtures
owner: generated
anchors:
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate
  - packages/core/src/batch-repair.test.ts#expectJoinedAttempts
  - packages/core/src/batch-repair.test.ts#makeInvalidPage
  - packages/core/src/batch-repair.test.ts#makeValidPage
  - packages/core/src/batch-repair.test.ts#readStage4Checkpoint
  - packages/core/src/batch-review.test.ts#MockLlm
  - packages/core/src/batch-review.test.ts#MockLlm.generate
  - packages/core/src/batch-review.test.ts#executablePlanPaths
  - packages/core/src/batch-review.test.ts#makeCompactAuxiliaryPage
  - packages/core/src/batch-review.test.ts#seedFiveFileRepo
  - packages/core/src/batch-review.test.ts#stage2ErrorCode
  - packages/core/src/batch-stage5.test.ts#Stage5MockLlm
  - packages/core/src/batch-stage5.test.ts#Stage5MockLlm.generate
  - packages/core/src/batch-stage5.test.ts#countStage5Tasks
  - packages/core/src/batch-stage5.test.ts#fileExists
  - packages/core/src/batch-stage5.test.ts#makeCompactAuxiliaryPage
  - packages/core/src/batch-stage5.test.ts#makeFlowPage
  - packages/core/src/batch-stage5.test.ts#makeFlowPageWithSections
  - packages/core/src/batch-stage5.test.ts#makeValidPage
  - packages/core/src/batch-stage5.test.ts#parseClosedKeys
  - packages/core/src/batch-stage5.test.ts#parseFlowPrompt
  - packages/core/src/batch-stage5.test.ts#readTaskCheckpoint
  - packages/core/src/batch-stage5.test.ts#writeFlowRepo
  - packages/core/src/batch-stage5.test.ts#writeGroupFlowRepo
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/batch-state.ts#summarizeDiagnosticErrors
  - packages/core/src/batch-status.test.ts#OneModuleMockLlm
  - packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate
  - packages/core/src/batch-status.test.ts#OneShotMockLlm
  - packages/core/src/batch-status.test.ts#OneShotMockLlm.generate
  - packages/core/src/batch-status.test.ts#ValidMockLlm
  - packages/core/src/batch-status.test.ts#ValidMockLlm.generate
  - packages/core/src/batch-status.test.ts#seedLegacyCheckpoint
  - packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint
  - packages/core/src/batch-status.ts#buildStatusReport
  - packages/core/src/batch-status.ts#emptyStageUsage
  - packages/core/src/batch-status.ts#listRuns
  - packages/core/src/batch-status.ts#mergeStageUsage
  - packages/core/src/batch-status.ts#parseRunSummary
  - packages/core/src/batch-status.ts#safeJsonParse
  - packages/core/src/batch.test.ts#MockLlm
  - packages/core/src/batch.test.ts#MockLlm.generate
---

# core batch pipeline state, status and test fixtures

This module bundles the persisted checkpoint types for the livewiki batch run, the report builder that turns those rows into a status report, and the vitest fixtures/mocks that drive the batch pipeline tests end-to-end.

## When to use this page

- **Inspect** `packages/core/src/batch-state.ts` when you need the shape of `TaskCheckpoint`, `UsageAttempt`, `DiagnosticAttempt` or the diagnostic caps `DIAGNOSTIC_TEXT_CAP` / `DIAGNOSTIC_MAX_ERRORS`.
- **Consult** `packages/core/src/batch-status.ts` when wiring a CLI status command or extending the `BatchStatusReport` aggregation (totals, by stage, by module, per-task failures).
- **Run or extend** the batch tests under `packages/core/src/{batch,batch-repair,batch-review,batch-stage5,batch-status}.test.ts` and re-use their programmable LLM mocks when authoring new orchestrator regressions.

## How it fits

The page covers three closely-related concerns inside `packages/core/src`. `batch-state.ts` defines the canonical checkpoint shape that every stage-1..5 task persists into `batch_tasks.checkpoint_json`; `summarizeDiagnosticErrors` is the persistence-side sanitizer that converts raw `ArtifactValidationError` entries into bounded `DiagnosticErrorSummary` records before they are stored. `batch-status.ts` is the read-side counterpart: `buildStatusReport` opens the SQLite index, joins `batch_runs` and `batch_tasks`, and rolls each task's `usageHistory` into totals, per-stage, and per-module aggregates; `listRuns` provides the run-id listing CLI callers need to pick a run; `safeJsonParse`, `emptyStageUsage`, `aggregateUsageFromCheckpoint`, `mergeStageUsage` and `parseRunSummary` are the small helpers that make those aggregations tolerant of missing, malformed, or legacy checkpoints. The remaining five files are the vitest suites that pin those behaviors — `batch.test.ts` for the happy path of `runBatch` / `runOnly`, `batch-repair.test.ts` for the bounded-repair criteria (criteria 6–10), `batch-review.test.ts` for the 11 reviewer findings and the owner: human / mixed protections, `batch-stage5.test.ts` for the stage-5 flow page pipeline, and `batch-status.test.ts` for the H6 backward-compatibility contract on the additive `diagnosticHistory` field.

## Diagnostic caps and the persistence sanitizer

<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

The persisted diagnostic history is bounded so a single failing task cannot blow up `checkpoint_json` or leak unbounded user content into the status report.

```ts
export const DIAGNOSTIC_TEXT_CAP = 200;
export const DIAGNOSTIC_MAX_ERRORS = 50;
```

`DIAGNOSTIC_TEXT_CAP` is the per-field character ceiling that `summarizeDiagnosticErrors` applies to both `offending` and `message` on every `DiagnosticErrorSummary`. `DIAGNOSTIC_MAX_ERRORS` is the per-attempt ceiling on how many structured errors survive a single `DiagnosticAttempt.errors` array. `summarizeDiagnosticErrors` does not mutate its caller; it slices the input to the cap and reports the dropped count via `truncatedErrorCount`, which the orchestrator stores alongside the surviving entries.

## Status report assembly

<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#parseRunSummary packages/core/src/batch-status.ts#safeJsonParse -->

`buildStatusReport` is the top-level entry: given a repo root and an optional `runId`, it opens `.livewiki/index.db`, picks the run (the most recent one when `runId` is `null`), loads every task row, and folds each task's `usageHistory` into totals, a per-stage `Record<string, StageUsage>`, and a per-module `StageUsage` map (the per-module breakdown is stage-4 only; aggregate task counts come from `summary.tasksDone` / `tasksFailed`, not from `byModule`). The per-task `diagnosticHistory` is surfaced additively only when the checkpoint actually has it — older checkpoints that pre-date the field load unchanged. `listRuns` returns the lightweight summary list (`id`, `startedAt`, `finishedAt`, `status`, `startedBy`) needed for selecting a run before calling `buildStatusReport`.

```ts
export async function buildStatusReport(
  repoRoot: string,
  runId: number | null = null,
): Promise<BatchStatusReport>
```

```ts
export async function listRuns(repoRoot: string): Promise<Array<{
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  startedBy: string;
}>>
```

`emptyStageUsage` returns a fresh zero `StageUsage` (`inputTokens: 0`, `outputTokens: 0`, `costUsd: null`, `models: []`, `usageIncomplete: false`); every accumulator in the report starts from one. `mergeStageUsage` combines two `StageUsage` values by summing tokens, coalescing `costUsd` (any null side forces the result to null), unioning the `models` arrays, and OR-ing the `usageIncomplete` flag. `aggregateUsageFromCheckpoint` walks one task's `usageHistory` and returns the rolled-up `StageUsage` — it treats `usageKnown === false` (e.g. an `LlmTimeoutError` attempt) as unknown, sets `usageIncomplete` instead of inventing 0/0 tokens, and keeps the task's `costUsd` at `null` when no attempt had a price, so the report never publishes a synthetic zero. `safeJsonParse` is a thin wrapper around `JSON.parse` that returns `null` instead of throwing, used wherever a row's `checkpoint_json` or `summary_json` could be malformed; `parseRunSummary` rides on top of it to convert the stored `summary_json` into a `BatchRunSummary`, tolerating `null` and parse failures without breaking the report. The excerpt is truncated, so the full body of `aggregateUsageFromCheckpoint` (for example the exact handling of the "first priced attempt wins" branch) is not established here — treat the visible behavior as "aggregates known tokens, propagates `usageIncomplete`, and never invents a cost when none was priced".

## Happy-path batch pipeline fixture

<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

`packages/core/src/batch.test.ts` pins the orchestrator end-to-end with a minimal mock that always returns a valid frontmatter page anchored on the first closed key parsed from the prompt.

```ts
class MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public callLog: Array<{ system: string; user: string }> = [];

  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {
    this.callCount++;
    this.callLog.push({ system: req.system, user: req.user });
    // ...
    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
    };
  }
}
```

The fixture supports both `runBatch` (with `noRefine` / `skipManifestWrite` toggles) and `runOnly` (re-runs a single module and asserts the checkpoint `attempt` increments and `usageHistory` gains one entry). With `noRefine: true` and a single module, the mock is hit exactly once (stage 4); with `noRefine: false` the stage-2 refine adds a second call.

## Repair-pipeline fixtures (criterion 6–10)

<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#makeValidPage packages/core/src/batch-repair.test.ts#makeInvalidPage packages/core/src/batch-repair.test.ts#readStage4Checkpoint packages/core/src/batch-repair.test.ts#expectJoinedAttempts -->

`ProgrammableMockLlm` is the more capable LLM stub used by the bounded-repair tests. It queues responses by call index, supports per-call error injection via `throwOn`, captures every `system` / `user` prompt it receives in `callLog`, and can auto-generate a valid page from the closed key list embedded in the prompt when `autoPageFromPrompt` is set.

```ts
class ProgrammableMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public responses: string[] = [];
  public stopReasons: Array<StopReason | undefined> = [];
  public rawStopReasons: Array<string | undefined> = [];
  public throwOn: Set<number> = new Set();
  public callCount = 0;
  public callLog: Array<{ system: string; user: string }> = [];
  public autoPageFromPrompt = false;

  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {
    // ...
    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      ...(this.stopReasons[idx] !== undefined ? { stopReason: this.stopReasons[idx] } : {}),
      ...(this.rawStopReasons[idx] !== undefined
        ? { rawStopReason: this.rawStopReasons[idx] }
        : {}),
    };
  }
}
```

`makeValidPage` builds a syntactically valid module page whose `anchors` list exactly matches the supplied closed-key list, suitable for the success slots in the repair tests. `makeInvalidPage` returns a deliberately broken `# invalid` page containing a unique marker so tests can verify that the orchestrator restored / deleted the rejected page rather than letting it land on disk. `readStage4Checkpoint` opens `better-sqlite3` against `.livewiki/index.db` in readonly mode, fetches the `checkpoint_json` column for `stage = 4` and the supplied `target` (defaulting to `"auth"`), and returns it parsed as `TaskCheckpoint`. `expectJoinedAttempts` enforces the invariant that `diagnosticHistory` and `usageHistory` are 1:1 by `attempt`: both arrays must have the same length, and `diagnosticHistory.map(entry => entry.attempt)` must equal `usageHistory.map(entry => entry.attempt)`. The visible source is truncated before the rest of the `describe` blocks (criteria 7–10) and the `expectJoinedAttempts` body finishes, so the exhaustive behavior of every repair test is not established here.

## Reviewer-finding regressions

<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode packages/core/src/batch-review.test.ts#executablePlanPaths -->

`MockLlm` here is a simpler variant: it inspects the `system` / `user` prompt, decides between the "compact auxiliary" contract and the full module page based on a regex match, and falls back to a stub `t` page when the prompt has no closed keys.

```ts
class MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public responses: string[] = [];
  public costInputs: Array<{ inputTokens: number; outputTokens: number; model: string }> = [];

  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {
    // ...
    this.costInputs.push(result.usage);
    return result;
  }
}
```

`makeCompactAuxiliaryPage` emits the compact auxiliary contract: frontmatter listing the closed keys, a `## Reference` section that gives each key its own H3, and explicit prose stating that the code "supports development and is not a product runtime path". `seedFiveFileRepo`, `stage2ErrorCode`, and `executablePlanPaths` are helper fixtures used by the reviewer-finding tests (the supplied excerpt only establishes their existence and async signatures; their full bodies are not in the visible source).

## Stage-5 flow-page fixtures

<!-- lw:anchors packages/core/src/batch-stage5.test.ts#Stage5MockLlm packages/core/src/batch-stage5.test.ts#Stage5MockLlm.generate packages/core/src/batch-stage5.test.ts#makeValidPage packages/core/src/batch-stage5.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-stage5.test.ts#makeFlowPage packages/core/src/batch-stage5.test.ts#makeFlowPageWithSections packages/core/src/batch-stage5.test.ts#parseClosedKeys packages/core/src/batch-stage5.test.ts#parseFlowPrompt packages/core/src/batch-stage5.test.ts#writeFlowRepo packages/core/src/batch-stage5.test.ts#writeGroupFlowRepo packages/core/src/batch-stage5.test.ts#countStage5Tasks packages/core/src/batch-stage5.test.ts#fileExists packages/core/src/batch-stage5.test.ts#readTaskCheckpoint -->

`Stage5MockLlm` routes each `generate` call by inspecting the user prompt: when the prompt starts with `# Flow: <slug>` it counts as a stage-5 flow call (and can throw via `throwOnFlowCall`, run a side effect via `onBeforeFlowResponse`, or override the response via `flowResponder`), otherwise it falls back to either the compact auxiliary page or the standard module page. This lets one mock cover both stage-4 and stage-5 in the same suite.

```ts
class Stage5MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public flowCallCount = 0;
  public callLog: Array<{ system: string; user: string }> = [];
  public flowResponder: ((ctx: FlowPromptCtx, flowCallIndex: number) => string) | null = null;
  public throwOnFlowCall: { index: number; error: Error } | null = null;
  public onBeforeFlowResponse: ((flowCallIndex: number) => Promise<void> | void) | null = null;

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    // ...
    if (/^# Flow: \S+$/m.test(req.user)) {
      const flowIdx = this.flowCallCount++;
      // ...
    }
    // ...
  }
}
```

`parseClosedKeys` extracts the `- <key>` lines from any stage-4 / stage-5 prompt; `parseFlowPrompt` extends that with the `# Flow: <slug>` header and the `# Participating modules …:` line into a `FlowPromptCtx` (`{ slug, moduleIds, closedKeys, user }`). `makeValidPage` and `makeCompactAuxiliaryPage` are the stage-5 module-page / auxiliary-page builders (same contract as the corresponding helpers in the other suites). `makeFlowPage` returns the model-emitted form of a stage-5 flow page: frontmatter listing both the closed keys and the participating modules, an inline `## Diagram` block holding the Mermaid source, a `Purpose` / `Ordered flow` / `Failure and recovery` section each carrying at least one marker (so dual completeness — every cited key once in frontmatter AND once across section markers — holds), and a `Related pages` list that links each participating module. `makeFlowPageWithSections` is a section-aware variant used by section-completeness tests. `writeFlowRepo` and `writeGroupFlowRepo` materialize the on-disk flow repos the tests need; `fileExists` and `countStage5Tasks` are filesystem / DB inspection helpers; `readTaskCheckpoint` opens the SQLite index and reads the checkpoint for a given stage / target. The visible source is truncated, so the full bodies of `makeFlowPageWithSections`, `writeFlowRepo`, `writeGroupFlowRepo`, `countStage5Tasks`, `fileExists` and `readTaskCheckpoint` are not established here.

## Backward-compatibility fixtures for `diagnosticHistory`

<!-- lw:anchors packages/core/src/batch-status.test.ts#OneShotMockLlm packages/core/src/batch-status.test.ts#OneShotMockLlm.generate packages/core/src/batch-status.test.ts#OneModuleMockLlm packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate packages/core/src/batch-status.test.ts#ValidMockLlm packages/core/src/batch-status.test.ts#ValidMockLlm.generate packages/core/src/batch-status.test.ts#seedLegacyCheckpoint -->

These three mocks are the H6 / Lot-B fixtures that pin the additive `diagnosticHistory` contract. `OneShotMockLlm` is never expected to be called: its `generate` method throws when invoked, so the legacy-checkpoint test can prove the seed path works without any LLM traffic. `ValidMockLlm` returns a syntactically valid generated page with both closed keys (`src/auth/login.ts#login`, `src/auth/login.ts#logout`) so the post-Lot-A test can prove that a fresh checkpoint surfaces `diagnosticHistory` on the status report. `OneModuleMockLlm` is the smaller-module counterpart.

```ts
class OneShotMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";

  async generate(): Promise<GenerateResult> {
    throw new Error("OneShotMockLlm.generate was called — should not happen");
  }
}
```

```ts
class ValidMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";

  async generate(): Promise<GenerateResult> {
    return {
      content: [/* ... full module page with both anchors ... */].join("\n"),
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      stopReason: "complete",
    };
  }
}
```

`seedLegacyCheckpoint` inserts a `batch_runs` row plus a single `batch_tasks` row whose `checkpoint_json` is the pre-Lot-A shape (it has `usageHistory` but no `diagnosticHistory`), and returns the resulting `runId`. The first H6 test then calls `buildStatusReport` and asserts that `"diagnosticHistory" in task` is `false` (the field is absent from the output, not synthesized to `[]` or `null`), that the pre-existing fields (`error.code`, `attempts`, `inputTokens`, `outputTokens`) match the seeded values, and that the JSON shape is byte-stable. The second H6 test uses `ValidMockLlm` and `runBatch` to produce a post-Lot-A checkpoint and asserts the per-task `diagnosticHistory` is present and contains one entry with `outcome: "success"`. The third H6 test (the `legacySummary` / `modulesRefined` case) is partially visible — its seeding and assertion shape are not fully shown in the excerpt.