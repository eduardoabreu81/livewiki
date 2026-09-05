---
title: Batch Pipeline Orchestrator
owner: generated
anchors:
  - packages/core/src/batch.ts#EmptyPipelineError
  - packages/core/src/batch.ts#EmptyPipelineError.constructor
  - packages/core/src/batch.ts#TaskError
  - packages/core/src/batch.ts#TaskError.constructor
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#attemptFolderGeneration
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch.ts#attemptStage5Generation
  - packages/core/src/batch.ts#attemptTopicGeneration
  - packages/core/src/batch.ts#attemptUnderstandingGeneration
  - packages/core/src/batch.ts#buildFairTruncatedSource
  - packages/core/src/batch.ts#buildFlowDocContext
  - packages/core/src/batch.ts#buildModuleDocContext
  - packages/core/src/batch.ts#buildResult
  - packages/core/src/batch.ts#buildSurgicalEvidenceSlice
  - packages/core/src/batch.ts#buildTopicDocContext
  - packages/core/src/batch.ts#computeCostFromUsage
  - packages/core/src/batch.ts#createOrGetTask
  - packages/core/src/batch.ts#diagnosticAttempt
  - packages/core/src/batch.ts#drainPendingMetrics
  - packages/core/src/batch.ts#emptyUsage
  - packages/core/src/batch.ts#extractManualBlocksBySection
  - packages/core/src/batch.ts#finalizeRun
  - packages/core/src/batch.ts#forceOwnerInFrontmatter
  - packages/core/src/batch.ts#generateOversizedFilePage
  - packages/core/src/batch.ts#getFileIdsForModule
  - packages/core/src/batch.ts#getModuleSymbolRows
  - packages/core/src/batch.ts#getOrCreateTask
  - packages/core/src/batch.ts#getRationaleEvidenceForPaths
  - packages/core/src/batch.ts#injectManualBlocksBySection
  - packages/core/src/batch.ts#isArtifactVerifyCode
  - packages/core/src/batch.ts#isDeferredBaselineIssue
  - packages/core/src/batch.ts#isRelaxedEligible
  - packages/core/src/batch.ts#orchestrate
  - packages/core/src/batch.ts#prepareSurgicalRepair
  - packages/core/src/batch.ts#readOwnerFromFrontmatter
  - packages/core/src/batch.ts#recoverStage4TaskArtifacts
  - packages/core/src/batch.ts#resetTaskToPending
  - packages/core/src/batch.ts#resolveOutputTokenBudget
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/batch.ts#rollbackWrittenArtifacts
  - packages/core/src/batch.ts#runBatch
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/batch.ts#runSemanticTopicStage
  - packages/core/src/batch.ts#runUnderstandingStage
  - packages/core/src/batch.ts#safeJsonParse
  - packages/core/src/batch.ts#sectionRangeOf
  - packages/core/src/batch.ts#slugifyHeadingText
  - packages/core/src/batch.ts#statusToExitCode
  - packages/core/src/batch.ts#summarizeLlmDiagnosticError
  - packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors
  - packages/core/src/batch.ts#topicAttemptDiagnostic
  - packages/core/src/batch.ts#topicPlanDiagnostic
  - packages/core/src/batch.ts#tryWriteAndVerify
  - packages/core/src/batch.ts#tryWriteFlowAndVerify
  - packages/core/src/batch.ts#tryWriteModuleDiagramAndVerify
  - packages/core/src/batch.ts#understandingAttemptDiagnostic
  - packages/core/src/batch.ts#verifyIssuesToValidationErrors
  - packages/core/src/batch.ts#writeArtifactAtomic
---

# Batch Pipeline Orchestrator

This file orchestrates the entire livewiki batch documentation pipeline—running the four-stage coordinated documentation process that scans a repository, identifies modules, prioritizes them, and generates model-written wiki pages with transactional write-and-verify semantics.

## When to use this page

- **Trace how a full batch run flows end-to-end**: follow `runBatch` through scanning, page-unit planning, prioritization, and the stage-4/5 generation loops.
- **Understand resumability and failure handling**: see how `resumeBatch` continues interrupted runs and how the circuit breaker, rollback, and repair-slot mechanics protect against cascading failures.
- **Learn the `--only` single-task re-run path**: examine `runOnly` and how it preserves human-owned content while retrying a specific module, flow, topic, or understanding task.
- **Inspect the write-and-verify contract**: understand atomic artifact writes, verification gating, and how staged rollback protects repository consistency.

## How it fits

`batch.ts` is the central nervous system of the livewiki batch documentation pipeline (the "Phase 3, stage 4" of the multi-phase architecture). It coordinates many lower-level subsystems: the indexer (stage 1), the page-units planner which determines real file/folder page units (stage 2), module prioritization (stage 3), and then hands off to model-driven generation stages plus the flow and topic semantic layers of stage 5.

The file consumes artifacts from modules like `page-units.js` (the planner), `modules.js` (IDs and edges), and `prompts.js` (prompt builders), and it writes wiki pages transactionally via the `tryWriteAndVerify` machinery. It maintains run state in the SQLite checkpoint database (`batch_runs`, `batch_tasks`) so runs can be resumed or selectively re-run with `--only`, and it tracks token usage and cost through `batch-state.ts` types propagated to the final `BatchRunResult` surface consumed by CLI commands in `packages/cli`.

## Part 1 (symbols 1–15)
<!-- lw:anchors packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#attemptFolderGeneration packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#attemptStage5Generation packages/core/src/batch.ts#attemptTopicGeneration packages/core/src/batch.ts#attemptUnderstandingGeneration packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#buildFlowDocContext packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildResult -->

This section of `packages/core/src/batch.ts` covers the error-handling infrastructure and the core attempt-generation machinery that powers the batch documentation pipeline. These symbols form the foundation of how the batch system sends generation requests to the LLM, handles failures, validates outputs, and tracks usage and costs across multiple attempts.

The file begins by defining two custom error classes that distinguish error types within the batch pipeline. `EmptyPipelineError` extends `Error` with the signature:

```typescript
export class EmptyPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyPipelineError";
  }
}
```

This class takes a message string and creates an error whose `name` property identifies it as an empty-pipeline failure. The batch system throws this when it discovers there is no work to process — for example, when no modules or pages qualify for documentation — allowing callers to distinguish a legitimate "nothing to do" condition from other failures.

Similarly, `TaskError` provides a structured error type:

```typescript
class TaskError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "TaskError";
  }
}
```

This class takes a machine-readable `code` and a human-readable `message`, storing the code as a public readonly property. The batch system uses `TaskError` to report operation-level failures with a stable identifier that callers can branch on programmatically.

The usage-accounting helpers implement the contract that every LLM call in this pipeline must record its token consumption and cost, even when the provider reports nothing. `aggregateTotals` combines two `StageUsage` objects:

```typescript
function aggregateTotals(a: StageUsage, b: StageUsage): StageUsage {
  const costUsd =
    a.costUsd === null || b.costUsd === null
      ? (a.costUsd ?? b.costUsd)
      : a.costUsd + b.costUsd;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd,
    models: [...new Set([...a.models, ...b.models])],
    usageIncomplete: Boolean(a.usageIncomplete || b.usageIncomplete),
  };
}
```

