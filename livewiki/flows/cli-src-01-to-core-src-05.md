---
title: CLI to persistence flow — entry through `livewiki batch` to the SQLite index
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/commands/batch.ts#registerBatch
  - packages/core/src/anchors.ts#extractAnchors
  - packages/core/src/artifact.ts#flowDiagramPlaceholder
  - packages/core/src/batch-state.ts#summarizeDiagnosticErrors
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/flow-diagram.ts#generateFlowDiagram
  - packages/cli/src/commands/export.ts#registerExport
  - packages/core/src/anchors.ts#slugify
  - packages/core/src/artifact.ts#markDegradedArtifact
  - packages/core/src/batch-status.ts#buildStatusReport
  - packages/core/src/batch.ts#runBatch
  - packages/core/src/flow-diagram.ts#insertFlowDiagramSection
  - packages/cli/src/commands/index-cmd.ts#registerIndex
  - packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically
  - packages/core/src/artifact.ts#normalizeStage4Artifact
  - packages/core/src/batch-status.ts#listRuns
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/flows.ts#assignFlowKeySections
  - packages/core/src/config.ts#applyDefaults
  - packages/core/src/config.ts#loadConfig
  - packages/core/src/config.ts#resolveBaseUrl
updated: 2026-08-02
modules:
  - cli-src-01
  - commands
  - core-src-01
  - core-src-02
  - core-src-03
  - core-src-04
  - core-src-06
  - core-src-05
---

# CLI to persistence flow

This page explains the end-to-end behaviour that turns a shell invocation of the `livewiki` binary into persisted documentation pages anchored against the SQLite index.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

The flow starts when a user runs the `livewiki` binary on the command line, and it produces a populated wiki tree plus a status report that can be queried from the same CLI. The CLI is a thin Commander wrapper: `createProgram()` builds the program, `readVersion()` resolves the version string printed in `--help`, and every command handler funnels through `resolveRepoRoot()` so the `--repo` flag consistently materialises the target directory before any core call is made. `run(argv)` then parses argv, dispatches to the registered subcommand handler, and returns a non-zero exit on failure. Inside the action handlers the same shape repeats — `path.resolve(process.cwd(), resolveRepoRoot(opts.repo ?? "."))` — which is why every command page in `commands/` re-imports `resolveRepoRoot`. The end product is a deterministic wiki: an indexed SQLite cache, per-module Markdown artefacts validated against the closed anchor contract, optional stage-5 flow pages with companion `.mmd` files, and a status surface that re-reads the same database to answer what happened.

## Ordered flow
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/core/src/anchors.ts#extractAnchors packages/core/src/artifact.ts#flowDiagramPlaceholder packages/core/src/batch-state.ts#summarizeDiagnosticErrors packages/core/src/batch.ts#resumeBatch packages/core/src/flow-diagram.ts#generateFlowDiagram packages/cli/src/commands/export.ts#registerExport packages/core/src/anchors.ts#slugify packages/core/src/artifact.ts#markDegradedArtifact packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch.ts#runBatch packages/core/src/flow-diagram.ts#insertFlowDiagramSection packages/cli/src/commands/index-cmd.ts#registerIndex packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/batch-status.ts#listRuns packages/core/src/batch.ts#runOnly packages/core/src/flows.ts#assignFlowKeySections -->

