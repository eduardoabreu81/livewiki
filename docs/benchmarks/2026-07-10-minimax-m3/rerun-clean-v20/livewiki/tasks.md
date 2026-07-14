---
title: Tasks
owner: generated
---

# Tasks

Choose a module by the work you need to do. Product work is listed first; auxiliary repository roles are kept separate.

## Product tasks

### [Core pipeline orchestration, config, schema, and helpers](core-src-02.md)

Module ID: `core-src-02`

- **Run, resume, or re-run a single** batch task by invoking `runBatch`, `resumeBatch`, or `runOnly` and inspecting the returned `BatchRunResult`.
- **Load or validate a repo's `.livewiki/config.json`** with `loadConfig`, `applyDefaults`, `validateConfigForBatch`, and `MissingProviderConfigError` before any LLM stage.
- **Open the SQLite index** with `openIndex`, inspect `CURRENT_SCHEMA_VERSION`, and apply pending migrations via `migrationsFor`, `migrateV3ToV4`, and `postV3Migrations`.
- **Render deterministic architecture diagrams** by calling `generateStructure`, `generateModulesGraph`, or `generateClassDiagram`, and slug modules with `moduleSlug`.

### [Core navigation, parsing, pointer, presets, pricing, prompts, safe I/O, and status surface](core-src-04.md)

Module ID: `core-src-04`

- **Build or extend** navigation pages and per-module `navigate` blocks using the helpers in `navigation.ts`, **wire up** tree-sitter grammars via `parser.ts`, **manage** the `AGENTS.md` / `CLAUDE.md` pointer block via `pointer.ts`, and **resolve** provider presets and pricing through `presets.ts` and `pricing.ts`.
- **Compose** stage-2/4, repair, quickstart, and overview prompts with the editorial contract constants in `prompts.ts`, **sanitize** untrusted content with the `neutralizeUntrustedControlMarkers*` helpers, and **perform** all disk I/O through the allowlisted helpers in `safe-io.ts`.
- **Report** wiki status (file counts, symbol kinds, debt, undocumented, incremental metrics) through `status.ts`, and **drive** parser-backed symbol-extraction tests through the `parse` helper in `symbols.test.ts`.

### Core source — part 3 of 5

Module ID: `core-src-03`

Page unavailable: `livewiki/core-src-03.md` has not been generated yet.

### [anchor ledger, artifact validation, and batch status](core-src-01.md)

Module ID: `core-src-01`

- Run the anchor ledger to detect changed, moved, or deleted symbols and emit debt rows.
- Validate or normalize a stage-4 LLM artifact before it is written to disk.
- Inspect batch-run usage, per-stage totals, and per-module breakdowns for a completed run.
- Extend or read the bounded diagnostic history attached to stage-4 task checkpoints.

### [core SRC — incremental update, verification and walker](core-src-05.md)

Module ID: `core-src-05`

- **Trace** how a single tree-sitter node becomes a `SymbolRecord` and what makes the symbol key unique across files.
- **Inspect** the on-disk metrics ledger (`.livewiki/update_metrics.json`) used to expose the read/write token economy of the incremental update flow.
- **Reason about** the shape of a `WorkPackage` and how `loadWorkPackage` assembles manifest, debt, snippets, valid anchors and the `package_emitted` metric.
- **Understand** how `verify` collects wiki pages from disk, resolves `.md`/`.mmd` links and detects altered manual blocks byte-for-byte.

### [LLM client and provider adapters](llm.md)

Module ID: `llm`

- **Wire up** a new batch run by calling `createLlmClient(repoRoot, config)` from `packages/core/src/llm/index.ts` and using the returned `LlmClient.generate` entry point.
- **Add or debug a provider** by reading how `AnthropicAdapter` and `OpenAiCompatAdapter` translate provider-specific request/response shapes into the normalized `GenerateResult`.
- **Diagnose batch failures** by mapping thrown errors to `LlmRequestError`, `LlmTimeoutError`, or `MissingApiKeyError` and consulting `requestWithRetry` retry/abort rules.
- **Tune timeout or retry** behavior by inspecting `DEFAULT_LLM_TIMEOUT_MS`, `withTimeoutMs`, and the `isRetryableStatus` policy in `base.ts`.