This function takes two stage-usage records and returns a merged one, summing input and output tokens, combining model lists without duplicates, and propagating the `usageIncomplete` flag if either operand had incomplete usage.

`accumulateUsage` performs a similar aggregation but operates incrementally, folding one attempt's usage into an accumulator:

```typescript
function accumulateUsage(
  acc: StageUsage,
  entry: Pick<UsageAttempt, "usage" | "usageKnown" | "costUsd">,
  _pricingOverride: Parameters<typeof calculateCostUsd>[3],
): StageUsage
```

This function takes an accumulator stage-usage record and a single attempt entry (which may or may not have provider-reported usage). When `usageKnown` is false — meaning the provider returned no usage data, as happens on timeout or certain errors — it flags the accumulator as `usageIncomplete` rather than fabricating zero tokens. When usage is known, it adds the attempt's input and output tokens to the running totals, updates the cost with null-safe addition, and appends the model to the list if not already present.

The bulk of this section is the attempt-generation functions, each of which encodes the same multi-stage lifecycle: build an evidence context, construct a prompt (either initial or repair), call the LLM, handle provider errors and non-completion stop reasons, normalize the raw text, validate the artifact, and return a structured result that records usage and outcome for the caller's orchestration logic.

`attemptUnderstandingGeneration(opts: { attemptNumber: number; evidenceBlock: string; language: Language; llmClient: LlmClient; promptKind: "initial" | "repair"; priorCandidate: string; priorErrors: UnderstandingAttemptError[]; pricing: import("./pricing.js").PricingOverride | undefined; thinking?: "disabled" | "adaptive" | "omit" | undefined; repairAttemptContext?: { attempt: number; total: number } }): Promise<UnderstandingAttemptResult>` selects between `buildUnderstandingPrompt` and `buildUnderstandingRepairPrompt` depending on `promptKind`, passing along prior candidate text and errors to the repair variant. The function then calls `llmClient.generate` with the prompt system and user text, capping output at `UNDERSTANDING_MAX_OUTPUT_TOKENS` and optionally passing the `thinking` parameter.

If the generation throws, the function distinguishes `LlmTimeoutError` (mapped to `llm_timeout`) from all other errors (mapped to `llm_call_failed`), returning in both cases a result with unknown usage, an empty normalized raw text, no diagnostic candidate, and an `llm_error` diagnostic outcome. After a successful call, it computes cost from usage and records a `usageEntry` that marks usage as unknown whenever the provider returned `null`, mirroring the timeout contract. When the stop reason is `length` or `incomplete` — meaning the provider stopped before a normal completion — the function returns a validation error with code `truncated_by_token_limit` or `incomplete_generation`, retaining the raw text only for diagnostics and explicitly never offering it as a repair input. Otherwise, it normalizes the raw artifact via `normalizeStage4Artifact`; if normalization fails, it maps the errors into a structured validation-error array and returns a `normalization_failed` outcome. On successful normalization, it validates the artifact with `validateUnderstandingArtifact`, and if validation finds problems, it returns an `artifact_validation_failed` outcome. Only when both normalization and validation pass does the function return the artifact as content-bearing, with a null diagnostic outcome.

`attemptFolderGeneration(opts: { attemptNumber: number; absRoot: string; folder: FolderUnit; fileUnits: readonly FileUnit[]; symbolCountByPath: ReadonlyMap<string, number>; existingPagePaths: ReadonlySet<string>; language: Language; llmClient: LlmClient; promptKind: "initial" | "repair"; priorPurpose: string; priorErrors: ReadonlyArray<{ code: string; message: string }>; pricing: import("./pricing.js").PricingOverride | undefined; thinking?: "disabled" | "adaptive" | "omit" | undefined; maxRepairAttempts: number; consumedSlots: number }): Promise<FolderAttemptResult>` follows a similar flow but targets folder-purpose paragraphs rather than code documentation. This function first builds its evidence by reading from disk the openings of file pages that already exist (determined by `existingPagePaths`), using `safeIo.readText` to read each page and `extractModuleOpeningDigest` to summarize it into an opening block. It then constructs a context block via `buildFolderPurposeContext` that combines the folder metadata, file inventory, symbol counts per path, and the digested openings. The prompt selection mirrors the understanding flow: repair mode calls `buildFolderPurposeRepairPrompt` with prior purpose and errors plus a `{ attempt: consumedSlots, total: maxRepairAttempts }` context object; initial mode calls `buildFolderPurposePrompt`. The function pre-initializes a `base` result object with empty fields and null artifact/diagnostic values so every return path can spread it and override only what changed. After the LLM call, the error handling matches the understanding flow's contract — timeouts produce an `llm_timeout` error, other throws an `llm_call_failed` — with both marking usage unknown. The stop-reason check treats `length` and `incomplete` as validation failures with code `folder_purpose_invalid_shape`, embedding the provider's truncated text as the raw purpose for diagnostics. Otherwise it validates the raw purpose paragraph with `validateFolderPurpose`, returning a validation-failed result or, on success, trimming the text and storing it in the result's `purpose` field with the raw text retained.

`attemptStage4Generation(opts: AttemptOpts): Promise<Stage4AttemptResult>` is the workhorse for module-page generation and encodes a multi-branch strategy. The function first rebuilds the full documentation context on each attempt via `buildModuleDocContext`, because both initial and repair prompts need the same closed-key list, symbols table, and truncated source. When `promptKind` is `initial` and `opts.oversizedFile` is `true`, the function delegates entirely to `generateOversizedFilePage`, which runs a plan-then-write pipeline: an opening pass, a plan pass, per-section passes with complete source slices, and deterministic assembly. The assembled page then flows through the *same* normalization and validation steps as a single-call page — the contract never relaxes for the pipeline. If normalization fails, the function returns a `normalization_failed` outcome; if relaxation is enabled, it marks the candidate degraded *before* validation via `markDegradedArtifact`, so what validation sees is byte-for-byte what writes to disk. When validation fails on an oversized pipeline result, the function tries a mechanical repair immediately via `repairStage4ArtifactMechanically` (because the char-budget guard prevents oversized candidates from ever becoming repair inputs, so the normal repair-slot mechanical fallback would never run). If the mechanical repair succeeds — meaning every error had a supported deterministic fix — the function returns the repaired content. Otherwise it returns the candidate with an `artifact_validation_failed` outcome.

For non-oversized single-call attempts, the function resolves the output token budget with `resolveOutputTokenBudget` based on the configured strategy and ceiling, adjusting for the number of closed-list keys. Before building the prompt in repair mode, the function checks `opts.surgicalRepair`; when eligible, it calls `prepareSurgicalRepair` to build a `SurgicalRepairPlan` targeting only the error-scoped sections, then uses `buildSurgicalRepairPrompt` — otherwise it falls back to the full-context `buildRepairPrompt` with the prior candidate, errors, and context. Initial mode calls `buildStage4Prompt` directly. The LLM call and error handling follow the same contract as the other attempt functions, including the unknown-usage semantics on any throw.

