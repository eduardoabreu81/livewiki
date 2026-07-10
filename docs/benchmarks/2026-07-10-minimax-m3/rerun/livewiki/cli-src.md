---
title: cli-src
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
  - packages/cli/src/cli-e2e.test.ts#cliBin
  - packages/cli/src/cli-e2e.test.ts#runCli
  - packages/cli/src/cli-e2e.test.ts#statusDebt
  - packages/cli/src/cli-e2e.test.ts#writeCode
  - packages/cli/src/cli-e2e.test.ts#writeWiki
  - packages/cli/src/cli-batch-e2e.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e.test.ts#runCli
  - packages/cli/src/cli-batch-e2e.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e.test.ts#writeConfig
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig
---

# cli-src

Reference for `packages/cli/src` — the CLI entrypoint, output formatters, and three E2E test suites that exercise the binary against an isolated temp repo.

## CLI entrypoint and version
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

`cli.ts` is the runtime module imported by `dist/index.js`.

- `createProgram` builds the commander `Command` instance with all subcommands (`init`, `index`, `verify`, `batch`, `status`).
- `readVersion` resolves the package version surfaced by `--version`.
- `resolveRepoRoot` normalizes the `--repo <path>` option into an absolute repo root, defaulting to `process.cwd()` when omitted.
- `run` is the async entrypoint taking `argv: readonly string[]`; it parses flags, dispatches to the selected subcommand, and propagates batch exit codes (0 completed, 1 completed_with_failures, 2 aborted) unless `--json` is set, in which case the JSON report is emitted and the process exits 0.

## Output formatting
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`output.ts` centralises stdout formatting so subcommands do not duplicate `--json` handling.

- `emit` is the dispatcher; it picks `emitJson` when `--json` is present, otherwise `emitHuman`.
- `emitHuman` writes a plain-text payload terminated by a newline.
- `emitJson` serialises the payload with `JSON.stringify` (no trailing newline manipulation) so consumers can pipe the output safely.

## CLI E2E harness (`cli-e2e.test.ts`)
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki -->

Synchronous E2E suite that exercises the real compiled binary against a fresh `mkdtemp` repo.

- `cliBin` resolves `packages/cli/dist/index.js` relative to `process.cwd()`.
- `runCli` wraps `spawnSync(process.execPath, [cliBin(), ...args])` and returns `{ status, stdout, stderr }`.
- `statusDebt` runs `livewiki status --json` and returns `debt.byEvent` totals (`changed`, `moved`, `deleted`); used to assert dedup across multiple `index` invocations.
- `writeCode` writes source files inside the temp repo (creates parent dirs).
- `writeWiki` writes `livewiki/*.md` files inside the temp repo (creates parent dirs).

Scenarios covered: edit-an-anchored-function (1 changed), move-with-content-hash-match (moved + rewrite), repeated delete (dedup to 1 deleted), phantom anchor (verify fails with broken_anchor), move-rewrite on plain anchors (Fix G — markdown updated, verify clean), and move inside `lw:manual` block (Fix G + rule #6 — markdown untouched, assignee=human).

## Batch E2E with stub Anthropic (`cli-batch-e2e.test.ts`)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

Async E2E suite that mocks the Anthropic API with an in-process HTTP server and runs the full `init --batch` pipeline.

- `startStubServer` opens an `http.Server` on `127.0.0.1:<random>`, normalises both Anthropic-shape (`{ system, messages: [...] }`) and OpenAI-shape requests, and exposes `setHandler`, `callCount`, and `close`.
- `defaultHandler` matches `# Module: <id>` and the first `- path#symbol` key from the user prompt, then returns a structurally-valid Markdown document with `usage: { input_tokens, output_tokens }`; supports `failNTimes` to simulate transient failures.
- `runCli` is an async wrapper around `spawn(process.execPath, [dist/index.js, ...args])` that returns `{ status, stdout, stderr }`.
- `writeCode` writes source files inside the per-test temp repo.
- `writeConfig` writes `.livewiki/config.json` with `{ provider, model, baseUrl }`.

Scenarios: full pipeline produces quickstart/diagrams/manifest/pages/status (Fix P — overview.md is the target of quickstart links), `--only` re-runs a single task with accumulating usage, circuit breaker aborts after 3 consecutive failures, exit-code matrix (Fix O: aborted=2, completed_with_failures=1, completed=0, `--json` always 0), overview anchor integrity, idempotency (snapshot hash stable across re-runs), and Fix Q (verify must be 100% clean after a complete batch).

## Batch E2E with subdirectories and OpenAI-compat (`cli-batch-e2e-subdirs.test.ts`)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

Async E2E suite focused on findings H–M from the empirical reviewer: nested module directories, NodeNext cross-directory imports, and the openai-compat provider path. Zero real LLM calls.

- `startStubServer` mirrors the Anthropic-suite version and additionally captures every received request body in `received()` for fine-grained assertions.
- `defaultHandler` produces a structurally-valid Markdown page, embedding `usage: { prompt_tokens, completion_tokens }`.
- `isStage2RefinePrompt` detects the stage-2 refine prompt via the unique string `Heuristic module grouping` (more reliable than the previous regex, which failed on `.` not matching newlines).
- `makeRefineHandler` returns a handler that responds to stage-2 with the supplied `refinedModules` JSON and delegates everything else to `defaultHandler`.
- `runCli` is the async spawn wrapper identical to the Anthropic suite.
- `writeCode` writes nested source files (`src/auth/login.ts`, `src/utils/crypto.ts`, …) inside the temp repo.
- `writeOpenAiConfig` writes `.livewiki/config.json` with `provider: "openai-compat"`, `model`, `baseUrl`, and a `pricing` block.

Scenarios (named after reviewer findings): H — `init --batch` over a subdirectory tree generates all pages (not zero); I — stage-2 returning `{modules: []}` is rejected (`refine_rejected_empty`) and the heuristic grouping wins; J — stage-2 checkpoint is valid JSON and the status report exposes aggregated `inputTokens`/`outputTokens > 0`; K — NodeNext imports (`../utils/crypto.js`) resolve to the matching `.ts` and emit module edges; L — missing LLM config produces `exit 1` with a clear `Cannot run LLM batch` message (no libuv crash); M — `filesWritten` does not list the manifest when `writeManifestIfChanged` returns false (byte-identical manifest after a no-op second `init`).