1. `packages/cli/src/index.ts` calls `run(process.argv)` from `cli.ts`; `run` constructs the program with `createProgram()` and lets Commander route argv to a subcommand.
2. The subcommand registration sequence in `cli.ts` attaches `registerBatch(program)`, `registerExport(program)`, and `registerIndex(program)` from `packages/cli/src/commands/`. Each registration pins the command name, its flags, and its action handler; every action resolves the repo root through `resolveRepoRoot()`.
3. `registerIndex` wires `livewiki index`, which loads the per-repo config, opens the SQLite index, walks the tree, and records `files`/`symbols`/`calls`. The walker is the only consumer of the configured `ignores` list.
4. With the index in place, `registerBatch` wires `livewiki batch <run>` — the action dispatches into `runBatch(opts)` in `packages/core/src/batch.ts`, which orchestrates the four-stage documentation pipeline (scan → identify modules → prioritise → per-module document). The same handler also routes `--resume` to `resumeBatch(opts)` and `--only <target>` to `runOnly(opts)`, both of which reuse the existing SQLite snapshot rather than re-walking the tree.
5. Inside stage 4 the orchestrator normalises the raw LLM response with `normalizeStage4Artifact(raw)` (stripping a leading `<think>…` block, unwrapping one outer ` ```markdown ` fence), then mechanically attempts to repair structural defects with `repairStage4ArtifactMechanically(...)` only when the validator's error set stays inside the supported whitelist.
6. After normalise/repair the artefact is validated against the closed anchor contract. Repairs that are out of scope (`anchor_in_disallowed_section`, `anchor_missing_in_required_section`, `anchor_missing_required_tier`) remain repairable by prompt only and fall through to the bounded corrective-repair loop. Stages that exhaust their repair budget are stamped with `markDegradedArtifact(content)` so downstream consumers can detect the drop in quality.
7. Auxiliary (`fixture` | `tooling` | `docs`) modules skip the LLM stage-4 loop entirely and are assembled deterministically; product modules are emitted through the LLM path.
8. Stage 5 enumerates `FlowCandidate` walks from the module graph; `assignFlowKeySections(candidate)` classifies each anchored key into entry / boundary / sink tiers so the page can be split into exactly those sections. The Mermaid flowchart for each candidate is rendered deterministically by `generateFlowDiagram(...)` and the page body is rebuilt with `insertFlowDiagramSection(...)` — the page itself never carries an inline diagram; instead a `flowDiagramPlaceholder(slug)` token points to the companion `.mmd` file.
9. While stage 4 and stage 5 run, `summarizeDiagnosticErrors(...)` in `batch-state.ts` caps each task's `diagnosticHistory` slice so the report surface stays bounded.
10. On completion, the action returns the run summary to the CLI; the user can then call `livewiki batch status` which is handled by `buildStatusReport(...)` after `listRuns(repoRoot)` lists the persisted runs from `batch_runs`.
11. `registerExport` wires `livewiki export <target>`; the action reads `livewiki/`, flattens deterministically, and writes to `.livewiki/export/<target>/`, stripping anchor metadata and rewriting links/fragments before exit.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-01-to-core-src-05.mmd
```

## Invariants

- The program shape is fixed: `createProgram()` returns a Commander program named `livewiki` and `cli.test.ts` asserts the full set of registered subcommands, so removing a registration without updating the smoke test fails the build.
- The `--repo` flag is honoured at the boundary of every command: `resolveRepoRoot(opts.repo ?? ".")` is the recurring pattern, and `path.resolve(process.cwd(), …)` produces the absolute directory the indexer and the batch pipeline both consume.
- The index DB is derived (rule #3 of the SPEC). `livewiki init` ensures `.livewiki/` is listed in `.gitignore` via the idempotent managed-block writer, and `db.ts` is opened by the indexer, the anchor ledger, the batch pipeline, the status reporter, and the diff preview — they all see the same `files`/`symbols`/`calls`/`anchors`/`doc_pages` rows.
- `normalizeStage4Artifact` is the single seam that strips a leading `<think>…`, detects an unclosed reasoning block (invalid), detects "reasoning only" (invalid), and unwraps exactly one outer ` ```markdown ` fence. Every other stage consumes its output as the canonical artefact.
- The closed-anchor contract is enforced end-to-end: frontmatter `owner: generated`, dual completeness of frontmatter `anchors:` and `lw:anchors` markers, no banned `TODO`/`TBD` placeholder, and fully closed Markdown. Auxiliary pages bypass the LLM loop to stay mechanically compliant.
- `slugify` collapses whitespace, strips diacritics, and lowercases so section slugs in the wiki match the `section_slug` rows in the `anchors` table; `extractAnchors` returns the dual set (frontmatter page anchors + in-body section markers) used by the validator and the stage-5 `assignFlowKeySections` step.
- Stage-5 flow diagrams are never inline. `flowDiagramPlaceholder(slug)` is the canonical substitute; the actual `flowchart` block lives in a companion `.mmd` file produced by `generateFlowDiagram`. The LLM does not write Mermaid syntax.
- `summarizeDiagnosticErrors` caps the `diagnosticHistory` slice (`DIAGNOSTIC_TEXT_CAP`, `DIAGNOSTIC_MAX_ERRORS`) so the `batch status` report stays bounded even when the orchestrator records many failures per task.
- Stage 4 / stage 5 / status all write through `safe-io`, so every output path is validated against the allowlist before disk touches happen.

## Failure and recovery
<!-- lw:anchors packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveBaseUrl -->

The visible failure path in the cited source is the missing-provider path in `config.ts`. `loadConfig(repoRoot)` reads `.livewiki/config.json`; when `provider` or `model` are absent and a batch LLM step runs, `validateConfigForBatch()` throws `MissingProviderConfigError` with a message pointing at the config file. There is no hardcoded model default — the API key lives only in `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars, so a missing key fails fast at the LLM client boundary instead of leaking into version control. `applyDefaults(config)` merges the well-known defaults (`CONFIG_DEFAULTS`) into a partial config before validation runs, and `resolveBaseUrl(config)` selects the chat-completions endpoint used by the stub HTTP server in the E2E tests — the same base URL the `openai-compat` provider receives at runtime. The supplied source does not show additional recovery branches for this layer (no retry/rollback/fallback for `loadConfig`/`applyDefaults`/`resolveBaseUrl` is visible beyond the `MissingProviderConfigError` throw); other failure modes in the pipeline (failed tasks, circuit breaker, surgical repair, `markDegradedArtifact`) are documented in their own pages rather than here.

## Related pages

- [cli-src-01 module page](../cli-src-01.md)
- [commands module page](../commands.md)
- [core-src-01 module page](../core-src-01.md)
- [core-src-02 module page](../core-src-02.md)
- [core-src-03 module page](../core-src-03.md)
- [core-src-04 module page](../core-src-04.md)
- [core-src-06 module page](../core-src-06.md)
- [core-src-05 module page](../core-src-05.md)
- [How it works](index.md)