After a successful generation, the function normalizes the raw text. When a surgical plan is active, it splices the candidate's content into the original failed page via `spliceSections`, targeting only the named sections from the plan. If the splice returns `null` — meaning the model changed content outside those sections — the function fails with the *original* prior errors, keeping the original failed page as the next repair input so the base never drifts. When relaxation is enabled, it marks the candidate degraded before validation, again ensuring the validated artifact is the written artifact. When module diagrams are enabled, the function extracts the inline diagram from the page via `extractInlineModuleDiagram`, validates that the page carries a real mermaid block with code `module_diagram_placeholder` if absent, enforces size limits with `flow_diagram_too_large`, and checks Mermaid syntax with `invalid_flow_diagram`; on any failure it returns an `artifact_validation_failed` outcome without an artifact. Successful extraction replaces the candidate with the page content (the placeholder line replaced) and stores the diagram source separately for downstream writing. Finally, the function validates `candidateContent` against the closed key list; on failure, if `opts.allowMechanicalFallback` is set, it attempts `repairStage4ArtifactMechanically` and returns the mechanically repaired content when non-null; otherwise it returns a validation-failed result. Success returns the final candidate with a null diagnostic outcome, preserving surgical outcome and module-diagram source when applicable.

The context builders prepare the evidence that every attempt function consumes. `buildModuleDocContext(absRoot: string, module: Module, charBudget: number, rationaleMaxChars = 0): Promise<ModuleDocContext>` takes the repository root, the module descriptor, a character budget for source context, and an optional cap for rationale evidence. The function calls `getModuleSymbolRows` to enumerate the module's symbols, sorts their keys into `closedKeyList`, and renders a markdown `symbolsTable` listing each key, kind, and signature. It carves `rationaleEvidence` inside the character budget via `getRationaleEvidenceForPaths`, capping it at `rationaleMaxChars`, then subtracts that from `charBudget` to yield the source budget. It delegates the actual source excerpting to `buildFairTruncatedSource`, and returns all four pieces — the closed key list, symbols table, truncated source, and rationale evidence — as a single `ModuleDocContext`.

`buildFairTruncatedSource(absRoot: string, paths: ReadonlyArray<string>, charBudget: number): Promise<string>` takes the repository root, a list of file paths, and a character budget, returning a concatenated source excerpt where each file gets a fair share. The function reads every path from disk and skips unreadable ones. It first computes the full untruncated layout (with per-file headers) and returns it immediately if it fits within budget. When the total exceeds budget, it divides the budget equally across files (with a 128-character minimum share per file), reserves header space within each share, and truncates each file's body so the `bodyBudget` characters contribute to its share. The comments note this fairness exists because sequential first-fit truncation systematically starved later files of context, which strongly correlated with invented anchors — giving every path visible source context reduces hallucinated heading references.

The remaining symbols in this section — `buildFlowDocContext` and `buildResult` — appear in the file's later orchestration stretches; their full bodies fall outside this section's source budget, but `buildFlowDocContext` is the counterpart to `buildModuleDocContext` for flow-diagram pages, assembling flowchart-relevant evidence from a module's flow documents, while `buildResult` assembles the final structured outcome of a batch stage from the parts the attempt functions produced.

## Part 2 (symbols 16–30)
<!-- lw:anchors packages/core/src/batch.ts#buildSurgicalEvidenceSlice packages/core/src/batch.ts#buildTopicDocContext packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#drainPendingMetrics packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#generateOversizedFilePage packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#getModuleSymbolRows packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#getRationaleEvidenceForPaths -->

This part of the file continues the batch-pipeline story by covering the remaining helpers that prepare evidence for topic pages, compute costs, track task state in the database, and finalize a run. The symbols here break into five responsibilities: cost/usage accounting, database task handling, manual-block extraction, evidence assembly for topic documentation, and run finalization with metric draining. The narrative flows from low-level utilities up to the function that assembles a full topic context.

## Cost Accounting and Task State

`emptyUsage()` returns a fresh `StageUsage` record with zeroed token counters, a `null` cost, an empty model list, and `usageIncomplete` set to `false`. This gives callers a stable seed for accumulating usage across a stage or run; it exists so that no stage accidentally shares a mutable usage object.

`computeCostFromUsage(usage, override)` takes a usage object (possibly `null` for unknown usage) and an optional pricing override, then returns the same type as `calculateCostUsd` — a number or `null`. The function treats `null` usage as uncomputable cost, returning `null` rather than a zeroed estimate; it then tries the override map first if the model is present, falls back to the built-in pricing table via `lookupPricing`, and produces a cost via `calculateCostUsd` when the model is priced.

Task persistence sits on SQLite through two helpers. `getOrCreateTask(db, runId, stage, target)` takes the database, run id, batch stage, and target string, then returns an object with `id`, `attempt`, and `checkpoint_json`. It queries `batch_tasks` for an existing row by run, stage, and target; if found, it parses the checkpoint (if any) via `safeJsonParse` to recover the attempt counter, otherwise it inserts a new `pending` row with the current timestamp and returns the new id with attempt zero. `createOrGetTask(db, runId, stage, target, mode)` wraps that logic with a mode flag: when mode is `"only"` it returns `null` immediately because that mode runs only a specific stage, and for `"run"` or `"resume"` it delegates to `getOrCreateTask`. This distinction keeps the pipeline honest — a `"only"` invocation must not create or reuse task records for stages it will not execute.

## Manual-Block Extraction and Frontmatter Ownership

The pipeline writes wiki pages, and users may want to hand-edit sections that the generator must preserve. `extractManualBlocksBySection(content: string): Map<string | null, string[]>` scans the page content for paired marker comments (opening and closing HTML comments that delimit manual regions), pairs each opening marker with its matching closer, and records the raw slice between them. It also parses every Markdown heading to compute a slug, then assigns each manual block to the heading that most recently precedes its start offset. The result maps each section slug (or `null` for blocks above the first heading) to a list of block content strings. This read-only pass is what later lets the generator honor human ownership by keeping those exact blocks untouched on rewrite.

`forceOwnerInFrontmatter(content: string, owner: "generated" | "mixed"): string` guarantees that a page’s frontmatter declares its ownership state. It first confirms the content starts with a YAML `---` fence; if not, it returns the content unchanged. On a valid fence it locates the closing delimiter, then either replaces an existing `owner:` line with the given value (preserving indentation via regex capture) or, when no owner key exists, injects a new `owner:` line immediately after the opening fence. The function returns the full content with the updated frontmatter, and it is what the pipeline invokes before persisting a page so the `generated` versus `mixed` state is explicit and machine-checkable.

## Evidence Assembly for Topic Context

Two functions build the factual backbone that topic planners and section writers rely on.

`getModuleSymbolRows(absRoot, module)` takes the project root and a `Module` object, returning an array of `ModuleSymbolRow`. It opens the index database, resolves the module’s file ids through `getFileIdsForModule`, then queries active symbols joined to those files for key, name, kind, signature, and line range. When the module has no files it returns an empty array; the SQL itself guards against an empty IN clause with a `NULL` fallback.

