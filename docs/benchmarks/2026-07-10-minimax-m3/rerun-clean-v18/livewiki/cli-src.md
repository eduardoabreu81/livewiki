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

Source files backing the `livewiki` CLI: the Commander program wiring, the human/JSON output helper, and three end-to-end test suites that exercise the binary against a stub HTTP server.

## Program entry (`cli.ts`)

<!-- lw:anchors packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/cli.ts#resolveRepoRoot -->

`readVersion` synchronously reads `@livewiki/cli/package.json` (resolved relative to `import.meta.url`) and returns the `version` field, falling back to `"0.0.0"` on any read or parse error. `createProgram` returns a `Command` named `"livewiki"`, attaches the version, defines the global `--json` and `--repo <path>` flags, and registers every subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`). `run(argv)` builds the program and parses asynchronously. `resolveRepoRoot(repoOpt)` resolves `--repo` (or `"."`) against `process.cwd()` and returns an absolute path used to build the command context.

## Output formatting (`output.ts`)

<!-- lw:anchors packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson packages/cli/src/output.ts#emit -->

`emitHuman` writes text to stdout, appending a single trailing newline if the caller did not include one. `emitJson` writes `JSON.stringify(data)` followed by a newline so output is safe to consume line-by-line. `emit(json, data, human)` is the single dispatch helper: when `json` is true it routes to `emitJson(data)`, otherwise to `emitHuman(human)`. Callers pass exactly one of `data` / `human`; the helper never emits both.

## E2E helpers — `cli-e2e.test.ts`

<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki packages/cli/src/cli-e2e.test.ts#statusDebt -->

This suite runs the compiled `livewiki` binary (`dist/index.js`) against an isolated temporary repository and asserts the full `index` / `verify` flow, including the soft-delete path that the reviewer flagged as unit-test-invisible. `cliBin` resolves the binary path relative to `process.cwd()`. `runCli(args)` synchronously spawns `node` against the binary via `spawnSync` and returns `{ status, stdout, stderr }`. `writeCode(rel, content)` and `writeWiki(rel, content)` create parent directories under the temp repo and write the file. `statusDebt()` runs `status --json` and returns the `debt.byEvent` aggregate (`{ changed, moved, deleted }`), which is the totals-level view used to validate dedup across multiple `index` invocations.

## Batch E2E — Anthropic stub (`cli-batch-e2e.test.ts`)

<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

`startStubServer` boots a local Node `http` server on a random port, normalises both Anthropic-style (`{ system, messages: [...] }`) and OpenAI-style (`{ messages: [...] }`) payloads into `{ system, user }`, and returns a `StubServer` with `url`, `close`, `setHandler`, and `callCount`. `closedKeysFromPrompt(user, fallbackModuleId)` scans the user prompt line-by-line for `- path#symbol` entries (the closed-list the production code embeds) and returns those keys, falling back to `[fallbackModuleId.ts#placeholder]` when none are present. `defaultHandler(req, opts)` answers Anthropic-shaped responses, derives a module id from `# Module: ...`, rebuilds a valid Markdown page whose frontmatter `anchors:` list comes from `closedKeysFromPrompt`, and supports a `failNTimes` option to simulate transport failures. `runCli(args, env)` spawns the binary asynchronously and resolves with `{ status, stdout, stderr }`. `writeCode(rel, content)` writes a source file under the temp repo. `writeConfig(provider, model, baseUrl)` drops a `.livewiki/config.json` with the chosen provider and base URL so the test routes the LLM client at the stub.

## Batch E2E — subdirectories + NodeNext + openai-compat (`cli-batch-e2e-subdirs.test.ts`)

<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

This suite extends the batch E2E to repos with subdirectories, NodeNext cross-directory imports, and an `openai-compat` provider. It reuses the `startStubServer` / `closedKeysFromPrompt` / `defaultHandler` / `runCli` / `writeCode` shape from the flat fixture but targets findings H–M (subdirectory init, empty-LLM-refine rejection, checkpoint integrity, NodeNext edge resolution, no-config failure path, manifest write gating). `isStage2RefinePrompt(user)` detects the stage-2 prompt via the literal string `Heuristic module grouping`, which is unique to the refine-modules stage and avoids the cross-newline regex pitfalls of the previous `refine.*modules` matcher. `makeRefineHandler(refinedModules)` returns a stub handler that replies with `{ modules: refinedModules }` for stage-2 calls and delegates to `defaultHandler` otherwise, which is what the tests use to drive deterministic grouping. `writeOpenAiConfig(model, baseUrl)` writes an `openai-compat` `.livewiki/config.json` with explicit pricing so the test exercises the openai-compat provider path rather than the Anthropic one.