### [CLI command surface (livewiki/commands)](commands.md)

Module ID: `commands`

- **Add or modify a `livewiki <cmd>`** by editing the matching `registerX(program: Command)` in `packages/cli/src/commands/<cmd>.ts`.
- **Format JSON vs. human output for an existing command** by tracing its `emit(json, payload, formatHuman(...))` call site.
- **Decide exit-code policy (success / completed_with_failures / aborted)** by reading `setExitCode` in `batch.ts` and the explicit `process.exitCode = 1` lines in other commands.
- **Reuse the Phase-0 stub for an unimplemented command** by calling `makeStubAction({ name, phase, planned })` from `stub.ts`.

### [CLI source and end-to-end test scaffolding](cli-src.md)

Module ID: `cli-src`

- **Run** the compiled `livewiki` binary against a temporary repo fixture.
- **Add** a new end-to-end scenario that needs a stubbed LLM endpoint.
- **Switch** command output between JSON and human-readable forms via `output.ts`.
- **Inspect** how the `livewiki` commander program is assembled in `cli.ts`.

### [MCP server module](mcp-src.md)

Module ID: `mcp-src`

- **Run** the MCP server in production with `npx -y @livewiki/mcp --repo <path>`.
- **Connect** an MCP client (Claude Code or test harness) to the stdio transport and call the 6 `livewiki_*` tools.
- **Debug** the wiki allowlist, `verify`-then-write semantics, or FTS5 indexing for `livewiki_search` / `livewiki_write_doc`.
- **Extend** the server with additional tools or alternative transports while keeping `core/safe-io` as the file-write boundary.

## Fixture tasks

### [Sample fixture AuthService module](sample-ts-repo-src.md)

Module ID: `sample-ts-repo-src`

- **Verify** that the indexer recognises an `export class` with a private field and two methods.
- **Verify** that free-standing `export function`, `export function` (legacy/deprecated name), and `export const` exports each surface as distinct symbol kinds.
- **Compare** extracted signatures against the canonical keys listed above when debugging extraction regressions.

### [fase2-repo auth fixture](fase2-repo-src.md)

Module ID: `fase2-repo-src`

- **Inspect** the canonical token-validation entry point when stubbing authentication in fixture-driven tests.
- **Reference** the exported `Auth` class and its `hash` method when validating that the indexer resolves class members correctly.
- **Audit** the auxiliary `extra` helper to confirm top-level free functions are indexed alongside classes.
- **Cross-check** that the four-symbol anchor set matches the keys the indexer emits for this fixture.

## Tooling and benchmark tasks

### ["Benchmark tools: acceptance analysis and token proxy"](tools.md)

Module ID: `tools`

- **Audit** a benchmark artifact root with `node acceptance-analysis.mjs <artifactRoot>` to confirm the run completed and every planned module page exists.
- **Re-mirror** upstream token usage during a rerun by pointing a tool at the local `token-proxy.mjs` on `LIVEWIKI_PROXY_PORT` instead of the upstream base URL.
- **Investigate** a `verify.json` issue or a `cross_section_duplicate` / `frontmatter_duplicate` finding by reading the analyzer's page-scan logic.
- **Triage** a `NO USAGE` line in the proxy log by tracing the usage extraction path for non-streaming and SSE responses.

### [Benchmark harness helpers for clean v18 rerun](rerun-clean-v18.md)

Module ID: `rerun-clean-v18`

- **Run** `_acceptance-analysis.mjs` after a rerun to compute the corrected acceptance JSON (`overallGate: PASS|FAIL`) for a clean-v18 artifact.
- **Run** `_qualitative-audit.mjs` to flag concrete regressions (unclosed Markdown, empty sections, helper leakage into `quickstart.md`, diagram declaration collisions, `commands.md` `process.exit` contradictions, truncated page bodies).
- **Cross-check** the resulting `metrics/*.json` files against the product validator to decide whether to promote a rerun.

### [Qualitative audit runner for rerun-clean-v19](rerun-clean-v19.md)

Module ID: `rerun-clean-v19`