`getRationaleEvidenceForPaths(absRoot, paths, maxChars)` takes the project root plus a readonly list of paths and a character cap, returning a single string of evidence. After an early exit for a non-positive budget or no paths, it resolves the index database, selects rationale rows (symbol key, kind, text, line) joined to files by path in the given order, and hands the sorted rows to `renderRationaleEvidence`, which formats and truncates the text to the cap.

The larger assembler is `buildTopicDocContext`:

```typescript
export async function buildTopicDocContext(
  absRoot: string,
  candidate: TopicCandidate,
  charBudget: number,
  rationaleMaxChars = 0,
  modulePaths?: ReadonlyMap<string, readonly string[]>,
): Promise<TopicDocContext>
```

This function takes the project root, a `TopicCandidate` describing seed keys, modules, and flows to document, plus a character budget and an optional rationale cap and module path map; it returns a `TopicDocContext` with a symbols table, module digest, and three evidence slices. The flow opens the index database, loads every active symbol named by the candidate’s seed keys, sorts them by key, and builds a plain-text symbols table of `- key (kind): signature` lines. It then assembles a digest by reading the existing wiki page for each candidate module and each flow page, extracting each page’s opening digest text with `extractModuleOpeningDigest`.

For source evidence, the function reads each symbol’s file (caching line arrays across symbols of the same file) and renders an exact source span per symbol via `renderTopicSourceSpan`, joined with `TOPIC_SOURCE_SPAN_SEPARATOR`. The rationale evidence is loaded separately — only when `rationaleMaxChars` is positive — and bounded by that argument, and the function throws if the combined rationale and source spans exceed `charBudget`. The final slice handles prose-tier files (indexed files with zero active symbols, like docs or configs) when `modulePaths` is supplied: it gathers candidate paths, filters down to prose files with a NOT EXISTS clause against active symbols, and carves excerpts from the leftover budget, tagging each with a header that instructs the model to describe rather than cite. All evidence is then returned as a single object holding `symbolsTable`, `moduleDigest`, `truncatedSource`, `rationaleEvidence`, and `proseEvidence`.

## Surgical Evidence and Oversized-File Page Generation

`buildSurgicalEvidenceSlice(absRoot, symbolsTable, citedKeys)` takes the root, the markdown symbols table built elsewhere, and a readonly list of cited keys, returning a string that pairs the exact table rows for those keys with the corresponding source spans. It parses the table by filtering lines beginning with `- key (`, respects a shared `SURGICAL_EVIDENCE_MAX_CHARS` budget by first accounting for the row block, then opens the index database to look up each active symbol’s file and line range. For every cited key it reads the source file, renders the span with `renderTopicSourceSpan`, truncates when the span would exceed the remaining budget, and joins the spans with `TOPIC_SOURCE_SPAN_SEPARATOR`. The final string prefers the source spans when no rows matched, otherwise the row block, and the function closes the database in a `finally`.

`generateOversizedFilePage` orchestrates a three-pass LLM generation for a single overly large file. It takes options for the root, module, language, an LLM client, and a character budget plus pricing and optional reasoning settings, and returns an object with the generated raw text, the token usage, and any LLM error code. The function’s local `call` wrapper accumulates usage across sub-calls while tracking whether every sub-call reported usage — a `null` usage from any provider turns the whole pipeline’s total into “unknown” rather than a silent partial sum — and the `usageKnown`/`accountedCalls` guards ensure a zero-call timeout never masquerades as a real zero-token run. Pass 0 asks the model for an opening block with one retry on length-limited or incomplete stops, failing the page outright if no usable `# heading` block emerges. Pass 1 requests a file section plan parsed by `parseFilePlan`, retries once, and falls back to the deterministic source-order plan via `deterministicFallbackPlan` so the pipeline never dies on an unparseable plan. Pass 2 iterates over each planned section, extracts that section’s complete source slice from the full file (up to a 30,000-character cap) with `extractSectionSource`, builds a section-scoped table from the current symbols table, and asks the model for prose bounded by that slice. The final page is assembled deterministically via `assembleFilePage` from the opening, plan, and per-section prose. All errors collapse into structured returns: a timeout yields an `llm_timeout` code with the sub-call usage already measured, and any other failure yields `llm_call_failed`; both surface the partially accounted usage, never a fabricated total.

## Finalization and Metric Draining

`finalizeRun(db, absRoot, runId, status, opts)` commits a batch run’s terminal state to SQLite. It takes the database, root, run id, one of the completed/aborted statuses, and a rich options object containing token totals by stage and module, refined modules, task counts, the wall-clock start of the invocation, and optional degraded pages. The function builds a `BatchRunSummary`, writes the status plus finish timestamp and serialized summary into `batch_runs`, then mirrors the run’s token totals into the append-only activity ledger through `recordUpdateMetric` — a deliberate fire-and-forget write wrapped in try/catch and queued onto `pendingMetricWrites` so accounting can never affect the run’s outcome or exit code. The comment explicitly notes this is the roadmapped in-session cost accounting touchpoint.

Finally, `drainPendingMetrics()` simply awaits all writes still queued in the module-level `pendingMetricWrites` array, splicing it empty so the next run starts with a clean slate. This is the shutdown hook callers invoke after `finalizeRun` to guarantee queued metric writes have flushed before the process exits.

## Part 3 (symbols 31–45)
<!-- lw:anchors packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#isArtifactVerifyCode packages/core/src/batch.ts#isDeferredBaselineIssue packages/core/src/batch.ts#isRelaxedEligible packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#prepareSurgicalRepair packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#recoverStage4TaskArtifacts packages/core/src/batch.ts#resetTaskToPending packages/core/src/batch.ts#resolveOutputTokenBudget packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#rollbackWrittenArtifacts packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#runSemanticTopicStage -->

The third part of `batch.ts` is where the orchestration of a whole batch run comes together. This is the central nervous system of the file. The code in this section is a single, massive `orchestrate` function that is driven by three thin, exported wrappers: `runBatch`, `resumeBatch`, and `runOnly`. Each of these three functions is an entry point that simply validates its specific preconditions and then delegates to `orchestrate` with a different `mode` value. `runBatch` and `resumeBatch` pass `"run"` and `"resume"` respectively, while `runOnly` first throws an error if no `opts.onlyTarget` is provided and otherwise passes `"only"`.

```ts
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult> {
  return orchestrate({ ...opts, mode: "run" });
}
```

```ts
export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult> {
  return orchestrate({ ...opts, mode: "resume" });
}
```

```ts
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult> {
  if (!opts.onlyTarget) {
    throw new Error("onlyTarget is required for runOnly");
  }
  return orchestrate({ ...opts, mode: "only" });
}
```

These three symbols take a set of user-supplied options (`BatchOptions`) and return a structured `BatchRunResult`. The `runOnly` function is the strictest, requiring a specific target for a focused re-run or a single-page generation.

## The Orchestrate Function: One Run, One Plan

The `orchestrate` function is where the entirety of the batch's execution is planned and driven from a single source of truth.

```ts
async function orchestrate(opts: OrchestrateOpts): Promise<BatchRunResult> {
```

