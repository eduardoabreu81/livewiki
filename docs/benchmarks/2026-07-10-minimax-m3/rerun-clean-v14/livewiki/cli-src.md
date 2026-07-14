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

# packages/cli/src

Entry points and E2E scaffolding for the `@livewiki/cli` package. This module wires Commander to the livewiki subcommands and centralises stdout formatting, and the three `*.test.ts` files define the end-to-end fixtures used to drive the CLI binary against stub HTTP servers.

## cli.ts — program wiring

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

`createProgram` returns a configured `Command` named `livewiki` with `--json` and `--repo` global options and every subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`) registered via the individual `register*` modules. `run(argv)` builds the program and awaits `parseAsync`. `readVersion` synchronously loads `../../package.json` relative to `import.meta.url` and returns its `version` field, falling back to `"0.0.0"` on any error. `resolveRepoRoot(repoOpt)` resolves the `--repo` option against `process.cwd()`, defaulting to `"."`.

## output.ts — stdout formatting

<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`emitHuman(text)` writes `text` to stdout, appending a newline if the caller did not. `emitJson(data)` writes `JSON.stringify(data)` followed by a newline so the line can be parsed individually. `emit(json, data, human)` is the single helper used by every command: when `json` is true it dispatches to `emitJson` with `data`, otherwise it dispatches to `emitHuman` with `human`. Callers must pass exactly one of `data` / `human`.

## cli-e2e.test.ts — CLI binary integration tests

<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki -->

`cliBin()` returns the absolute path to `dist/index.js` relative to the current working directory, i.e. the compiled CLI binary the tests spawn. `runCli(args)` uses `spawnSync` to launch `node` against `cliBin()` with the supplied args and returns `{ status, stdout, stderr }` decoded as utf8. `writeCode(rel, content)` and `writeWiki(rel, content)` both create parent directories and write the file under the per-test temporary `repoRoot`. `statusDebt()` runs `livewiki --json --repo <root> status`, asserts `ok: true`, and returns the aggregate `{ changed, moved, deleted }` counts from `debt.byEvent`; the suite uses it to validate that ledger deductions do not accumulate across repeated `index` runs.

## cli-batch-e2e.test.ts — Phase 3 batch pipeline against stub Anthropic

<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

`startStubServer` opens an in-process `http.Server` on a random localhost port and returns a `StubServer` facade with `url`, `close`, `setHandler`, and `callCount`. The server tolerates both Anthropic (`{ system, messages }`) and OpenAI (`{ messages: [{role:"system",...},{role:"user",...}] }`) request shapes, normalising both into `{ system, user }` for the handler. `closedKeysFromPrompt(user, fallbackModuleId)` parses the user prompt line-by-line for entries matching `^- (\S+#\S+)$` and returns the matched keys, falling back to `${fallbackModuleId}.ts#placeholder` when nothing is found. `defaultHandler(req, opts?)` produces a Markdown page with a deterministic frontmatter whose `anchors:` list is exactly `closedKeysFromPrompt(req.user, ...)`, returning an Anthropic-shaped response with `usage.input_tokens` and `usage.output_tokens`. The optional `failNTimes` field makes the first N invocations return a 500 to exercise the circuit-breaker. `runCli(args, env?)` spawns the compiled `dist/index.js` and resolves with `{ status, stdout, stderr }` once the child closes. `writeCode` writes fixture source files inside `repoRoot`; `writeConfig(provider, model, baseUrl)` writes `.livewiki/config.json` so the CLI talks to the stub server.

## cli-batch-e2e-subdirs.test.ts — subdirectory + NodeNext + openai-compat scenario

<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

`startStubServer` here extends the basic stub with a `received()` accessor that returns the parsed `{ system, user }` log for fine-grained assertions. `closedKeysFromPrompt` and `defaultHandler` mirror the flat-fixture version but emit OpenAI-compat response shapes (`choices[0].message.content`, `usage.prompt_tokens` and `usage.completion_tokens`). `isStage2RefinePrompt(user)` returns `true` when the prompt contains the literal `"Heuristic module grouping"` — the unique header used by the stage 2 prompt that does not appear in the stage 4 (`# Module: <id>`) prompts, which avoids a prior regex bug where `.` failed to match newlines. `makeRefineHandler(refinedModules)` returns a handler that intercepts stage 2 prompts and replies with `JSON.stringify({ modules: refinedModules })`; any other prompt falls through to `defaultHandler`. `runCli`, `writeCode`, and `writeOpenAiConfig` mirror their flat counterparts, with `writeOpenAiConfig` additionally writing the `pricing` block (`inputUsdPerMtok`, `outputUsdPerMtok`) required for openai-compat cost reporting.