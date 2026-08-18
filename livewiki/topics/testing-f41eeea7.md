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

This page explains how the CLI, commands, core, LLM, and MCP modules coordinate to deliver a testable and verified documentation pipeline, from source parsing to human or machine-readable output.

## Purpose

<!-- lw:anchors packages/core/src/frontmatter.ts#parseFrontmatter -->

The `livewiki` project generates living repository documentation anchored to code. Its testing strategy spans five modules — `cli-src` (CLI entry point), `commands` (subcommand adapters), `core-src` (core logic), `llm` (external provider seam), and `mcp-src` (Model Context Protocol server) — each with distinct test responsibilities.

The core module owns the parsing contract that all higher layers depend on. The frontmatter parser, `packages/core/src/frontmatter.ts#parseFrontmatter`, is the gateway for every documentation page: it reads the YAML block at the top of a Markdown file, extracts the frontmatter fields, and returns the body separately. It normalizes line endings to LF before parsing so that CRLF checkouts do not change the interpreted structure. When a page does not begin with `---`, the parser returns `frontmatter: null` rather than failing — pages without frontmatter are permitted. When the opening delimiter exists but the closing delimiter is missing, it throws a `FrontmatterParseError`. This function establishes the boundary between what counts as a page header and what counts as content, so the rest of the pipeline can trust the page shape.

The same core module provides the building blocks that commands use to produce verifiable output: content hashing, Markdown masking, path normalization, and role classification (all covered in the Behavioral contract section). Tests across the `core-src` module exercise these primitives directly — for example, the anchors test suite validates that `slugify` lowercases, removes accents, collapses spaces, trims whitespace, and preserves digits. The artifact test suite reproduces real baseline findings: responses that start with a `<think>` block, responses with a code fence copied from the prompt, and responses missing frontmatter or carrying the wrong owner. The batch-context suite verifies fair source truncation so that large early files do not starve later files in the context budget.

## When to use this page

<!-- lw:anchors packages/core/src/db.ts#openIndex -->

Read this page when you need to understand how the testing contract flows from the core primitives through the CLI commands and into the LLM and MCP layers. Use it as a map of where each verification concern lives: parsing and hashing in `core-src`, command registration and output shaping in `cli-src` and `commands`, provider behavior in `llm`, and the server surface in `mcp-src`.

The state layer that commands depend on is the index database. The `packages/core/src/db.ts#openIndex` function opens (or creates) the SQLite index at a given path and runs idempotent migrations. It sets WAL journal mode, enables foreign keys, and uses NORMAL synchronous mode. On first open, it writes the current schema version into the `meta` table. When the stored version differs from the current one, it applies pending migrations — both string SQL and JavaScript functions — before updating the version stamp. After the migration step it creates the indexes that span columns a legacy file only gains during migration — `idx_batch_tasks_claim` over `lease_expires_at` is created there rather than in `SCHEMA_SQL`, which runs first and would otherwise reference a column a pre-v10 database does not have. The function deliberately avoids recursive directory creation: the caller must have already created the `.livewiki/` directory, and `openIndex` fails closed if that directory disappears between setup and opening. The `db.test.ts` suite verifies that the database is created with the expected tables (`files`, `symbols`, `meta`, `anchors`) and that the schema version is set on first open.

Use the flow pages for the end-to-end paths: `cli-src-to-llm` covers the journey from a user invoking the `livewiki` command to the moment an external LLM provider receives a validated request, and `mcp-src-to-llm` covers how the MCP server exposes documentation tooling over standard I/O and keeps its search index fresh.

## Behavioral contract

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#normalizeRepoPath packages/cli/src/commands/batch.ts#setExitCode packages/cli/src/commands/index-cmd.ts#formatLedgerHuman packages/cli/src/commands/install.ts#formatDetectionHuman packages/cli/src/commands/install.ts#formatResultsHuman packages/cli/src/commands/view.ts#openBrowser packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

The behavioral contract spans core primitives, CLI output handling, and the exit-code discipline that makes the pipeline scriptable.

**Core primitives.** The `packages/core/src/hashes.ts#sha256` function computes a hex-encoded SHA-256 digest over its input. The content hashing pipeline applies an EOL normalization step before hashing: CRLF sequences become LF, so a silent `core.autocrlf` checkout conversion never changes a file's fingerprint. Lone `\r` characters are deliberately left untouched — they are not produced by git and treating them as line breaks would change the semantics of string literals. This prevents phantom debt when the same file is checked out with different line endings across platforms.

The `packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength` function masks fenced code blocks and inline-code spans without changing the source length or any line terminator. Characters inside code become spaces, so every index in the masked view maps to the same index in the original text. This preserves offsets for downstream tooling that needs to correlate masked positions back to the real source.

Path handling is canonicalized by `packages/core/src/modules.ts#normalizeRepoPath`, which converts backslashes to forward slashes and strips a leading `./`. This gives every command a uniform repo-relative path shape. The `packages/core/src/modules.ts#classifyModuleRole` function assigns a role to each module folder — `product`, `docs`, `tooling`, `fixture`, or `test` — by counting path-role classifications and then applying a fixed tie-break priority in that order. A folder mixing product code with the same number of test files is classified as `product`; the priority list, never input order, decides the outcome.