This function accepts `OrchestrateOpts` (which is `BatchOptions` plus an internal `mode` string) and returns the final `BatchRunResult`. It represents a single invocation of a batch operation and orchestrates the sequence of database, repository, and language-model operations that define it.

### Step 1: Setup, Configuration, and Run Identity

The function begins by preparing its working environment and gathering a coherent set of policies from its inputs. It calculates `absRoot` as an absolute path to the repository root and records `invocationStartedAt`, a wall-clock timestamp for *this* invocation (crucial for `--only` rounds that may happen days later). It then ensures `.livewiki/` exists and opens the SQLite index database at its expected location: `safeIo.mkdir` creates the directory, and `openIndex` opens the database. Several configuration layers are then collapsed into a single effective policy for the run. `loadConfig(absRoot)` reads config from disk if it wasn't injected into `opts`, and `applyDefaults(config)` fills in any missing values. Every policy is resolved from three tiers: command-line options (highest priority), the resolved configuration file, and a hard-coded default. The code resolves these in sequence for things like retry budgets, concurrency, and toggles for newer features, each with its own `validate…`-style error-checking:

- **`maxRepairAttempts`** — maximum attempts to repair failed verifications (opts > config > default 2).
- **`maxIncompleteRetries`** — maximum retries for incomplete results (opts > config > default 2).
- **`batchConcurrency`** — the worker-pool size for stage 4 generation; must be an integer between 1 and 16.
- **`surgicalRepair`** — toggles whether repairs use a targeted (mode-aware) or full retry strategy.
- **`relaxedRound`** — toggles a final circuit-breaker round that accepts degraded completions rather than declaring a failure.
- **`moduleDiagramsEnabled`** and **`deepHierarchy`** — toggles for experimental diagram generation and deep dependency analysis.
- **`concernTopics`**, **`understandingSynthesis`**, and **`communityDetection`** — toggles for newer analysis features.
- **`stage4MaxOutputTokens`** — a token budget cap for generation, resolved via `resolveOutputTokenBudget`.
- **`outputTokenStrategy`** — selecting between a fixed token budget or a dynamic one based on context.
- **`charBudget`** and **`rationaleMaxChars`** — control the size of the page-context window and the bounded explanation block carved from it.

After the configuration is resolved, the function determines whether an LLM client is needed and creates one if none was injected by the caller. This is gated by `needsLlm`, which is true for any full mode (`run`/`resume`/`only`) or a non-refine invocation. If a client must be created, the function calls `validateConfigForBatch` to confirm the config is usable, then creates the client. As part of client creation, it triggers a *preflight* probe to catch provider misconfigurations early: `probeProvider(absRoot, resolvedConfig)` fires one bounded request to test the provider's actual behavior (e.g., unexpected thinking-mode defaults), and if the probe fails (or leaks thinking), the entire run aborts immediately by throwing an error with the `formatProbeFailure` message. Only injected clients (used by tests or stubs) skip the probe.

With a policy established, the code records the run's identity in the database. For a fresh `run`, it inserts a new row into the `batch_runs` table with the snapshot of its `config_json` (the effective policies being used). For `resume` and `only` modes, it selects the most recent `batch_runs` row by the highest `id`. If none exists, the run cannot proceed and throws an error.

### Step 2: Preparing the Data — Indexing, Baselines, and the Plan

Now that a run is being tracked, `orchestrate` gathers every piece of repository state it needs. If this is a fresh `run` mode (not a `resume`/`only`), it must build the index from scratch. The code calls `runIndexer` to scan the repository files, passing any configured ignore patterns. It then calls `runLedger` to record the state of the files. This walk is skipped for `resume`/`only` as they operate on the pre-existing SQLite snapshot. Next, before proceeding to the main stages, the function enforces the "documentation baseline" contract. It calls `readBaseline` and handles three outcomes:

- `unavailable`: The function checks whether an anchored wiki exists with obligations via `collectBaselineDocumentationInventory`. If so, it throws an error telling the operator to run `livewiki baseline bootstrap`. If there are no obligations, it initializes an empty baseline using `writeBaselineCompareAndSwap`.
- `incompatible`: The baseline format is no longer valid; the code throws an error that disables automatic batch advancement.
- `available` (or any other): The function can proceed with an existing, compatible baseline.

The core planning data structures are then loaded from the SQLite database via a series of `SELECT` queries. A query loads all `active` symbols (as `symbolRow[]`), and another loads the paths of all `active` files. The union of these becomes the inventory for planning; a map is built from each file path to the count of symbols it contains. Since all this data will be used later by the analysis and generation phases, the code resolves the crucial, bidirectional import graph for all known files. A helper function `collectImportsForFiles` reads raw import strings from all relevant files, and `resolveImportEdges` resolves these strings (relative paths and workspace packages) to concrete file paths within the repository. This resolution is performed only once so all downstream stages use the same consistent view of the repository's dependency structure.

With file-level dependencies understood, the code proceeds to its most fundamental planning step: **partitioning the repository's files into real "page units"**. The planner `planPageUnits` takes the inventory (file paths, symbol counts, and byte sizes) and identifies which files and folders represent units a human would care to read about. The planner only operates on the deterministic data (no LLM involvement) and produces two collections of "page units": `folderUnits` (representing directories) and `fileUnits` (representing symbol-bearing files). Both collections are indexed by their ids for further use. This deterministic partition has a guaranteed property: each file exists in exactly one folder unit, and every file in the repo is accounted for by the `fileUnits` (down to the level of individual files). The code then constructs `modules` (an array of `Module` objects) from the top-level folder units, and separately keeps `fileModules` for the file-level detail. These real-units are the sole input to all subsequent analysis and generation stages.

### Step 3: Gatekeeping — the Stage-2 Diagnostics and the Exact Partition

Before document generation can begin, the batch run must validate its plan and record a checkpoint that a human can audit. A database record is created for the stage itself via `createOrGetTask(db, runId, 2, "modules", opts.mode)`. If a stage-2 record exists (or is just created), it's marked as `done` because the planner is deterministic and needs no LLM. Within this record, the code also stores an optional diagnostic report. If the `communityDetection` feature is enabled, it runs a cross-check to compare the deterministic folder-partition against an alternative partition derived from the import graph (via `detectFileCommunities` and `comparePartitions`). Any errors during this diagnostic are silently swallowed by a try/catch, leaving `communityCrossCheck` as undefined. The checkpoint is then serialized and written to the `batch_tasks` table.

The code then runs its "exact-partition" gate as a defensive check. It wraps the partition in a try/catch block and calls several helper functions to enforce the plan's invariants. `makeUniqueDeterministicIds` guarantees stable ids, and `assertExactPathPartition` throws an `ExactPartitionError` if any file is missing or double-counted. If any of these invariants are violated, the code throws; critically, it does *not* leave the database in a `running` state. In the catch block, it updates the `batch_runs` row to a terminal `aborted` status, filling in a breakdown of usage (all zeros) and the error message, before re-throwing the exception.

### Step 4: Prioritization and the Stage-4 Generation Queue

The deterministic plan is not yet in an order that reflects user priority or dependencies. The code creates this order in a few steps.

