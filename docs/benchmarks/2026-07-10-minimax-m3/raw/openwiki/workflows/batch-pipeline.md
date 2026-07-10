# Batch pipeline (Phase 3)

> `livewiki init --batch` (or `livewiki batch run/resume/--only/list`) drives the 4-stage full-documentation pipeline. Each stage is resumable; each task is independent; failure is local, not catastrophic. Tokens are the primary metric; USD is a secondary estimate.

The batch pipeline is **not** the heart of the product — incremental mode is. But batch is what you reach for when you have an undocumented (or freshly cloned) repo and need a complete wiki before you start iterating.

## The four stages

```
   Stage 1                Stage 2                 Stage 3                Stage 4
┌────────────┐         ┌─────────────┐         ┌────────────┐         ┌────────────┐
│  Scan      │────────▶│ Modules     │────────▶│ Prioritize │────────▶│ Doc per    │
│  + Index   │         │ (heuristic  │         │ (centrality│         │ module     │
│  + Ledger  │         │ + LLM       │         │ + size)    │         │ (1 LLM     │
│            │         │  refine)    │         │            │         │  call/task)│
└────────────┘         └─────────────┘         └────────────┘         └────────────┘
   deterministic        deterministic +            deterministic         LLM
   (no tokens)         opt-in 1 LLM call         (no tokens)          (1 call / module)
```

Source: `packages/core/src/batch.ts` — the orchestrator. Entry points: `runBatch`, `resumeBatch`, `runOnly`.

### Stage 1 — Scan

Calls `runIndexer()` + `runLedger()` (quietly). Result: the SQLite `symbols` table reflects the current repo state.

### Stage 2 — Module identification

- **Heuristic (always):** `identifyModulesHeuristic(filePaths, symbolCountByPath)` groups files by top-level directory. Slug = last segment of the directory (or basename for root-level files when they are the only ones in the repo, else `root`).
- **LLM refine (opt-in):** if `--batch` was used without `--no-refine`, the orchestrator calls the LLM with the heuristic module list and accepts a refined module list — rename modules, merge, split. Validated against the heuristic:
  - JSON must parse; `modules` must be a non-empty array.
  - Every heuristic file must be covered by exactly one refined module (no orphans, no duplicates, no IDs-less entries).
  - Coverage must be 100% of heuristic files (`< 80%` is rejected — prevents LLM from "losing" files).
- **Failure mode:** a 4xx/5xx/timeout from the LLM does **not** fail the task — it is logged as `refine_failed_degraded` and the heuristic wins. Task status remains `done`.
- **Where refined modules live:** `batch_runs.summary_json.modulesRefined` (Fix J rev2) — not concatenated into the per-task JSON (that corrupted parse and zeroed stage-2 usage in `status`).

### Stage 3 — Prioritization

`prioritizeModules(modules, edges)` — orders by centrality (how many other modules import this one) and module size (`symbolCount`). The CLI exposes `--plan` to preview the order before running the LLM in stage 4.

Edges come from `resolveModuleEdges(modules, imports, allFilePaths)` — built from tree-sitter's `import_statement` / `export_statement` (TS) and `import_statement` / `import_from_statement` (Python). NodeNext extensions are stripped (`.js`/`.mjs`/`.cjs`) so `import x from "../utils/crypto.js"` resolves to `crypto.ts` and `index.js` is treated as a barrel (Fix K rev2).

### Stage 4 — Coordinated documentation (one task per module)

For each module in priority order:

