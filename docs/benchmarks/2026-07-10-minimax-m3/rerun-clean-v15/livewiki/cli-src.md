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

## cli.ts entry point

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#run packages/cli/src/cli.ts#resolveRepoRoot -->

The `cli.ts` module wires the Commander-based `livewiki` program. `readVersion` synchronously loads `../../package.json` via `import.meta.url` and parses the `version` field, falling back to `"0.0.0"` on any I/O or parse failure. `createProgram` constructs the root `Command`, sets the program name/description/version, declares the global `--json` and `--repo <path>` flags, and registers every subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`) so `--help` lists the full surface. `run` is the async entry point that builds a program via `createProgram` and forwards `argv` through `parseAsync`. `resolveRepoRoot` translates the `--repo` option into an absolute path anchored at `process.cwd()`, defaulting to `"."` when the option is omitted.

## output.ts formatters

<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

All CLI output funnels through `output.ts` so commands stay SPEC-compliant (parseable JSON via `--json`, plain text otherwise). `emitHuman` writes `text` to stdout and guarantees a trailing newline. `emitJson` writes `JSON.stringify(data)` plus a newline so consumers can parse line-by-line. `emit` is the convenience switch: when `json` is true it forwards `data` to `emitJson`; otherwise it forwards the pre-formatted `human` string to `emitHuman`. Callers pass exactly one of `data` or `human`.

## cli-batch-e2e.test.ts helpers

<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

`cli-batch-e2e.test.ts` exercises the full `init --batch` pipeline against an in-process HTTP stub for the Anthropic API, so no real LLM calls are made. `startStubServer` binds a Node `http.Server` on `127.0.0.1`, parses each request body, normalizes both Anthropic and OpenAI shapes into `{ system, user }`, and dispatches to a configurable handler; the returned `StubServer` exposes `url`, `close`, `setHandler`, and `callCount`. `closedKeysFromPrompt` scans the user prompt line-by-line for `- <key>` lines that match the closed-list regex and returns them, falling back to a placeholder keyed on the module id. `defaultHandler` synthesizes a Markdown document with valid frontmatter (title/owner/anchors), then returns the Anthropic-style `{ content: [{type:"text", text}], usage, model }` response; the optional `failNTimes` argument forces the next N calls to return 500 for circuit-breaker scenarios. `runCli` spawns `node dist/index.js` with merged env and resolves with `{ status, stdout, stderr }` once the child exits. `writeCode` creates parent directories and writes a source file under the per-test temp repo. `writeConfig` writes `.livewiki/config.json` with the requested `provider`, `model`, and `baseUrl`.

## cli-batch-e2e-subdirs.test.ts helpers

<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

`cli-batch-e2e-subdirs.test.ts` is the rev2 suite that targets findings H–M, covering repos with subdirectories, NodeNext cross-imports, and an openai-compat provider. Its `startStubServer` mirrors the suite above but additionally logs every parsed `{ system, user }` body via `received()` for fine-grained assertions. `closedKeysFromPrompt` and `defaultHandler` follow the same algorithm as the flat fixture but emit an OpenAI-shaped `choices[0].message.content` payload with `usage: { prompt_tokens, completion_tokens }`. `isStage2RefinePrompt` detects the stage-2 prompt by the substring `Heuristic module grouping`, avoiding the prior regex bug where `.` failed to cross newlines. `makeRefineHandler` returns a handler factory: if the request is a stage-2 prompt it replies with `{ modules: refinedModules }`; otherwise it falls through to `defaultHandler`. `runCli` and `writeCode` are identical in shape to the flat suite. `writeOpenAiConfig` writes `.livewiki/config.json` for the `openai-compat` provider, including the required `pricing.inputUsdPerMtok` and `pricing.outputUsdPerMtok` fields, plus the local stub `baseUrl`.

## cli-e2e.test.ts helpers

<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki packages/cli/src/cli-e2e.test.ts#statusDebt -->

`cli-e2e.test.ts` runs the real `dist/index.js` binary synchronously against an isolated temp repo, validating the integration paths that unit tests bypass (notably soft-delete during `livewiki index`). `cliBin` resolves the compiled entry point relative to `process.cwd()`. `runCli` uses `spawnSync` and returns `{ status, stdout, stderr }`, awaiting no I/O since the call is synchronous. `writeCode` writes source files under the temp repo, creating parent directories as needed. `writeWiki` does the same for markdown files under the temp repo. `statusDebt` is a test-local helper that invokes `livewiki --json --repo <tmp> status`, asserts a clean exit, and returns `debt.byEvent` (`{ changed, moved, deleted }`) so individual scenarios can assert on the aggregate totals after each `index` run.