First, it converts the raw, file-level import edges into module-level *edges*. It calls `resolveModuleEdges(modules, importsByFile, knownFiles, resolvedImportEdges)` to create a graph of the *modules* to be documented. The prioritization happens with `prioritizeModules(modules, edges, resolvedConfig.pathRoles)`, which assigns each module an order in a new `ordered` list. As a line of defense in depth, it calls `makeUniqueDeterministicIds` and `assertUniqueModuleIds` again on `ordered` before proceeding.

With an order, the function assembles the queue of work for the expensive stage-4 document generation. Before that, however, it must decide what to run. The run's `opts.onlyTarget` field may specify a *subset* of this large queue. The `onlyTarget` string can take several forms, which are parsed into distinct identifiers:

- If `onlyTarget` starts with `"flow:"`, it's a *flow task* target, parsed into `onlyFlowSlug`.
- If it starts with `"topic:"`, it's parsed into `onlyTopicIdentity`.
- If it is exactly the constant `UNDERSTANDING_ONLY_TARGET`, the run only pays down *understanding synthesis* debt (`onlyUnderstanding`).
- Otherwise, the target may be an alias for a specific page unit id. An `onlyAlias` helper maps prefixed `"file:"` and `"folder:"` aliases to the internal ids defined during partitioning; for example, `"file:" + repoPath` maps to the corresponding file unit id, or the original string if no match is found.

Finally, the queue `tasksToRun` is derived. When an `onlyTarget` is present but none of the special handlers (flow/topic/understanding) apply, it filters the full `stage4Queue` down to the module(s) whose id matches `onlyAlias`. If no module matches, an error is thrown to prevent silent no-ops. In stark contrast, if there is *no* `onlyTarget` but the `stage4Queue` is empty while the planner found modules, the pipeline shouldn't proceed: a guard against `EmptyPipelineError` triggers.

At the same time, the database state for *existing* tasks is prepared. For `run` mode, the database should reflect all previous runs, and for `only` mode, the code may need to re-run an already-completed document. The section also handles the state of tasks. When a stage-4 task is a `run` mode or a re-run, the `getOrCreateTask` call within the loop acquires a handle.

If an `opts.onlyTarget` is specified and a task row exists for it (`get…WHERE run_id = ? AND target = ?`), the code resets its status to `pending`. This is crucial because stage-4's `orchestrate` loop will only run tasks that are in a `pending` state. After the plan is ordered and the queue set, the run prepares for the generation itself by cleaning up stale files and recording prior usage. `syncClassDiagrams` deletes class diagrams that are no longer part of the current plan (since the plan is deterministic, any diagram not part of it is stale). The code then accumulates stage-2 usage from the checkpoint to report an accurate total usage breakdown at the end of the run.

### The Stage-4 Worker: `runStage4ModuleTask`

The orchestration function then performs one of its most critical internal operations: defining a worker that handles a single page unit task. To ensure the sequential and concurrent worker-pool execution paths share the exact same logic, the code defines a contained function that processes a single unit.

For a given task, a `Module` object, the code extracts the `task` from the database or creates one. It captures the current time `startedAt`, the `attempt` number, and any pre-existing `usageHistory` or `diagnosticHistory`. Before any expensive work occurs, it calls the frontmatter trust-check: `safeIo.readText` attempts to read the target wiki page from disk. Then `readOwnerFromFrontmatter(existing)` returns a `PreOwnerCheck` value indicating the file's ownership state (e.g., `"human"`, `"mixed"`, `"generated"`, `null`, or an invalid/unparseable state). This check drives a policy gate:

