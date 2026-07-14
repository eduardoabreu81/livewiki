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

Module entry point, CLI surface wiring, and integration-test fixtures for the `@livewiki/cli` package.

## CLI entry point and command registration

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#run packages/cli/src/cli.ts#resolveRepoRoot -->

`createProgram` constructs the root `commander` `Command` named `livewiki`, attaches global flags (`--json`, `--repo`), and registers every subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`). The full surface is scaffolded here so `--help` always reflects the spec.

`readVersion` synchronously parses `../../package.json` relative to `import.meta.url` and returns the `version` string, falling back to `"0.0.0"` if the file is missing or unparseable. The read is sync because the file is static at build time and the caller (`run`) is already async.

`run(argv)` creates the program and invokes `program.parseAsync(argv)`; it is the single async entry point invoked by `dist/index.js`.

`resolveRepoRoot(repoOpt)` returns `path.resolve(process.cwd(), repoOpt ?? ".")` and is used by every command to construct a `CommandContext` from the global `--repo` flag.

## Output helpers

<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

All CLI output flows through this module, per SPEC §"Comandos CLI" (human-legible AND parseable with `--json`).

`emitHuman(text)` writes `text` to `process.stdout`, appending a single `\n` when the input does not already end with one.

`emitJson(data)` writes `JSON.stringify(data)` plus `\n` so `JSON.parse` works on a line-by-line stream.

`emit(json, data, human)` is the single dispatch helper: when `json` is true it routes to `emitJson(data)`; otherwise it routes to `emitHuman(human)`. Callers must pass exactly one of the two payload arguments.

## E2E batch fixture (subdirectories + NodeNext)

<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

Phase 3 rev2 reviewer-scenario fixture exposing bugs (H–M) not covered by the flat layout: subdirectories, NodeNext cross-imports (`../utils/crypto.js → crypto.ts`), and `openai-compat` config pointing at an in-process stub.

`startStubServer` binds an `http.createServer` on `127.0.0.1:0`, returns a `StubServer` exposing `url`, `close`, `setHandler`, `callCount`, and `received`. It accepts both Anthropic-shape (`{ system, messages }`) and OpenAI-shape (`{ messages: [{role,content}]`) bodies, normalising them to `{ system, user }` before delegating to the configured handler; missing/unset handlers return `500`.

`closedKeysFromPrompt(user, fallbackModuleId)` scans the user prompt line-by-line for lines matching `^- (\S+#\S+)$` and returns the captured keys, falling back to `[`${fallbackModuleId}.ts#placeholder`]` when the prompt has none.

`defaultHandler(req)` extracts the module id from `/^# Module: (\S+)/` in the user prompt, reuses `closedKeysFromPrompt`, and returns a `StubResponse` carrying a small valid Markdown document whose frontmatter `anchors` list contains exactly the closed keys.

`isStage2RefinePrompt(user)` tests `user.includes("Heuristic module grouping")`. The sentinel string is unique to the stage-2 user prompt (it does not appear in stage-4), replacing a previous regex (`/refine.*modules/`) that silently failed across newlines.

`makeRefineHandler(refinedModules)` returns a function that emits `{"modules": refinedModules}` for stage-2 prompts and delegates to `defaultHandler` otherwise.

`runCli(args, env?)` spawns `node dist/index.js <args…>` with merged env, returns `{ status, stdout, stderr }`.

`writeCode(rel, content)` writes `rel` under the per-test tmp dir, creating parents.

`writeOpenAiConfig(model, baseUrl)` writes `.livewiki/config.json` with `provider: "openai-compat"`, `model`, `baseUrl`, and mock pricing `{ inputUsdPerMtok: 3.0, outputUsdPerMtok: 15.0 }`.

## E2E batch fixture (flat layout, Anthropic stub)

<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

Phase 3 flat-layout fixture: two-file repo, in-process Anthropic stub, end-to-end `init --batch` plus `verify`.

`startStubServer` mirrors the subdirs variant (same Anthropic/OpenAI dual-shape handling), but exposes `setHandler`/`callCount` only — no `received` log.

`closedKeysFromPrompt(user, fallbackModuleId)` is identical to the subdirs variant.

`defaultHandler(req, opts?)` accepts an optional `failNTimes` counter, returns `{status:500}` while the counter is positive then decrements; otherwise it builds an Anthropic-shaped stub response (`content: [{type:"text", text}]`) carrying the same Markdown shape used in the subdirs fixture.

`runCli(args, env?)` is identical in shape.

`writeCode(rel, content)` is identical in shape.

`writeConfig(provider, model, baseUrl)` writes `.livewiki/config.json` with raw `{ provider, model, baseUrl }` (no pricing block, since this fixture targets the Anthropic provider).

## CLI E2E (Fase 2 reviewer-driven dedup + rewrite tests)

<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki packages/cli/src/cli-e2e.test.ts#statusDebt -->

Exercise the real `livewiki` binary (`packages/cli/dist/index.js`) against a tmp repo. Required alongside fixes A–G because unit tests at the `runLedger` level bypass the soft-delete path on update.

`cliBin()` resolves `dist/index.js` under `process.cwd()` — the compiled artifact built from `src/cli.ts`.

`runCli(args)` uses `spawnSync` with `encoding: "utf8"` and returns `{ status, stdout, stderr }`. Synchronous on purpose: scenarios assert `status === 0` immediately after, before tmp cleanup runs.

`writeCode(rel, content)` writes source files under `repoRoot`.

`writeWiki(rel, content)` writes wiki Markdown under `repoRoot`.

`statusDebt()` runs `livewiki status --json`, returns `debt.byEvent` (`{ changed, moved, deleted }`); used to assert aggregate debt totals because per-run `ledger.debtByEvent` does not include pre-existing open rows (only those produced by this `index`).