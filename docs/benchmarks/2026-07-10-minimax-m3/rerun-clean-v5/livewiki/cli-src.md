---
title: cli-src
owner: generated
anchors:
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig
  - packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt
  - packages/cli/src/cli-batch-e2e.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e.test.ts#runCli
  - packages/cli/src/cli-batch-e2e.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e.test.ts#writeConfig
  - packages/cli/src/cli-e2e.test.ts#cliBin
  - packages/cli/src/cli-e2e.test.ts#runCli
  - packages/cli/src/cli-e2e.test.ts#statusDebt
  - packages/cli/src/cli-e2e.test.ts#writeCode
  - packages/cli/src/cli-e2e.test.ts#writeWiki
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
---

# cli-src

Source module reference for `packages/cli/src`. This page documents the CLI entry point, the output formatting helpers, and the end-to-end test suites that exercise the `init --batch` pipeline.

## packages/cli/src/cli.ts

Program wiring and entry point for the `livewiki` binary. Uses `commander` to register all subcommands declared in SPEC §"CLI commands", then resolves the working repo from `--repo`.

### createProgram
<!-- lw:anchors packages/cli/src/cli.ts#createProgram -->

Builds the root `Command` instance, sets `--json` and `--repo` as global flags, and registers `init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, and `pointer` subcommands. Called from `run` and from tests that introspect the help/usage surface.

### readVersion
<!-- lw:anchors packages/cli/src/cli.ts#readVersion -->

Reads `version` from `packages/cli/package.json` synchronously, falling back to `"0.0.0"` on parse or read failure. Synchronous is safe here because the file is static at build time and the calling `run` is already async.

### run
<!-- lw:anchors packages/cli/src/cli.ts#run -->

Async entry point: calls `createProgram()` and forwards `argv` to `parseAsync`. Top-level `await` target for the compiled `dist/index.js` shim and for tests that exercise the full program lifecycle.

### resolveRepoRoot
<!-- lw:anchors packages/cli/src/cli.ts#resolveRepoRoot -->

Resolves `--repo` (or the default `"."`) against `process.cwd()` to an absolute path. Used by subcommands to build the `CommandContext` for the target repository.

## packages/cli/src/output.ts

Single funnel for everything the CLI prints. SPEC §"Comandos CLI" requires both human-readable and `--json`-parseable output; this module owns that contract.

### emit
<!-- lw:anchors packages/cli/src/output.ts#emit -->

Top-level dispatcher. When `json` is true, serializes `data` as JSON on stdout; otherwise writes `human` text. Callers must pass exactly one of the two payloads — never both.

### emitHuman
<!-- lw:anchors packages/cli/src/output.ts#emitHuman -->

Writes a multi-line text payload to stdout, guaranteeing a trailing newline. Used by every command's non-JSON branch.

### emitJson
<!-- lw:anchors packages/cli/src/output.ts#emitJson -->

Writes a JSON-serialized payload followed by exactly one newline, so line-oriented consumers (`JSON.parse` per line) stay safe.

## packages/cli/src/cli-e2e.test.ts

End-to-end suite that spawns the compiled `livewiki` binary against a temporary repo. These tests are mandatory companions to the Phase 2 review fixes (achados A–G) because the unit-level `runLedger` path bypasses the soft-delete that `livewiki index` applies on update.

### cliBin
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin -->

Returns the absolute path of the compiled `dist/index.js` relative to the current working directory. Test processes spawn `node` with this path as the entry script.

### runCli
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#runCli -->

Synchronous wrapper around `child_process.spawnSync` that runs `node <cliBin()> <args>` and returns `{ status, stdout, stderr }`. Used to assert both exit codes and JSON stdout shape.

### statusDebt
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#statusDebt -->

Helper that runs `livewiki status --json` and returns the aggregated `debt.byEvent` triple (`changed`, `moved`, `deleted`). Validates dedup invariants across multiple `index` runs.

### writeCode
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#writeCode -->

Creates an intermediate directory and writes a code file at `<repoRoot>/<rel>`. Mirrors the helper used by the other e2e suites.

### writeWiki
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#writeWiki -->

Same as `writeCode` but conventionally used for `livewiki/*.md` artifacts — including fixtures with broken anchor entries that drive the verify-path scenarios.

## packages/cli/src/cli-batch-e2e.test.ts

Phase 3 E2E for the `init --batch` pipeline. Spins up an in-process HTTP stub that mimics the Anthropic Messages API shape, then validates the full artifact set (quickstart, Mermaid diagrams, manifest, pages, status report) plus key-leak protection.

### startStubServer
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer -->

Boots a `node:http` server on `127.0.0.1` with a free port. Exposes `setHandler`, `callCount`, and a `close` promise so each test can swap response logic and tear down deterministically.

### closedKeysFromPrompt
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt -->

Parses the closed-list key block out of the stage-4 user prompt using a `- key` regex. Falls back to a single placeholder anchor when the prompt carries no list.

### defaultHandler
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#defaultHandler -->

Generates a syntactically valid Markdown response (frontmatter, title, anchors, body) for any module referenced in the user prompt. Optionally fails the first N requests with HTTP 500 to exercise the circuit breaker path.

### runCli
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#runCli -->

Async wrapper that spawns the CLI with merged environment variables, accumulating stdout/stderr chunks and resolving with `{ status, stdout, stderr }` on process close.

### writeCode
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#writeCode -->

Materializes a code file inside the per-test temp `repoRoot`, creating intermediate directories as needed.

### writeConfig
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

Writes `.livewiki/config.json` with the supplied provider, model, and `baseUrl` (the stub server URL). Used to redirect `init --batch` away from real LLM endpoints.

## packages/cli/src/cli-batch-e2e-subdirs.test.ts

Phase 3 revision 2 — same harness as the flat-fixture suite, but the repo lives under nested subdirectories (`src/auth/`, `src/billing/`, `src/utils/`) with NodeNext-style cross-directory imports. Targets reviewer findings H–M that the flat fixture cannot expose.

### startStubServer
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer -->

Identical to the flat-fixture variant, plus a `received()` accessor that snapshots every parsed request body — useful for fine-grained assertions on stage-2 vs stage-4 prompt content.

### closedKeysFromPrompt
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt -->

Parses `- key` lines from the user prompt into a closed list. Same fallback behavior as the sibling file; isolated to avoid cross-suite coupling.

### defaultHandler
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler -->

Builds a stage-4 Markdown response for any module id embedded in the user prompt. Emits anchors derived from `closedKeysFromPrompt` and OpenAI-shape usage counters (`prompt_tokens` / `completion_tokens`).

### isStage2RefinePrompt
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt -->

Detects the stage-2 refine-modules prompt by checking for the unique marker `"Heuristic module grouping"`. Replaces an earlier regex (`refine.*modules`) that misfired across newlines.

### makeRefineHandler
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler -->

Factory that returns a request handler responding to stage-2 prompts with the caller-supplied refined module list (as `{"modules":[…]}`) and delegating all other prompts to `defaultHandler`. Drives the openai-compat test path.

### runCli
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli -->

Async spawner identical to the flat-fixture variant: merges `process.env` with the per-call override, captures stdout/stderr, resolves on `close`.

### writeCode
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode -->

Per-test temp-repo writer, with recursive `mkdir` for nested paths like `src/auth/login.ts`.

### writeOpenAiConfig
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

Writes `.livewiki/config.json` configured for the `openai-compat` provider, including stub `baseUrl` and pricing fields. Combined with the `OPENAI_API_KEY` env var it lets the suite exercise the openai-compat code path without real network calls.