- If the page is owned by `human` (`readOwnerFromFrontmatter` returns `"human"`), the task refuses to proceed and records an error code `refused_human_page`.
- If the owner marker is `"untrusted"` or entirely absent (`"untrusted"` is the state for missing/invalid), the task also refuses (rule #6 — do not touch untrusted pages).
- In the `"unparseable"` case, the frontmatter failed to parse cleanly, so the task refuses to touch it for safety.

If the ownership is acceptable, the worker can attempt to recover existing artifacts from a previous, interrupted attempt. This recovery is coordinated by a separate function `recoverStage4TaskArtifacts`, which is invoked only for full modes (`"run"`/`"resume"`) and only when the owner is `"generated"` or `"mixed"`. The recovery step pulls diagrams, and other prior artifacts out of a database checkpoint so the new attempt can start from the old state rather than regenerating all that deterministic content.

Beyond these safeguards, a worker also builds a deterministic `wikiPath` string for its target module id. Folder units (`folderUnitById`) get pages at `livewiki/<module.id>/index.md`, while file units (`fileUnitById`) get `livewiki/<module.id>.md`. Because the documentation should never invent facts about test files, the worker uses `withTestsPointer` to deterministically append a path string for any paired or likely test files.

The worker function closes over mutable objects (`cb`, `failures`, etc.) and is designed so that all mutations happen via synchronous operations. This guarantees safety when executed concurrently by the worker pool.

## The Database-Resident Helpers

This long `orchestrate` function does not implement every behavior itself; it relies on several dedicated helper functions, each addressing a specific lifecycle concern.

### `readOwnerFromFrontmatter` — The Trust Check Gate

Before a page is to be overwritten with a new LLM generation, the system must know if a human has taken ownership. This function reads the raw text of the wiki file and returns a `PreOwnerCheck` describing its ownership.

```ts
function readOwnerFromFrontmatter(content: string | null): PreOwnerCheck {
```

This function receives the file content (or `null` if the file doesn't exist) and returns a classification of its frontmatter owner status. It handles the `null` case by returning a value indicating a new page (which is safe to write). It uses a tolerant parser that understands LF/CRLF/BOM-based files; if a standard parse fails, it returns `"unparseable"` to signal that the file's structure is unknown.

### `recoverStage4TaskArtifacts` — Resume From Where We Left Off

When a task must be retried, we must preserve the artifacts (like diagrams) that were generated, because they are both deterministic and expensive to rebuild. The function is structured to handle a resume.

```ts
async function recoverStage4TaskArtifacts(opts: {
```

It takes an options object that includes `absRoot`, the `module`, its `wikiPath`, any `folderUnit` or `fileUnit`, the content of the existing page, and various configuration flags (like `moduleDiagramsEnabled`, `moduleMaxDiagramNodes`). The function is `async`, returning a promise; a return value of `null` signals that no artifacts could be located. Internally, its primary job is locating diagram data in the database (in a checkpoints or separate tables). Its second job is retrieving the raw files (e.g., mermaid diagrams and svg files) that have been previously written and mapping them back into a predictable structure (`artifacts`) that the generator can inject.

### `resetTaskToPending` and `rollbackWrittenArtifacts` — Housekeeping and Atomicity

The orchestration loop relies on database state changes

## Part 4 (symbols 46–60)
<!-- lw:anchors packages/core/src/batch.ts#runUnderstandingStage packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#statusToExitCode packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#topicAttemptDiagnostic packages/core/src/batch.ts#topicPlanDiagnostic packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#tryWriteFlowAndVerify packages/core/src/batch.ts#tryWriteModuleDiagramAndVerify packages/core/src/batch.ts#understandingAttemptDiagnostic packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#writeArtifactAtomic -->

This section covers the writing, verification, and diagnostic machinery that sits between generation and durable commit. It is the last mile of every artifact-producing stage: candidate content is placed on disk atomically, validated by the repository verifier, and rolled back if it fails, while structured diagnostics record what happened for the checkpoint and progress reporting. Several helpers here are shared across the understanding and topic flows, so they are the linchpin that turns a raw LLM candidate into a trustworthy, committed artifact.

## Protecting Human Content and Recording What Happened

The file first establishes a set of small utility functions used by the write-and-verify pipeline and by the orchestrators above it. `safeJsonParse<T>` wraps `JSON.parse` in a try/catch and returns `null` on any malformed input — it is the tolerant reader for `checkpoint_json` blobs pulled from `batch_tasks` rows, so a corrupt checkpoint degrades to "no prior state" instead of crashing the run.

Three functions produce the diagnostic records that populate each task's `diagnosticHistory`: `understandingAttemptDiagnostic(attempt, promptKind, result)` takes the attempt number, whether the prompt was `"initial"` or `"repair"`, and a `UnderstandingAttemptResult`, and returns a `DiagnosticAttempt` capturing the stop reason (if any), the outcome (`success`, `incomplete_generation`, `truncated_by_token_limit`, or a repair code), the first `DIAGNOSTIC_MAX_ERRORS` validation errors each trimmed to `DIAGNOSTIC_TEXT_CAP` characters, a count of how many errors were truncated away, and — when a candidate text exists — its character length and SHA-256 so an operator can fetch the exact bytes that failed. `topicAttemptDiagnostic` does the same for stage-4 `Stage4AttemptResult` values, additionally recording `surgicalOutcome` and a `relaxed: true` flag when the repair used the relaxed-validation path. `topicPlanDiagnostic` is a third variant for plan-generation attempts, taking outcome, candidate text, and `TopicPlanValidationError[]` directly rather than wrapping a whole result object. All three stamp `finishedAt: Date.now()` and omit empty stop-reason fields, so checkpoint JSON stays small.

Two helpers normalize external error shapes into the shared `DiagnosticErrors` contract. `summarizeLlmDiagnosticError` converts a single LLM error object (its `code` and `message`) into a one-element error list with `location: "global"`, capping the message text. `summarizeVerifyDiagnosticErrors` maps an array of `VerifyIssue` objects into at most `DIAGNOSTIC_MAX_ERRORS` summarized entries — each carrying the issue code, a location of `"frontmatter"` for `broken_anchor` issues versus `"body"` otherwise, an optional `offending` path trimmed to the cap, and a capped detail message — plus a `truncatedErrorCount`. Both keep the persisted diagnostic history bounded and human-readable even when the underlying failures are verbose.

Two further helpers serve the checkpoint and reporting layers. `slugifyHeadingText` lowercases a heading string, strips diacritics via NFD normalization, removes non-word characters, and joins whitespace runs into single hyphens — producing the stable slug used to match headings when relocating manual blocks. `statusToExitCode` maps the aggregate `BatchRunResult["status"]` to a process exit code: `"completed"` returns `0`, `"completed_with_failures"` returns `1`, and anything else (notably `"aborted"`) returns `2`, so shell callers can distinguish clean success, partial failure, and interruption. `verifyIssuesToValidationErrors` filters a `VerifyIssue` array down to codes that are part of the artifact repair contract (dropping baseline-file and removed-anchor findings, which are repository audits rather than candidate-shape problems) and re-labels them as `ArtifactValidationError` with the same frontmatter-versus-body location rule — this is the bridge the generation attempt layer uses when it must feed verifier feedback back into the repair prompt as `priorErrors`.

Finally, `sectionRangeOf(headingOffset)` closes over a parsed list of headings and, given the byte offset of one heading, returns the end offset of its section — found by scanning for the next heading at an equal or shallower level, or the end of the document if none exists. This is the geometric primitive the manual-block re-insertion logic needs to know where a section stops so a preserved block can be injected just before the next heading.

## The Atomic Write-and-Verify Transaction

The heart of this section is `tryWriteAndVerify`, which implements the single write-and-verify transaction every understanding-page candidate must pass before it can be committed:

```ts
async function tryWriteAndVerify(
  absRoot: string,
  wikiPath: string,
  newContent: string,
  existing: string | null,
  rejectAnySeverity = false,
): Promise<WriteResult>
```

It takes the repository root, the wiki page path, the new candidate content, the previously existing page text (or `null` for a fresh page), and an optional flag controlling whether warnings as well as errors should cause rejection; it returns a `WriteResult` describing either success with artifact hashes or failure with the offending issues, an exception message, or a rollback failure reason.

The function begins not by writing but by protecting human-owned content. If an `existing` page is present, `injectManualBlocksBySection(existing, newContent)` extracts the manually authored blocks from the old page (tracking which heading-slug section each belonged to) and splices them into the new content at the end of their matching sections — and any section that existed only in the old page has its blocks appended at the end of the new page rather than being silently dropped. If the injection succeeds it becomes `finalContent`. Then, if the old page's frontmatter declared `owner: mixed`, `forceOwnerInFrontmatter` rewrites the new page's owner back to `mixed`, because the LLM always emits `owner: generated` but a mixed declaration must survive regeneration or the next run would classify the page differently.

Only after those preservations does the actual transaction begin, with the old page saved as the `snapshot`. The write, verification, and rollback all live in one try/catch: `writeArtifactAtomic` places `finalContent` on disk using a content-addressed lock file and a temp directory so the write is atomic even on crash, then `runVerify(absRoot)` runs the full repository verifier over the updated tree. If either call throws — the write failed, the verifier crashed — the catch block calls `rollbackWrittenArtifacts` to restore the page from its snapshot (with `true` for the best-effort flag since the candidate was never confirmed valid), and returns an `ok: false` result carrying either a `rollbackFailed` reason if restoration itself failed or an `exception` message.

When verification returns normally, the function filters its `issues` for findings on `wikiPath` that are not deferred baseline issues and that meet the severity gate — `rejectAnySeverity ? true : i.severity === "error"`, so the understanding flow uses the default error-only gate while callers that pass `true` demand a perfectly clean page. If any such issue exists the candidate is rejected, and the comment in the source stresses this is not optional: `rollbackWrittenArtifacts` restores the snapshot, and if that rollback fails the function returns `rollbackFailed: { reason }` so the orchestrator knows the invalid content may still be on disk and must treat it as terminal. On a clean sweep it returns `ok: true` with `artifacts` holding the page path and the SHA-256 of `finalContent` — the exact bytes that will later be committed to the durable receipt.

`tryWriteFlowAndVerify` and `tryWriteModuleDiagramAndVerify` are near-identical transactions for the flow and module-diagram stages, which write two artifacts — a wiki page and a Mermaid diagram source — as one unit:

```ts
async function tryWriteFlowAndVerify(
  absRoot: string,
  pagePath: string,
  diagramPath: string,
  pageContent: string,
  diagramSource: string,
  existingPage: string | null,
): Promise<FlowWriteResult>
```

and

```ts
async function tryWriteModuleDiagramAndVerify(
  absRoot: string,
  pagePath: string,
  diagramPath: string,
  pageContent: string,
  diagramSource: string,
  existingPage: string | null,
): Promise<ModuleDiagramWriteResult>
```

Each takes the repo root, the page and diagram paths, the generated page content and diagram source, and the prior page text; both return a result type carrying success artifacts or failure details. Each begins with the identical manual-block injection and `owner: mixed` restoration seen in `tryWriteAndVerify`, because rule #6 applies uniformly no matter which artifact pair is being replaced. Each snapshots the existing page and reads the current diagram text (possibly `null`) for rollback.

The two diverge in what joins the transaction. The module-diagram pair writes the page first and the diagram second inside the try block, then runs the verifier; its rejection gate looks only for `severity === "error"` issues on either written path — warnings never block a module diagram. The flow pair takes the same page-then-diagram writes but additionally rewrites the flows hub at `livewiki/flows/index.md` via `syncFlowsIndexHub` after loading current presentations; `hubWritten` records whether the sync actually rewrote the file, and only that hub snapshot enters the rollback set (a skipped-owner hub was never touched and must not be restored). The flow gate is deliberately stricter than the module and understanding gates: *any* issue — error or warning — on either written path rejects the pair, an asymmetry the source comment flags as a stage-4 design decision, and the rollback set includes the hub if it was written. In both functions, any exception during the multi-write-and-verify block triggers a best-effort rollback of every artifact in the transaction, and a failed rollback surfaces as `rollbackFailed` so the caller knows the invalid pair may persist.

Each success path returns the pair's paths and hashes — the `pageHash` derived from the final content after block injection and owner restoration, and the `diagramHash` over the source bytes after a trailing newline is ensured if missing.

## Orchestrating the Understanding Stage

The stage-coordination function `runUnderstandingStage` pulls all of these pieces together into the full stage-5 pipeline for a single evidence hash:

```ts
async function runUnderstandingStage(opts: {
  db: import("better-sqlite3").Database;
  runId: number;
  absRoot: string;
  modules: Module[];
  ordered: Module[];
  pathRoleConfig: import("./modules.js").PathRoleConfig | undefined;
  llmClient: LlmClient;
  language: Language;
  pricing: import("./pricing.js").PricingOverride | undefined;
  thinking: "disabled" | "adaptive" | "omit" | undefined;
  maxRepairAttempts: number;
  mode: "run" | "resume" | "only";
}): Promise<UnderstandingStageResult>
```

It takes the database handle, the run ID, the repository root, the module list and its topological order, an optional path-role config, the LLM client, language, pricing override, thinking mode, the bounded repair-attempt budget, and the run mode; it returns an `UnderstandingStageResult` tallying usage, task counts, failures, per-task usage, and whether a rollback failed.

The function first builds the understanding evidence from the modules, ordering, and optional path-role config, then checks `hasUnderstandingBasis(evidence)`. Repositories with no accepted module/flow/topic pages and no README purpose have nothing to synthesize understanding from: in `"only"` mode that is an error (the operator asked for work with nothing to work on), but in normal batch mode it is a deterministic no-op that returns the empty result without spending any LLM calls — mirroring the topics stage's small-repo guard. When evidence exists, it is hashed to produce the deduplication target for the batch-tasks table.

Task lookup distinguishes the three modes. In `"only"` mode the function re-runs synthesis against the *current* evidence unconditionally: `getOrCreateTask` ensures a stage-5 row exists (creating it if the evidence hash drifted since the original run) and `resetTaskToPending` clears any prior completion so the work actually happens. Otherwise it queries for an existing stage-5 task with this target; if one is found with a checkpoint whose status is `"done"`, the evidence is unchanged since that success and the stage returns immediately with zero LLM calls. Any other existing task resumes from its checkpoint's attempt count and usage history; a missing task is created fresh.

The retry loop runs at most `1 + maxRepairAttempts` slots. Attempt 0 (or any attempt after a full reset) uses the `"initial"` prompt kind; after a failed candidate the next slot is `"repair"` and receives the prior candidate text and prior validation errors as repair context, with the slot and total attempt budget passed along. Each `attemptUnderstandingGeneration` call returns a usage entry that is appended to the checkpoint's `usageHistory` and accumulated into both the task's and the run's running usage totals; the function also pushes a diagnostic record built by `understandingAttemptDiagnostic`. After each attempt the code branches on the failure class: an LLM error updates `priorErrors` to a synthetic `llm_error` and clears the prior candidate, and a `llm_timeout` short-circuits the whole task as failed (it is not model-repairable) while other LLM errors merely loop into the next repair slot; `incomplete_generation` and `truncated_by_token_limit` outcomes clear both the candidate and error history because the text is unusable as repair fodder; and a `null` artifact (no candidate produced at all) continues to the next slot.

A candidate that survives those checks enters `tryWriteAndVerify`. A rollback failure is terminal for the task. A write/verify exception is also terminal — the candidate was already rolled back inside the helper, and since the failure is infrastructural rather than model-fixable the stage breaks out *without* burning further repair slots, recording a `write_verify_exception` with that reasoning in its message. A verify rejection feeds the issues back as the next repair round's `priorErrors`, mapping each to a code, its `detail` as the message, and a frontmatter-or-body location plus the offending path when present. Only a clean write produces the `artifacts` that end the loop.

If the bounded loop exhausted its slots without producing artifacts and no terminal error was set, the stage attempts a deterministic salvage. When the last candidate is non-empty, its errors are all from the mechanically fixable class — `purpose_too_long`, `surface_too_long`, or `code_span_forbidden` (a known failure family for models that cannot count characters and for MiniMax-M3's persistent inline-code habit on this page kind) — `salvageUnderstandingCandidate` clips the offending formatting and trailing clauses, and the rebuilt page goes back through `tryWriteAndVerify`. The salvage re-validates the whole contract, so any residual violation keeps the failure; only a clean write adopts the salvaged artifacts, and anything else falls through to `repair_exhausted`.

With artifacts in hand and no prior task error, the stage calls `commitDocumentationTask` to durably record the verified artifact under the repository-authority receipt. If that commit throws, the task fails with `durable_commit_failed` — the content is verified on disk but the authority record that would let future runs recover or resume it could not be written, which must surface to the operator. Finally the stage persists a checkpoint: a failure writes `status: "failed"` with the error, attempt count, timestamps, usage and diagnostic history into `checkpoint_json`, increments the run's `fails` count, and records a failure entry carrying the task ID, the evidence-hash target, the error, and the `livewiki batch --only understanding <runId>` retry command for the operator; a success writes `status: "done"` with the same history plus the artifacts, increments `done`, and the task's usage is appended to `usageByTask` keyed by the evidence target. Either way the returned result lets the outer batch driver roll these per-stage counts into the run's aggregate report.

## Tests

Covered by `packages/core/src/batch.test.ts` (same-name test file on disk).
Likely also exercised by `packages/core/src/batch-atomic-writes.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-community.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-concurrency.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-context.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-module-diagrams.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-repair.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-review.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-stage5.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-surgical-repair.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-test-role.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-understanding.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-unknown-usage.test.ts` (name-prefix match, not verified).
