---
title: Testing
owner: generated
kind: topic
order: 0
intent: Explains how 5 related modules coordinate testing (Cargo.toml, Handler.java, Item.java, Main.java).
modules:
  - cli-src
  - commands
  - core-src
  - llm
  - mcp-src
flows:
  - cli-src-to-llm
  - mcp-src-to-llm
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/commands/batch.ts#formatListHuman
  - packages/cli/src/commands/batch.ts#setExitCode
  - packages/cli/src/commands/index-cmd.ts#formatLedgerHuman
  - packages/cli/src/commands/install.ts#formatDetectionHuman
  - packages/cli/src/commands/install.ts#formatResultsHuman
  - packages/cli/src/commands/view.ts#openBrowser
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
  - packages/core/src/db.ts#openIndex
  - packages/core/src/frontmatter.ts#parseFrontmatter
  - packages/core/src/hashes.ts#sha256
  - packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength
  - packages/core/src/modules.ts#classifyModuleRole
  - packages/core/src/modules.ts#normalizeRepoPath
updated: 2026-08-16
---

# Testing

This page explains how five related modules coordinate automated testing across the livewiki repository, from CLI command registration to core data-contract validation.

## Purpose

<!-- lw:anchors packages/core/src/frontmatter.ts#parseFrontmatter -->