- **Reproduce** the qualitative gate by running `node _qualitative-audit.mjs <artifactRoot>` against the frozen artifact directory.
- **Diagnose** a failing `modulePageStructure`, `noTruncatedPageEndings`, or `commandsMatchesProcessExitCodeImplementation` check by mapping the failing page to the relevant masker.
- **Audit** which Markdown files the script classifies as module pages versus the `quickstart.md` / `architecture/overview.md` layout exemptions.
- **Extend** the audit by adding a new probe inside `scanModulePage` while keeping the output schema stable.

### Rerun clean v11 module

Module ID: `rerun-clean-v11`

Page unavailable: `livewiki/rerun-clean-v11.md` has not been generated yet.

### Rerun clean v12 module

Module ID: `rerun-clean-v12`

Page unavailable: `livewiki/rerun-clean-v12.md` has not been generated yet.

### [Qualitative audit driver for the clean v13 rerun](rerun-clean-v13.md)

Module ID: `rerun-clean-v13`

- **Run** `node _qualitative-audit.mjs <artifactRoot>` after a rerun to write `metrics/qualitative-audit.json` and dump the same JSON to stdout.
- **Inspect** the `checks` block to see whether `modulePageStructure`, `noMissingMmdLinks`, `noBenchmarkHelpersInImportantSymbols`, `noDuplicateDiagramDeclarations`, `noTruncatedPageEndings`, and the quickstart/commands shape checks all passed.
- **Triage** failed pages by reading the per-page `failedPageChecks` entries (duplicates, empty sections, unclosed Markdown, visible sentinel text, unfinished prose flagged by a `\b(?:TODO|TBD)\b` scan) reported alongside the aggregate gate.
- **Skip** this script during normal page generation; it only reads the frozen output and never edits generated pages.

### Rerun clean v14 module

Module ID: `rerun-clean-v14`

Page unavailable: `livewiki/rerun-clean-v14.md` has not been generated yet.

### Rerun clean v15 module

Module ID: `rerun-clean-v15`

Page unavailable: `livewiki/rerun-clean-v15.md` has not been generated yet.

### [Qualitative audit script for clean v16 artifact](rerun-clean-v16.md)

Module ID: `rerun-clean-v16`

- **Run** `node _qualitative-audit.mjs <artifactRoot>` to re-evaluate the artifact without invoking the paid pipeline.
- **Inspect** `metrics/qualitative-audit.json` to see the per-check pass/fail status and any failed pages.
- **Diagnose** a failing check by reading the `failedPageChecks`, `missingMmdLinks`, `duplicateDiagramDeclarations`, `commandsContradiction`, or `truncatedEndings` arrays.
- **Extend** the audit by adding new checks next to the existing ones in this single-file script.

### Rerun clean v17 module

Module ID: `rerun-clean-v17`

Page unavailable: `livewiki/rerun-clean-v17.md` has not been generated yet.

### [Static qualitative audit for the clean v8 artifact](rerun-clean-v8.md)

Module ID: `rerun-clean-v8`

- **Run** the audit with `node _qualitative-audit.mjs <artifactRoot>` to produce a metrics report over a previously generated livewiki tree.
- **Inspect** how the script enumerates module pages, masks manual/code regions, and detects unclosed Markdown before deciding whether a regression from clean v7 is still present.
- **Diagnose** why a page check fails by reading what `scanModulePage` records for frontmatter coverage, empty sections, visible sentinels, or `TODO`/`TBD` prose.
- **Compare** diagram declarations and `commands.md` claims against the source so you can spot drift between the documentation and the implementation.

### Rerun clean v9 module

Module ID: `rerun-clean-v9`

Page unavailable: `livewiki/rerun-clean-v9.md` has not been generated yet.

### [T0 offline module inventory script](scripts.md)

Module ID: `scripts`

- **Run** the script to regenerate `docs/benchmarks/2026-07-10-minimax-m3/offline-inventory-t0/modules.json` after a `@livewiki/core` build.
- **Audit** the partition/unique/caps invariants that the planner must satisfy against `plan.filePaths`.
- **Inspect** the two helper functions (`copyWorkingTree`/`walk`, `importDist`, `tallyExtensions`) when changing the inventory methodology.
- **Compare** extension tallies between the symbol-bearing `plan.filePaths` inventory and the raw active `files` table.