1. **Owner guard (regra #6):** if a wiki page exists for the module with `owner: human`, throw `refused_human_page`. The task is marked `failed` with the reason in the checkpoint and the run continues.
2. **LLM call.** `buildStage4Prompt(module, closedKeyList, symbolsTable, truncatedSource, language)` from `prompts.ts`. The LLM receives the **closed list of canonical symbol keys** for the module and distributes them across sections — never invents a key.
3. **Token accounting.** The `usage` returned by the adapter (`{ inputTokens, outputTokens, model }`) is appended to `usageHistory` and aggregated into the run report. `costUsd` is computed from `PRICING_TABLE` (or `config.pricing` overrides) — `null` if the model has no entry (no fabricated USD).
4. **Write.** `writeWikiPagePreservingManual(absRoot, "livewiki/<module-id>.md", content)` writes via `safe-io`, preserving `lw:manual` blocks byte-for-byte from the previous version (if any).
5. **Verify.** `runVerify(absRoot)` is run on the whole repo. If the newly-written page emits any `error`-level `broken_anchor`, the task fails with `verify_failed` (detail lists each issue).
6. **Checkpoint.** `checkpoint_json = { stage: 4, status, attempt, startedAt, finishedAt, usageHistory[], artifacts: { wikiPath, pageHash } }`. `artifacts.wikiPath` lets `status` link to the page.

The per-task checkpoint is the **primary artifact** for token accounting — every retry appends another `UsageAttempt` to `usageHistory`. The aggregated report (`BatchStatusReport`) reads all checkpoints for the run.

## Failure policy (commit d274dd9)

- A failed task **does not abort the run.** It is recorded with `status='failed'`, an `error.code` (`verify_failed` / `refused_human_page` / `unexpected`), and a human-readable `error.message`.
- **Circuit breaker** (after each failure):
  - 3 consecutive failures → abort.
  - OR more than 50% failures **with at least 3 tasks attempted** (without the `>=3` guard, a 1-task run would abort on its first failure — Finding from rev2).
- Run statuses: `completed` / `completed_with_failures` / `aborted`.

### Empty-pipeline guard (Fix H rev2)

If `ordered.length > 0` AND `tasksToRun.length === 0` AND mode is not `only`, the orchestrator throws `EmptyPipelineError`. Status becomes `completed_with_failures` (exit 1) — never `completed` (exit 0). This catches: heuristic found modules → refinement rejected → empty list, or `--only` target not found.

Additionally, if the run finishes with `cb.done === 0` and `ordered.length > 0`, status is forced to `completed_with_failures` and a synthetic failure entry is added with `retryCommand` pointing at `livewiki batch resume <runId>`.

## Exit codes (single source of truth: `core/batch.ts:statusToExitCode()`)

| Status | Exit |
|---|---|
| `completed` | 0 |
| `completed_with_failures` | 1 |
| `aborted` | 2 |

`livewiki init --batch` propagates the batch exit code via `InitResult.batchExitCode` (Fix O). Without this, an aborted batch would exit 0 and mask systemic failure.

`livewiki init --batch --json` always exits 0 (structured output, batch CLI convention).

**Implementation gotcha (Fix L rev2):** CLI uses `process.exitCode = N` + `return` (never `process.exit(N)`) in init/batch catch handlers. `process.exit` with open async handles (fetch, SQLite WAL, watcher) triggers a libuv assert (`STATUS_STACK_BUFFER_OVERRUN = 0xC0000409`, exit code `-1073740791` on Windows). Setting `exitCode` lets Node drain the event loop.

## --only — re-run a single task

`livewiki batch --only <module-id-or-target>` reruns one task without running the full pipeline. It is also the surface that the in-session agent uses from Phase 5 (`livewiki update --llm`-equivalent paths).

Behavior:

- Resets that task to `pending` (preserving prior `usageHistory` for the audit trail).
- Re-runs the LLM call, posts a new `UsageAttempt` to `usageHistory`, writes the page, runs `verify`.
- Preserves `lw:manual` blocks byte-for-byte.
- Refuses `owner: human` pages.
- The retry's tokens show up in the next `livewiki batch status` report.

## Reporting — `livewiki batch status [runId]`

Source: `packages/core/src/batch-status.ts` (`buildStatusReport`).

Output (human or `--json`):

- `run`: id, status, started_at, finished_at, started_by, `summary.modulesRefined`.
- `totals`: aggregate `StageUsage { inputTokens, outputTokens, costUsd, models }`.
- `byStage`: stage 2 (refine) and stage 4 (doc) usage.
- `byModule`: per-module usage; useful for "what cost the most to document?".
- `tasks`: per-task row (id, target, status, attempt, error if any).
- `failures`: synthetic list of `{ taskId, module, error, retryCommand }` so the user has a ready retry command without re-reading logs.

**Token-first reporting** (commit ad87319):

- The primary metric is **tokens** (input + output separated — output costs more in any pricing table).
- USD appears only when `costUsd !== null` somewhere in the run, marked "estimated, table as of `<PRICING_REFERENCE_DATE>`", and silently dropped if there's no price entry. This is the SPEC §"Token accounting (Phase 3)" policy.

## Manifest handoff

`packages/core/src/manifest.ts` writes `livewiki/.manifest.json` at the end of a batch run:

```json
{
  "version": 1,
  "lastDocumentedCommit": "<sha>",
  "snapshotHash": "<sha256 of livewiki/ excluding the manifest itself>",
  "updatedAt": "<ISO 8601>",
  "pendingBatch": { "runId": N, "stage": 4, "done": K, "total": T } | null
}
```

- `snapshotHash` excludes the manifest itself (OpenWiki convention) — avoids rewriting on metadata-only changes.
- `pendingBatch` is set only when the run ended with failures or zero completions, so a fresh machine can call `livewiki batch resume <runId>` and continue from the same task.

`manifestsEqual` ignores `updatedAt` — otherwise every `Date.now()` would force a rewrite and CI would always see a diff.

## Token accounting at a glance

The thesis is **measured, not estimated**. Each `UsageAttempt` carries:

```ts
{
  attempt: number,
  usage:   { inputTokens, outputTokens, model },
  costUsd: { input, output, total, refDate } | null,
  finishedAt: number,
}
```

- Batch: aggregated in `BatchStatusReport`. USD appears only when `costUsd !== null` somewhere.
- Incremental: recorded by `livewiki update` and `livewiki update --record-write N`; aggregated in `StatusReport.metrics` (Phase 5). `efficiencyRatio = writeReceivedTokens / packageEmittedTokens` is the empirical signal of the product thesis.

## CLI surface

```bash
# Kick off a full documentation run
livewiki init --batch [--no-refine] [--plan]

# Resume / inspect / re-run
livewiki batch status [<runId>]            # default subcommand
livewiki batch resume <runId>
livewiki batch --only <module-id> <runId>  # re-run a single task
livewiki batch list

# Exit codes (single source of truth: statusToExitCode)
# 0 = completed, 1 = completed_with_failures, 2 = aborted
```

## Where to go next

- [Indexing and anchor-ledger](indexing-and-debt.md) — what powers stages 1 and the upstream of stage 4.
- [LLM providers & presets](../integrations/llm-providers.md) — what `createLlmClient()` instantiates.
- [Incremental update](incremental-update.md) — the same engine, the other mode (no batch overhead).