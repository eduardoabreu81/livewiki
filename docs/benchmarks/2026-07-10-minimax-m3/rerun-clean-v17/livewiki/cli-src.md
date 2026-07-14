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

## cli.ts — program construction and entry point

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#run packages/cli/src/cli.ts#resolveRepoRoot -->

`createProgram` builds a `commander` `Command` named `livewiki`, sets its description, attaches the version read from the CLI's `package.json`, and declares two global flags (`--json` for parseable output, `--repo <path>` defaulting to cwd). It then registers every subcommand defined by the spec (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`) and returns the assembled program.

`readVersion` synchronously loads `../../package.json` relative to the module URL and returns its `version` field, falling back to `"0.0.0"` if the file is missing or unparseable.

`run` is the async entry point: it calls `createProgram` and forwards `argv` through `program.parseAsync`.

`resolveRepoRoot` resolves the `--repo` option against `process.cwd()`, defaulting to `"."` when the option is omitted.

## output.ts — stdout emission helpers

<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`emitHuman` writes a plain-text string to stdout, appending a single trailing newline if the input does not already end with one.

`emitJson` writes a single-line `JSON.stringify`'d payload to stdout, always followed by a newline (safe for line-by-line parsers).

`emit` is the single dispatch helper: when the first argument (`json`) is true it serializes `data` via `emitJson`; otherwise it writes the `human` string via `emitHuman`. Callers must pass exactly one of `data` / `human`.

## cli-e2e.test.ts — single-process E2E harness

<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki -->

`cliBin` resolves the compiled CLI entry point (`packages/cli/dist/index.js`) relative to the current working directory.

`runCli` invokes that binary via `spawnSync` with `encoding: "utf8"` and returns a `CliRun` object holding `status`, `stdout`, and `stderr`. Each test runs the real CLI against a temporary isolated repo.

`statusDebt` is a helper that runs `livewiki --json status` and returns the aggregated `{ changed, moved, deleted }` totals from `debt.byEvent`. It asserts the command exited 0 and that the response `ok` flag is true. It is used to validate dedup behavior (e.g. that three sequential `index` runs after a delete leave exactly one open `deleted` debt).

`writeCode` writes a relative file path under the temp repo, creating parent directories as needed.

`writeWiki` does the same for files under the `livewiki/` wiki tree (frontmatter + sections).

## cli-batch-e2e.test.ts — init --batch against an in-process stub

<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

`startStubServer` brings up an in-process `node:http` server on `127.0.0.1` bound to an ephemeral port. It accepts either an Anthropic-shaped body (`{ system, messages: [...] }`) or an OpenAI-shaped body (`{ messages: [...] }`), normalizes both into `{ system, user }`, dispatches the active handler, and returns `{ url, close, setHandler, callCount }`. No external network is used.

`closedKeysFromPrompt` parses the stage-4 / repair user prompt line by line, collecting every entry that matches `^- (\S+#\S+)$` into a list of anchor keys. If none are found it returns a single `${fallbackModuleId}.ts#placeholder` key.

`defaultHandler` synthesizes a documentation page for whatever module id appears in the prompt: it extracts the closed keys via `closedKeysFromPrompt`, emits a Markdown frontmatter (`title`, `owner: generated`, `anchors:`), and returns a Claude-shaped stub response (`content: [{type:"text", text}], usage, model`). It also accepts `{ failNTimes }` to simulate consecutive 500 responses for circuit-breaker scenarios.

`runCli` spawns the compiled CLI under `process.execPath` with merged `env`, capturing `stdout`/`stderr` asynchronously and resolving once the child closes.

`writeCode` writes a relative file (with intermediate `mkdir -p`) under the per-test temp repo.

`writeConfig` writes `.livewiki/config.json` with `{ provider, model, baseUrl }` for the stub LLM endpoint.

## cli-batch-e2e-subdirs.test.ts — subdirectories + NodeNext + openai-compat

<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

This file is the Fase 3 rev2 reviewer scenario: modules live in subdirectories (`src/auth/`, `src/billing/`, `src/utils/`) with NodeNext cross-imports (`../utils/crypto.js` resolving to `crypto.ts`), and the config targets an `openai-compat` provider with the API key only in env. It exercises regressions H–M that the flat `cli-batch-e2e.test.ts` fixture does not cover.

`startStubServer` mirrors the previous test's stub but additionally exposes `received(): Array<{ system; user }>` so tests can introspect parsed request bodies for fine-grained assertions.

`closedKeysFromPrompt` and `defaultHandler` follow the same shape as the flat-fixture file; `defaultHandler` here returns an OpenAI-compat response (`choices: [{ message: { role, content } }], usage, model`).

`isStage2RefinePrompt` distinguishes the stage-2 (refine-modules) prompt from the stage-4 prompt by checking for the unique substring `"Heuristic module grouping"`, avoiding the prior regex bug where `.` failed to match across newlines.

`makeRefineHandler` closes over a `refinedModules` array and returns a handler that: when the prompt matches `isStage2RefinePrompt`, replies with a JSON `{ modules: refinedModules }` payload; otherwise delegates to `defaultHandler`.

`runCli` is identical in shape to the other suite's runner.

`writeCode` writes TypeScript fixtures (including cross-importing files) under the per-test temp repo.

`writeOpenAiConfig` writes `.livewiki/config.json` with `provider: "openai-compat"`, the supplied `model`, the stub `baseUrl`, and pricing metadata (`inputUsdPerMtok: 3.0`, `outputUsdPerMtok: 15.0`).