The livewiki project is a living documentation engine: it indexes source code, generates wiki pages, and validates that those pages stay anchored to the code they document. Testing spans two package roots — `packages/cli` (the command-line interface) and `packages/core` (the engine's data and pipeline logic) — plus the `packages/mcp` package that exposes the same tooling over the Model Context Protocol. The frontmatter parser `packages/core/src/frontmatter.ts#parseFrontmatter` sits at the boundary between raw file content and structured metadata: it converts the leading `---`-delimited YAML block of a wiki page into a typed `Frontmatter` object, returning `frontmatter: null` when a page deliberately omits it, and throwing a parse error when an opening delimiter exists without a closing one. This parser underpins anchor extraction and page validation, making it a core contract that tests must exercise both for well-formed and malformed inputs.

## When to use this page

<!-- lw:anchors packages/core/src/db.ts#openIndex -->

Use this page when you need to understand how the testing layers of `cli-src`, `commands`, `core-src`, `llm`, and `mcp-src` coordinate — for example, when adding a new CLI command, changing a core data contract, or extending the MCP server surface. The database opener `packages/core/src/db.ts#openIndex` is a useful entry point: it opens (or creates) the SQLite index at `dbPath`, runs idempotent migrations, and records `schema_version` in the `meta` table. Test suites in `core-src` call this function to verify that fresh databases receive the current schema version, that all expected tables exist, and that pending migrations apply correctly. This function intentionally does not create its parent directory — the caller must ensure `.livewiki/` exists so that a missing directory fails closed rather than being silently recreated.

## Behavioral contract

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#normalizeRepoPath packages/cli/src/commands/batch.ts#setExitCode packages/cli/src/commands/index-cmd.ts#formatLedgerHuman packages/cli/src/commands/install.ts#formatDetectionHuman packages/cli/src/commands/install.ts#formatResultsHuman packages/cli/src/commands/view.ts#openBrowser packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

The behavioral contract for testing spans several layers:

**Core data contracts.** The hashing function `packages/core/src/hashes.ts#sha256` computes a SHA-256 digest for any string or `Uint8Array`, used for content fingerprints. The markdown masker `packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength` replaces characters inside fenced code blocks and inline code spans with spaces while preserving the original string length and line terminators — so a position in the masked view maps to the same position in the original text. Module classification `packages/core/src/modules.ts#classifyModuleRole` assigns a role (product, docs, tooling, fixture, test) to a module by counting path roles and resolving ties with a fixed priority list (product first, test last), never by input order. Path normalization `packages/core/src/modules.ts#normalizeRepoPath` converts backslashes to forward slashes and strips a leading `./` to produce canonical repo-relative paths.

**CLI output contracts.** The output helpers in `packages/cli/src/output.ts` define how commands communicate with callers. The `emit` dispatcher selects between `emitJson` and `emitHuman` based on the `json` flag, wiring structured or human-readable output through one path; `emitHuman` writes text to stdout, appending a newline only when missing; `emitJson` serializes a value with `JSON.stringify` followed by a newline. The CLI scaffolding `packages/cli/src/cli.ts#createProgram` registers thirteen subcommands (init, index, status, update, verify, serve, batch, export, view, pointer, install, config, baseline) plus global `--json` and `--repo` flags, and the version string comes from `readVersion`, which reads `@livewiki/cli`'s `package.json` synchronously and falls back to `"0.0.0"` when the file is unreadable or unparseable. Repo-root resolution `resolveRepoRoot` resolves the `--repo` option relative to the current working directory, defaulting to `.` when omitted — a relative-path-only resolution.

**Human formatters.** Several command modules expose human-readable formatters for tests. The `formatLedgerHuman` helper (from `index-cmd`) renders the indexing ledger summary — pages processed, anchors upserted, debt counts, and moved pairs. Install detection and results formatters (`formatDetectionHuman`, `formatResultsHuman`) produce per-agent detection evidence and per-action outcomes such as written, skipped, or refused. Exit-code assignment `setExitCode` maps batch statuses: `completed` → 0, `completed_with_failures` → 1, `aborted` → 2, with an early return that forces exit code 0 whenever `--json` is active — structured output is always treated as success. The browser opener `openBrowser` is best-effort: it spawns the platform-appropriate opener detached with `shell: false`, returns `true` on spawn, and returns `false` on any throw, never failing the command since the path is already printed.

## Failure and recovery

<!-- lw:anchors packages/cli/src/commands/batch.ts#formatListHuman -->

The batch-run formatter `packages/cli/src/commands/batch.ts#formatListHuman` reveals how the CLI handles empty and partial state. When no batch runs exist, it prints `(none)`; when runs exist, each row shows the run ID, padded status, and ISO timestamps for start and finish, with `(running)` for unfinished runs. Tests exercise this function for both empty and populated run lists, and the shared incomplete-usage note is appended to status output when token totals are flagged `usageIncomplete` — covering LLM outcomes such as `llm_timeout` where the model did not return complete usage data. Recovery paths in the broader batch flow include retry commands printed per failed task (e.g. `livewiki batch --only <target> <runId>`) and silent fallback when pre-dated checkpoints lack diagnostics.

## Change map

<!-- lw:anchors packages/cli/src/cli.ts#createProgram -->

The `createProgram` function in `packages/cli/src/cli.ts` is the scaffolding gate for CLI evolution: any added or removed subcommand changes the registration list asserted by the smoke tests in `packages/cli/src/cli.test.ts`, which expects exactly thirteen commands including the versioned baseline lifecycle. Tests also verify the program name is `livewiki` and that `--json` and `--repo` appear among the global options. When a new command is added, update `createProgram`, the command's registration module in `packages/cli/src/commands/`, and the test's expected command-name array. See [cli-src](../cli-src/index.md) for the CLI source-root details and [commands](../commands/index.md) for the subcommand wiring.

## Related pages

- [cli-src](../cli-src/index.md) — command-line package source root.
- [commands](../commands/index.md) — subcommand adapters and workflows.
- [core-src](../core-src/index.md) — core engine source root with data contracts.
- [llm](../llm/index.md) — LLM client interface and provider adapters.
- [mcp-src](../mcp-src/index.md) — MCP server source root.
- [cli-src-to-llm](../flows/cli-src-to-llm.md) — end-to-end CLI pipeline to LLM.
- [mcp-src-to-llm](../flows/mcp-src-to-llm.md) — MCP tool call to LLM path.
- [flow-cli-src-to-llm](../diagrams/flow-cli-src-to-llm.mmd) — pipeline flow diagram.
- [flow-mcp-src-to-llm](../diagrams/flow-mcp-src-to-llm.mmd) — MCP flow diagram.
- [Topics hub](index.md) — overview of all topic pages.