**Output discipline.** The output layer forces a choice between machine-readable and human-readable formats. The dispatch helper `packages/cli/src/output.ts#emit` takes a `json` flag and either serializes the data or writes the human string — never both. The human writer `packages/cli/src/output.ts#emitHuman` writes the text to stdout, appending a newline only if one is not already present. The JSON writer `packages/cli/src/output.ts#emitJson` writes `JSON.stringify(data)` followed by a newline. Commands like `index` respect the `--quiet` flag to suppress human output without producing JSON, and `--json` produces structured output.

Each subcommand formatter produces deterministic human text. The ledger formatter `packages/cli/src/commands/index-cmd.ts#formatLedgerHuman` reports processed/skipped pages, anchor upserts, and per-event debt counts (changed/moved/deleted). The install detection formatter `packages/cli/src/commands/install.ts#formatDetectionHuman` lists each agent and whether it was detected, with per-agent evidence lines. The install results formatter `packages/cli/src/commands/install.ts#formatResultsHuman` reports per-action outcomes (`written`, `FAILED`, `skip`, `refuse`, `requires-opt-in`) and prints a summary line when nothing was written. The view command's `packages/cli/src/commands/view.ts#openBrowser` is best-effort: it spawns a platform-specific opener with `shell: false`, detaches it, and returns `false` on failure without failing the command.

**Exit codes.** The exit-code function `packages/cli/src/commands/batch.ts#setExitCode` maps run status to process exit codes: `completed` sets 0, `completed_with_failures` sets 1, `aborted` sets 2. When `--json` is active, it returns early and leaves the exit code at 0 — structured output is always considered successful regardless of the run outcome. The `batch-format.test.ts` suite verifies that the human formatter includes an incomplete-usage note when usage data is incomplete, and omits it when complete.

**CLI wiring.** Version resolution `packages/cli/src/cli.ts#readVersion` reads synchronously from the package's `package.json` via a relative URL — the built `dist/cli.js` sits at the same depth as `src/`, so the same relative path works in both layouts. A bad or missing file falls back to `"0.0.0"`. Repo resolution `packages/cli/src/cli.ts#resolveRepoRoot` resolves the `--repo` option against the current working directory, defaulting to `.`. Both serve the command context that every subcommand receives.

## Failure and recovery

<!-- lw:anchors packages/cli/src/commands/batch.ts#formatListHuman -->

The batch listing formatter `packages/cli/src/commands/batch.ts#formatListHuman` handles the empty-state case explicitly: when no runs exist, it prints `(none)` under the `Batch runs:` header. When runs exist, it renders each run's id, status (padded to 25 characters), start time, and finish time (or `(running)` when not finished). This gives the user a stable view of run state even when the history is empty.

Failure recovery in the broader pipeline relies on the contract pieces described above. When the LLM returns malformed output, the artifact normalization layer in `core-src` strips a single leading `<think>` block, removes a surrounding code fence, and validates the page structure; the artifact test suite reproduces the baseline failure modes so regressions are caught. When a migration in `openIndex` fails, the database is left in its prior state because migrations are applied in order and the version is only updated after all migrations succeed.

The CLI entry point `packages/cli/src/index.ts` wraps the whole program in a catch-all: if any unhandled error escapes a subcommand, it writes `livewiki: fatal error — <message>` to stderr and sets `process.exitCode = 1`. Commander handles usage errors (such as `--help` on a missing subcommand) without reaching this handler.

## Change map

<!-- lw:anchors packages/cli/src/cli.ts#createProgram -->

The program factory `packages/cli/src/cli.ts#createProgram` assembles the entire CLI surface: it sets the program name to `livewiki`, attaches the version from `readVersion`, registers the global `--json` and `--repo` options, and registers thirteen subcommands (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`, `install`, `config`, `baseline`). It also defines the bare-invocation behavior: when no subcommand is given, it checks configuration state, and either runs an interactive config wizard, prints a one-line hint, or shows help. The `cli.test.ts` suite pins the command list to those thirteen names, verifies the program name, checks that the global flags are registered, and validates that `--help` lists all commands.

This factory is the single source of truth for what the CLI exposes. Adding, removing, or renaming a command means editing `createProgram` and the corresponding test expectation. The smoke tests guard the phase-0 promise that all SPEC commands are registered, so an accidental removal fails the test even if the binary still runs.

## Related pages

- [CLI source module](../cli-src/index.md)
- [Commands module](../commands/index.md)
- [Core source module](../core-src/index.md)
- [LLM module](../llm/index.md)
- [MCP source module](../mcp-src/index.md)
- [CLI to LLM flow](../flows/cli-src-to-llm.md)
- [MCP source to LLM flow](../flows/mcp-src-to-llm.md)
- [CLI to LLM flow diagram](../diagrams/flow-cli-src-to-llm.mmd)
- [MCP source to LLM flow diagram](../diagrams/flow-mcp-src-to-llm.mmd)
- [Topics hub](index.md)