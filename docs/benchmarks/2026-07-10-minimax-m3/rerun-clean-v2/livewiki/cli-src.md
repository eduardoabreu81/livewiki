---
title: cli-src
owner: generated
anchors:
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig
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

Reference documentation for the CLI source and its end-to-end test suites. The module contains the production CLI entry points, output helpers, and three Vitest suites that exercise the compiled `dist/index.js` binary against a temporary repository using an in-process HTTP stub for the LLM provider.

## Batch E2E (subdirectories + NodeNext + openai-compat)

<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

Fase 3 rev2 suite covering findings H–M from the empirical reviewer. Exercises a fixture with modules in subdirectories (`src/auth/`, `src/billing/`, `src/utils/`), cross-module NodeNext imports (`../utils/crypto.js` → `crypto.ts`), and an openai-compat config pointed at the local stub. API key is supplied only via `OPENAI_API_KEY` env var; no real network call is made.

- `startStubServer` — boots a Node `http` server on `127.0.0.1` with an ephemeral port. Returns `{ url, close, setHandler, callCount, received }`. Accepts both Anthropic-shape (`{ system, messages }`) and OpenAI-shape (`{ messages: [{role:system|user}] }`) request bodies; normalizes them into `{ system, user }` before dispatching to the configured handler.
- `defaultHandler` — produces a valid Markdown doc frontmatter block for any `# Module: <id>` prompt. Returns OpenAI-compat-shaped response with `choices[0].message.content` plus `usage` and `model` fields.
- `isStage2RefinePrompt` — returns `true` when the user prompt contains the marker `Heuristic module grouping`, which uniquely identifies the stage 2 `buildStage2RefinePrompt` output. Used to avoid the prior bug where a `refine.*modules` regex failed because `.` did not match newlines.
- `makeRefineHandler` — factory that returns a handler which answers stage 2 refine prompts with `{ modules: refinedModules }` and falls back to `defaultHandler` for other prompts.
- `runCli` — spawns `process.execPath dist/index.js <args>` with merged env, capturing stdout/stderr and the exit code into a `CliRun`.
- `writeCode` — writes a source file under a per-test `repoRoot` (mkdtemp), creating parent directories as needed.
- `writeOpenAiConfig` — writes `.livewiki/config.json` with `{ provider: "openai-compat", model, baseUrl, pricing }`.

## Batch E2E (Fase 3 — pipeline init --batch)

<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

Fase 3 suite covering the full `init --batch` pipeline against a stub Anthropic-compatible server. Also covers resume, `--only`, circuit breaker, exit codes (findings O/P/Q), plan-only, and verify-clean-after-batch flows.

- `startStubServer` — same pattern as the subdirs suite but without `received` log capture. Normalizes both Anthropic and OpenAI request shapes.
- `defaultHandler` — generates Markdown for any `# Module: <id>` prompt and returns Anthropic-shape responses with `content[].type: "text"`. Accepts an `{ failNTimes }` option for circuit-breaker tests.
- `runCli` — same shape as the subdirs suite; returns `Promise<{ status, stdout, stderr }>`.
- `writeCode` — same helper as the subdirs suite.
- `writeConfig` — writes `.livewiki/config.json` with `{ provider, model, baseUrl }` (no pricing defaults).

## CLI E2E (integration, real binary)

<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki -->

Integration suite that runs the **compiled** `dist/index.js` via `spawnSync`. Mandatory coverage for findings A–G of the Fase 2 review — calling `runLedger` directly bypasses soft-delete behavior that `livewiki index` applies on the update path.

- `cliBin` — resolves the compiled CLI binary as `dist/index.js` relative to `process.cwd()`.
- `runCli` — synchronous wrapper around `spawnSync` returning `{ status, stdout, stderr }`. Used because exit code semantics under `verify`/`index` are part of the assertions.
- `statusDebt` — runs `livewiki --json status`, asserts `ok: true`, and returns `debt.byEvent` (the aggregated `{ changed, moved, deleted }` totals across all runs). Validates dedup of repeated debt (e.g. finding B: 3× `index` after delete yields `deleted: 1`, not 3).
- `writeCode` — writes a source file under `repoRoot`.
- `writeWiki` — writes a `livewiki/`-tree file (used to seed anchor-bearing markdown before `index`).

## CLI production entry points

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

Production CLI wiring.

- `createProgram` — builds and returns the Commander `Command` instance with all subcommands wired.
- `readVersion` — reads the package version string.
- `resolveRepoRoot` — resolves the effective repository root from an optional `--repo` flag.
- `run` — async entry point that parses `argv` and dispatches to the configured command.

## Output helpers

<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

Output dispatch used by commands.

- `emit` — top-level dispatcher that chooses between human and JSON output based on the global `--json` flag.
- `emitHuman` — writes a human-formatted line to stdout.
- `emitJson` — writes a JSON-serialized payload to stdout.

TODO: detail for symbols `packages/cli/src/output.ts#emit` and `packages/cli/src/cli.ts#createProgram` — exact internal dispatch and option flags are not fully visible from the truncated source.